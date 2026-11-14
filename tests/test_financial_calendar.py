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
        self.assertEqual(len(yearly), 2)
        event = yearly[0]
        self.assertEqual((event["earliestDate"], event["latestDate"]), ("2026-11-20", "2026-11-20"))
        self.assertEqual(event["amountCents"], 12000)
        self.assertEqual(len(event["evidenceIds"]), 2)
        self.assertFalse(event["isConfirmed"])
        self.assertEqual(event["status"], "estimated")
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
        self.assertEqual(event["earliestDate"], "2025-02-28")

    def test_matched_cancelled_and_already_included_costs_do_not_duplicate(self):
        payment = next(p for p in self.forecast["upcomingPayments"] if p["transactionType"] == "housing_payment")
        base = {"id": "rent", "customerId": "CALENDAR-DEMO", "date": payment["earliestDate"], "amountCents": payment["expectedTotalCents"],
                "accountId": payment["accountId"], "category": payment["category"], "inclusion": "already_included", "status": "planned"}
        result = {**self.result, "plannedExpenses": [base, {**base, "id": "paid", "status": "matched"}, {**base, "id": "cancelled", "status": "cancelled"}]}
        calendar = self.build(result=result)
        self.assertFalse(any(e["source"] == "customer" for e in calendar["events"]))
        self.assertEqual(calendar["events"], self.build()["events"])
        base["customerId"] = "OTHER"
        with self.assertRaises(ValueError): self.build(result=result)

    def test_each_regular_payment_appears_on_one_day_for_two_years(self):
        calendar = self.build()
        self.assertEqual(calendar["rangeEnd"], "2028-10-31")
        self.assertTrue(all(e["date"] == e["earliestDate"] == e["latestDate"] for e in calendar["events"]))
        salary = [e for e in calendar["events"] if e["kind"] == "income"]
        self.assertEqual(len(salary), 24)
        self.assertTrue(all(e["date"].endswith("-01") for e in salary))

    def test_irregular_salary_dates_are_omitted_even_when_forecast_has_income(self):
        rows = deepcopy(self.rows)
        for row in rows:
            if row["transaction_type"] == "salary" and row["date"].startswith("2026-09"):
                row["date"] = "2026-09-15"
        calendar = self.build(rows)
        self.assertFalse(any(e["kind"] == "income" for e in calendar["events"]))
        self.assertTrue(any(p["title"] == "Salary" for p in calendar["omittedPatterns"]))
        self.assertEqual(calendar["daily"], self.forecast["daily"])

    def test_one_off_costs_are_excluded_without_changing_the_engine_result(self):
        result = {**self.result, "plannedExpenses": [{"customerId": "CALENDAR-DEMO", "id": "repair", "date": "2026-11-07", "amountCents": 50000, "status": "planned", "inclusion": "additional"}]}
        self.assertEqual(self.build(result=result)["events"], self.build()["events"])

    def test_missing_month_and_multiple_payments_do_not_create_fixed_rules(self):
        for rows in ([r for r in self.rows if not (r["transaction_type"] == "salary" and r["date"].startswith("2026-09"))],
                     self.rows + [{**next(r for r in self.rows if r["date"] == "2026-09-01"), "transaction_id": "extra", "date": "2026-09-15"}]):
            self.assertFalse(any(e["kind"] == "income" for e in self.build(rows)["events"]))

    def test_variable_cost_amounts_are_excluded(self):
        rows = deepcopy(self.rows)
        next(r for r in rows if r["date"] == "2026-09-12")["amount_cents"] = -50000
        self.assertFalse(any(e.get("merchantId") == "demo-utilities" for e in self.build(rows)["events"]))

    def subscription(self, **changes):
        return {"id": "subscription", "customerId": "CALENDAR-DEMO", "merchant": "Example service", "status": "active",
                "intervalMonths": 1, "nextPaymentDate": "2026-11-30", "amountCents": 1299,
                "accountId": "CALENDAR-DEMO-ACCOUNT", "merchantId": "demo-monthly-subscription", **changes}

    def test_explicit_subscription_replaces_detected_series_once_and_cancellation_hides_it(self):
        for status in ("active", "cancelled", "needs_confirmation"):
            calendar = build_financial_calendar(self.rows, self.result, subscriptions=[self.subscription(status=status)])
            self.assertFalse(any(e.get("merchantId") == "demo-monthly-subscription" for e in calendar["events"]))
            self.assertEqual(len([e for e in calendar["events"] if e["source"] == "subscription_schedule"]), 24 if status == "active" else 0)

    def test_subscription_anchor_survives_short_months(self):
        calendar = build_financial_calendar([], self.result, subscriptions=[self.subscription(nextPaymentDate="2027-01-31")])
        self.assertEqual([e["date"] for e in calendar["events"][:3]], ["2027-01-31", "2027-02-28", "2027-03-31"])
        self.assertTrue(any(e["date"] == "2028-02-29" for e in calendar["events"]))

    def test_subscription_customer_and_duplicate_ids_are_rejected(self):
        for subscriptions in ([self.subscription(customerId="OTHER")], [self.subscription(), self.subscription()],
                              [self.subscription(intervalMonths=0)], [self.subscription(amountCents=True)]):
            with self.assertRaises(ValueError): build_financial_calendar(self.rows, self.result, subscriptions=subscriptions)

    def test_two_merchants_paid_on_same_day_remain_separate(self):
        extra = [{**r, "merchant_id": "second-utility", "transaction_id": "second-" + r["transaction_id"]}
                 for r in self.rows if r["merchant_id"] == "demo-utilities"]
        same_day = [e for e in self.build(self.rows + extra)["events"] if e["date"] == "2026-12-12"]
        self.assertEqual(len(same_day), 2)
        self.assertEqual(len({e["seriesId"] for e in same_day}), 2)

    def test_monthly_housing_with_posting_jitter_uses_one_estimated_day(self):
        rows = deepcopy(self.rows)
        for row in rows:
            if row["transaction_type"] == "housing_payment" and row["date"][:7] >= "2026-05":
                day = {5: 2, 6: 3, 7: 3, 8: 5, 9: 7, 10: 3}[int(row["date"][5:7])]
                row["date"] = row["date"][:8] + f"{day:02d}"
        housing = [e for e in self.build(rows)["events"] if e["title"] == "Housing payment"]
        self.assertEqual(len(housing), 24)
        self.assertTrue(all(e["date"].endswith("-03") for e in housing))
        self.assertEqual(housing[0]["observedDayRange"], [2, 7])

    def test_new_subscription_needs_three_recent_months_and_no_frequent_shopping(self):
        extra = [{**self.rows[0], "transaction_id": f"new-{month}", "date": f"2026-{month}-18", "transaction_type": "purchase", "merchant_id": "new-service", "amount_cents": -1500} for month in ["08", "09", "10"]]
        events = [e for e in self.build(self.rows + extra)["events"] if e.get("merchantId") == "new-service"]
        self.assertEqual(len(events), 24)
        self.assertTrue(all(e["kind"] == "subscription" and not e["isConfirmed"] for e in events))
        for start in ["07", "06"]:
            extended = extra + [{**extra[0], "transaction_id": "new-" + start, "date": f"2026-{start}-18"}]
            if start == "06": extended.append({**extra[0], "transaction_id": "new-07", "date": "2026-07-18"})
            self.assertEqual(len([e for e in self.build(self.rows + extended)["events"] if e.get("merchantId") == "new-service"]), 24)
        for invalid in [extra[1:], extra + [{**extra[0], "transaction_id": "extra", "date": "2026-08-25"}], [{**r, "merchant_id": None} for r in extra]]:
            self.assertFalse(any(e.get("merchantId") == "new-service" for e in self.build(self.rows + invalid)["events"]))

    def test_ambiguous_utility_group_is_a_notice_not_a_fabricated_payment(self):
        extra = [{**r, "transaction_id": "extra-" + r["transaction_id"], "date": r["date"][:8] + "27"} for r in self.rows if r["transaction_type"] == "utilities_payment"]
        calendar = self.build(self.rows + extra)
        self.assertFalse(any(e.get("merchantId") == "demo-utilities" for e in calendar["events"]))
        notice = next(n for n in calendar["notifications"] if n["kind"] == "bill_timing_uncertain")
        self.assertEqual(notice["metrics"][0]["amountCents"], 12000)
        self.assertTrue(notice["evidenceIds"])

    def test_ids_are_stable_and_invalid_scope_is_rejected(self):
        self.assertEqual([e["id"] for e in self.build()["events"]], [e["id"] for e in self.build()["events"]])
        with self.assertRaises(ValueError): build_financial_calendar(self.rows, self.result, months=25)
        with self.assertRaises(ValueError): self.build(result={**self.result, "customerId": "OTHER"})


if __name__ == "__main__": unittest.main()
