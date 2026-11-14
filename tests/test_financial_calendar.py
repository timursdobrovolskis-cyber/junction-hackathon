from copy import deepcopy
import unittest

from src.cash_flow import forecast_cash_flow
from src.financial_calendar import build_financial_calendar, yearly_patterns
from scripts.build_calendar_examples import recurring_demo_rows
from datetime import date


class CalendarTests(unittest.TestCase):
    def setUp(self):
        self.rows = recurring_demo_rows()
        self.forecast = forecast_cash_flow(self.rows, "CALENDAR-DEMO", "2026-10-31", buffer_cents=50000)
        self.result = {"customerId": "CALENDAR-DEMO", "asOf": "2026-10-31", "forecast": self.forecast}

    def build(self, rows=None, result=None):
        return build_financial_calendar(self.rows if rows is None else rows, self.result if result is None else result)

    def test_forecast_amounts_and_balances_are_preserved_not_deducted_twice(self):
        before = deepcopy(self.result)
        calendar = self.build()
        self.assertEqual(self.result, before)
        self.assertEqual(calendar["daily"], self.forecast["daily"])
        events = [e for e in calendar["events"] if e["source"] == "forecast"]
        self.assertEqual(sorted(e["amountCents"] for e in events), sorted(p["expectedTotalCents"] for p in self.forecast["upcomingPayments"]))
        self.assertTrue(all(e["alreadyIncludedInForecast"] is True for e in events))
        pairs = [(e["seriesId"], e["earliestDate"][:7]) for e in calendar["events"]]
        self.assertEqual(len(pairs), len(set(pairs)))

    def test_yearly_candidates_need_two_observations_and_are_never_confirmed(self):
        yearly = [e for e in self.build()["events"] if e["cadence"] == "yearly"]
        self.assertEqual(len(yearly), 1)
        event = yearly[0]
        self.assertEqual((event["earliestDate"], event["latestDate"]), ("2026-11-13", "2026-11-27"))
        self.assertEqual(event["amountCents"], 12000)
        self.assertEqual(len(event["evidenceIds"]), 2)
        self.assertFalse(event["isConfirmed"])
        self.assertEqual(event["status"], "needs_review")
        self.assertIsNone(event["alreadyIncludedInForecast"])
        single = [r for r in self.rows if r["date"] >= "2025-01-01"]
        self.assertFalse([e for e in self.build(single)["events"] if e["cadence"] == "yearly"])

    def test_annual_inconsistent_amount_or_irregular_dates_are_not_scheduled(self):
        for field, value in [("amount_cents", -50000), ("date", "2025-08-20")]:
            rows = deepcopy(self.rows)
            yearly = [r for r in rows if r["merchant_id"] == "demo-yearly-renewal"]
            yearly[-1][field] = value
            self.assertEqual(yearly_patterns(rows, date(2026, 10, 31)), [])

    def test_customer_and_historical_cutoff_isolation(self):
        rows = deepcopy(self.rows)
        future = deepcopy(rows[-1]); future.update(date="2027-01-01", amount_cents=-999999, transaction_id="future")
        other = deepcopy(rows[-1]); other.update(customer_id="OTHER", amount_cents=-999999, transaction_id="other")
        self.assertEqual(self.build(rows + [future, other]), self.build())

    def test_sparse_history_does_not_invent_zero_balances(self):
        forecast = forecast_cash_flow(self.rows[-1:], "CALENDAR-DEMO", "2026-10-31", buffer_cents=50000)
        calendar = self.build(self.rows[-1:], {**self.result, "forecast": forecast})
        self.assertEqual(calendar["forecastStatus"], "insufficient_history")
        self.assertEqual(calendar["daily"], [])
        self.assertIsNone(calendar["forecastThrough"])

    def test_monthly_rules_continue_but_balance_forecast_stops(self):
        calendar = self.build()
        self.assertTrue(any(e["cadence"] == "monthly" and e["earliestDate"].startswith("2027-02") for e in calendar["events"]))
        self.assertEqual(calendar["forecastThrough"], "2026-11-30")
        self.assertTrue(all(d["date"] <= "2026-11-30" for d in calendar["daily"]))

    def test_month_end_rule_clamps_to_february(self):
        rows = deepcopy(self.rows)
        from calendar import monthrange
        for row in rows:
            if row["merchant_id"] == "demo-monthly-subscription":
                year, month = map(int, row["date"][:7].split('-'))
                row["date"] = f"{year}-{month:02d}-{monthrange(year, month)[1]}"
        events = self.build(rows)["events"]
        february = [e for e in events if e.get("merchantId") == "demo-monthly-subscription" and e["earliestDate"].startswith("2027-02")]
        self.assertEqual(february[0]["latestDate"], "2027-02-28")

    def test_yearly_leap_day_clamps_without_crashing(self):
        rows = []
        for index, day in enumerate(["2023-02-28", "2024-02-29"]):
            row = deepcopy(self.rows[0]); row.update(date=day, amount_cents=-10000, merchant_id="annual", transaction_type="purchase", transaction_id=str(index))
            rows.append(row)
        forecast = {**self.forecast, "asOf": "2025-01-31", "daily": [], "upcomingPayments": [], "evidence": []}
        result = {**self.result, "asOf": "2025-01-31", "forecast": forecast}
        event = next(e for e in self.build(rows, result)["events"] if e["cadence"] == "yearly")
        self.assertEqual(event["earliestDate"], "2025-02-21")

    def test_matched_cancelled_and_already_included_costs_do_not_duplicate(self):
        payment = next(p for p in self.forecast["upcomingPayments"] if p["transactionType"] == "housing_payment")
        base = {"id": "rent", "customerId": "CALENDAR-DEMO", "date": payment["earliestDate"], "amountCents": payment["expectedTotalCents"],
                "accountId": payment["accountId"], "category": payment["category"], "inclusion": "already_included", "status": "planned"}
        result = {**self.result, "plannedExpenses": [base, {**base, "id": "paid", "status": "matched"}, {**base, "id": "cancelled", "status": "cancelled"}]}
        calendar = self.build(result=result)
        self.assertFalse(any(e["source"] == "customer" for e in calendar["events"]))
        self.assertEqual(next(e for e in calendar["events"] if e.get("plannedExpenseIds"))["plannedExpenseIds"], ["rent"])
        base["customerId"] = "OTHER"
        with self.assertRaises(ValueError): self.build(result=result)

    def test_ids_are_stable_and_invalid_scope_is_rejected(self):
        self.assertEqual([e["id"] for e in self.build()["events"]], [e["id"] for e in self.build()["events"]])
        with self.assertRaises(ValueError): build_financial_calendar(self.rows, self.result, months=13)
        with self.assertRaises(ValueError): self.build(result={**self.result, "customerId": "OTHER"})


if __name__ == "__main__": unittest.main()
