from copy import deepcopy
import unittest

from src.cash_flow import forecast_cash_flow
from src.income_model import MODEL_VERSION, fit_income_model, held_out
from src.forecast_safety import apply_calibration, estimate_savings, fit_calibration, path_score
from test_financial_profile import history, tx


def model():
    return {"modelVersion": MODEL_VERSION, "trainingThrough": "2026-04-30", "priorStrength": 3,
            "globalDayCounts": {"15": 8, "end-0": 2},
            "transitionCounts": {"15": {"15": 8, "end-0": 2}}}


class IncomeAndSavingsTests(unittest.TestCase):
    def test_training_excludes_future_and_reserved_customers(self):
        included = next(str(i) for i in range(100) if not held_out(str(i)))
        excluded = next(str(i) for i in range(100) if held_out(str(i)))
        rows = [tx("2026-03-15", 10000, "salary", customer=included),
                tx("2026-04-15", 10000, "salary", customer=included)]
        before = fit_income_model(rows, "2026-04-30")
        rows += [tx("2026-05-31", 9999999, "salary", customer=included),
                 tx("2026-04-01", 9999999, "salary", customer=excluded)]
        self.assertEqual(before, fit_income_model(rows, "2026-04-30"))

    def test_unpaid_midmonth_income_is_conditioned_on_remaining_dates(self):
        rows = [r for r in history() if not (r["transaction_type"] == "salary" and r["date"].startswith("2026-06"))]
        result = forecast_cash_flow(rows, "C", "2026-06-20", horizon_days=10, income_model=model())
        salaries = [p for p in result["upcomingPayments"] if p["transactionType"] == "salary"]
        self.assertEqual(len(salaries), 1)
        self.assertEqual(salaries[0]["expectedTotalCents"], 200000)
        self.assertEqual(salaries[0]["earliestDate"], "2026-06-30")

    def test_income_paid_this_month_is_not_added_again(self):
        result = forecast_cash_flow(history(), "C", "2026-06-20", horizon_days=10, income_model=model())
        self.assertFalse(any(p["transactionType"] == "salary" for p in result["upcomingPayments"]))

    def test_forecast_blocks_future_trained_artifact(self):
        bad = model()
        bad["trainingThrough"] = "2026-08-31"
        with self.assertRaises(ValueError):
            forecast_cash_flow(history(), "C", "2026-07-31", income_model=bad)

    def test_updated_forecast_ignores_later_outcomes(self):
        rows = history()
        before = forecast_cash_flow(rows, "C", "2026-06-30", income_model=model())
        rows.append(tx("2026-07-01", 99999999, "salary", "Salary", None))
        self.assertEqual(before, forecast_cash_flow(rows, "C", "2026-06-30", income_model=model()))

    def test_calibration_quantile_and_model_cutoff_guards(self):
        forecast = forecast_cash_flow(history(), "C", "2026-07-31", income_model=model())
        calibration = fit_calibration(list(range(1, 11)), model(), "2026-07-30")
        self.assertEqual(calibration["marginCents"], 10)
        calibrated = apply_calibration(forecast, calibration, model())
        self.assertEqual(calibrated["daily"][0]["calibratedLowerBalanceCents"], forecast["daily"][0]["lowerScenarioBalanceCents"] - 10)
        calibration["calibrationThrough"] = "2026-08-01"
        with self.assertRaises(ValueError):
            apply_calibration(forecast, calibration, model())
        calibration["calibrationThrough"] = "2026-07-30"
        changed = model()
        changed["priorStrength"] = 9
        with self.assertRaises(ValueError):
            apply_calibration(forecast, calibration, changed)

    def test_whole_path_score_captures_single_bad_day(self):
        forecast = {"daily": [{"lowerScenarioBalanceCents": 100, "upperScenarioBalanceCents": 300}] * 3}
        self.assertEqual(path_score(forecast, [200, -50, 200]), 150)

    def savings_forecast(self):
        f = forecast_cash_flow(history(), "C", "2026-07-31", income_model=model())
        c = fit_calibration([1000] * 20, model(), "2026-07-30")
        return apply_calibration(f, c, model())

    def test_savings_preserves_buffer_and_future_reserves_on_entire_path(self):
        f = self.savings_forecast()
        cost = {"id": "winter", "date": "2026-12-01", "amountCents": 10000}
        result = estimate_savings(f, 5000, [cost], commitments_confirmed=True)
        amount = result["suggestedSavingsCents"]
        self.assertGreater(amount, 0)
        for balance in [f["startingBalanceCents"]] + [d["calibratedLowerBalanceCents"] for d in f["daily"]]:
            self.assertGreaterEqual(balance - amount - 10000, 5000)
        self.assertFalse(result["movesMoney"])

    def test_savings_needs_confirmation_and_never_returns_negative_capacity(self):
        result = estimate_savings(self.savings_forecast(), 9999999, [])
        self.assertEqual(result["conditionalCapacityCents"], 0)
        self.assertIsNone(result["suggestedSavingsCents"])
        self.assertEqual(result["status"], "needs_confirmation")

    def test_savings_rejects_duplicate_and_in_horizon_costs(self):
        f = self.savings_forecast()
        cost = {"id": "winter", "date": "2026-12-01", "amountCents": 10000}
        with self.assertRaises(ValueError):
            estimate_savings(f, 5000, [cost, cost])
        cost["date"] = "2026-08-02"
        with self.assertRaises(ValueError):
            estimate_savings(f, 5000, [cost])

    def test_savings_withholds_uncalibrated_and_multi_account_forecasts(self):
        f = self.savings_forecast()
        f["accounts"].append(deepcopy(f["accounts"][0]))
        self.assertEqual(estimate_savings(f, 5000, [])["status"], "withheld")

    def test_sparse_v2_forecast_returns_withheld_savings_without_model_mismatch(self):
        f = forecast_cash_flow([], "C", "2026-07-31", income_model=model())
        calibration = fit_calibration([1000] * 20, model(), "2026-07-30")
        f = apply_calibration(f, calibration, model())
        self.assertEqual(estimate_savings(f, 5000, [])["status"], "withheld")
        f = self.savings_forecast()
        del f["calibration"]
        self.assertEqual(estimate_savings(f, 5000, [])["status"], "withheld")


if __name__ == "__main__":
    unittest.main()
