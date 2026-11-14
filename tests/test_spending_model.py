from copy import deepcopy
from datetime import date, timedelta
from fractions import Fraction
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from src.cash_flow import forecast_cash_flow
from src.spending_model import category_features, predicted_purchase_total, purchase_plan, uncertainty_scale
from src.forecast_safety import fit_scaled_calibration, apply_calibration, model_digest
from src.financial_engine import FinancialEngine
from test_financial_profile import tx, history
from test_income_and_savings import model as income_model


def spending_model():
    return {"modelVersion": "adaptive-spending-v3", "trainingThrough": "2026-04-30",
            "incomeModel": income_model(), "recentWeightPercentByCategory": {"Groceries": 50}}


class SpendingModelTests(unittest.TestCase):
    def test_recent_history_changes_the_rate_without_future_leakage(self):
        cutoff = date(2026, 7, 31)
        rows = [tx((cutoff - timedelta(days=i)).isoformat(), -100 if i >= 28 else -200, order=i) for i in range(180)]
        f = category_features(rows, cutoff.isoformat())["Groceries"]
        self.assertEqual(predicted_purchase_total(f, 100), 6000)
        self.assertLess(predicted_purchase_total(f, 0), 6000)
        rows.append(tx("2026-08-01", -99999999))
        self.assertEqual(f, category_features(rows, cutoff.isoformat())["Groceries"])

    def test_large_purchases_keep_a_nonzero_allowance_without_exact_replay(self):
        cutoff = date(2026, 7, 31)
        rows = [tx((cutoff - timedelta(days=i)).isoformat(), -100, order=i) for i in range(180)]
        rows.append(tx("2026-07-20", -100000, order=1000))
        f = category_features(rows, cutoff.isoformat())["Groceries"]
        self.assertGreater(f["exceptionRate"], 0)
        days = [cutoff + timedelta(days=i) for i in range(1, 31)]
        events, explanations = purchase_plan(rows, cutoff.isoformat(), days, spending_model())
        self.assertEqual(sum(e["amountCents"] for e in events), explanations[0]["expectedPurchaseCents"])
        self.assertGreater(explanations[0]["exceptionalExpenseAllowanceCents"], 0)
        self.assertLess(max(e["amountCents"] for e in events), 100000)

    def test_all_flows_still_reconcile_with_v3(self):
        rows = history() + [tx("2026-06-08", -2100, merchant="different")]
        f = forecast_cash_flow(rows, "C", "2026-07-31", income_model=income_model(), spending_model=spending_model())
        for i, d in enumerate(f["daily"]):
            net = sum((1 if c["direction"] == "inflow" else -1) * c["dailyAmountsCents"][i] for c in f["cashFlowComponents"])
            self.assertEqual(net + d["componentRoundingResidualCents"], d["expectedNetChangeCents"])
        self.assertTrue(any(p["transactionType"] == "housing_payment" for p in f["upcomingPayments"]))

    def test_v3_ignores_other_customers_and_future_rows(self):
        rows = history()
        before = forecast_cash_flow(rows, "C", "2026-06-30", income_model=income_model(), spending_model=spending_model())
        rows += [tx("2026-07-01", -99999999), tx("2026-03-05", -99999999, customer="OTHER")]
        self.assertEqual(before, forecast_cash_flow(rows, "C", "2026-06-30", income_model=income_model(), spending_model=spending_model()))

    def test_future_trained_spending_model_is_rejected(self):
        m = spending_model(); m["trainingThrough"] = "2027-01-01"
        with self.assertRaises(ValueError):
            forecast_cash_flow(history(), "C", "2026-07-31", income_model=income_model(), spending_model=m)

    def test_scaled_calibration_changes_margin_and_keeps_hash_guard(self):
        m = spending_model()
        c = fit_scaled_calibration([(100, 100)] * 20, m, "2026-07-30")
        f = forecast_cash_flow(history(), "C", "2026-07-31", income_model=income_model(), spending_model=m)
        f["uncertaintyScaleCents"] = 1000
        first = apply_calibration(f, c, m)
        f["uncertaintyScaleCents"] = 2000
        second = apply_calibration(f, c, m)
        self.assertEqual(first["calibration"]["effectiveMarginCents"], 1000)
        self.assertEqual(second["calibration"]["effectiveMarginCents"], 2000)
        changed = deepcopy(m); changed["recentWeightPercentByCategory"]["Groceries"] = 100
        with self.assertRaises(ValueError):
            apply_calibration(f, c, changed)

    def test_saved_model_and_calibration_digest_round_trip(self):
        m = spending_model()
        self.assertEqual(model_digest(m), model_digest(json.loads(json.dumps(m))))

    def test_engine_validates_requests_before_reading_database(self):
        with TemporaryDirectory() as d:
            model_path = Path(d) / "model.json"; model_path.write_text(json.dumps(income_model()))
            calibration_path = Path(d) / "cal.json"; calibration_path.write_text("{}")
            engine = FinancialEngine(Path(d) / "missing.sqlite", model_path, calibration_path)
            base = {"customerId": "C", "asOf": "2026-09-30", "bufferCents": 100, "savingsTargetCents": 0}
            invalid = [[], {}, {**base, "bufferCents": -1}, {**base, "savingsConfirmed": "yes"},
                       {**base, "categoryOverrides": {"Food": 1.5}}, {**base, "unknown": True}]
            for request in invalid:
                with self.assertRaises(ValueError):
                    engine.plan(request)


if __name__ == "__main__":
    unittest.main()
