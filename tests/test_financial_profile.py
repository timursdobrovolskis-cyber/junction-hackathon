import unittest

from src.financial_profile import build_profile


def tx(day, amount, kind="purchase", category="Groceries", merchant="shop", account="A", customer="C", balance=100000, order=1):
    return {"transaction_id": f"{customer}-{account}-{day}-{order}", "source_row": order,
            "customer_id": customer, "account_id": account, "date": day,
            "occurred_at": day + "T12:00:00", "category": category,
            "amount_cents": amount, "balance_after_cents": balance,
            "transaction_type": kind, "merchant_id": merchant, "mcc_code": None}


def history():
    rows = [tx("2026-01-20", -1000)]
    for month in range(2, 8):
        rows.extend([
            tx(f"2026-{month:02d}-15", 200000, "salary", "Salary", None, order=2),
            tx(f"2026-{month:02d}-03", -60000, "housing_payment", "Housing", None, order=3),
            tx(f"2026-{month:02d}-10", -5000, "utilities_payment", "Utilities", None, order=4),
            tx(f"2026-{month:02d}-25", -3000, "utilities_payment", "Utilities", None, order=5),
            tx(f"2026-{month:02d}-20", -1000, order=6),
        ])
    return rows


class FinancialProfileTests(unittest.TestCase):
    def test_future_and_other_customer_data_cannot_change_profile(self):
        rows = history()
        before = build_profile(rows, "C", "2026-06-30")
        adversarial = rows + [tx("2026-07-01", 90000000, "salary", "Salary", balance=99999999),
                              tx("2026-03-01", -90000000, customer="OTHER")]
        self.assertEqual(before, build_profile(adversarial, "C", "2026-06-30"))
        self.assertTrue(all(e["date"] <= "2026-06-30" for e in before["evidence"]))

    def test_zero_months_and_partial_months_do_not_inflate_budget(self):
        rows = [tx("2026-01-20", -990000), tx("2026-02-20", -3000),
                tx("2026-04-02", -3000), tx("2026-05-02", -990000)]
        profile = build_profile(rows, "C", "2026-05-15")
        self.assertEqual(profile["coverage"]["completeMonths"], ["2026-02", "2026-03", "2026-04"])
        self.assertEqual([r["amountCents"] for r in profile["consumption"]["monthlyTotals"]], [3000, 0, 3000])
        self.assertTrue(profile["coverage"]["partialCurrentMonthExcluded"])
        self.assertFalse(build_profile(rows, "C", "2026-05-31")["coverage"]["partialCurrentMonthExcluded"])

    def test_investments_and_sweeps_affect_cash_but_not_income_or_spending(self):
        rows = history()
        baseline = build_profile(rows, "C", "2026-07-31")
        rows += [tx("2026-07-29", -20000, "salary_sweep", "Salary Sweep", None),
                 tx("2026-07-30", 10000, "investment_withdrawal", "Invest Withdraw", None)]
        profile = build_profile(rows, "C", "2026-07-31")
        self.assertEqual(profile["consumption"], baseline["consumption"])
        self.assertEqual(profile["income"], baseline["income"])
        self.assertEqual(profile["monthlyCashFlow"][-1]["netChangeCents"], baseline["monthlyCashFlow"][-1]["netChangeCents"] - 10000)
        self.assertTrue(any("not verified savings" in w for w in profile["warnings"]))

    def test_utilities_are_an_aggregate_not_one_invented_bill(self):
        profile = build_profile(history(), "C", "2026-07-31")
        utility = next(p for p in profile["recurringPatterns"] if p["transactionType"] == "utilities_payment")
        self.assertEqual(utility["estimatedActiveMonthTotalCents"], 8000)
        self.assertEqual(utility["scope"], "account_type_category_aggregate")
        self.assertEqual(utility["timing"]["status"], "multiple_payments")
        self.assertIsNone(utility["timing"]["estimatedDayOfMonth"])
        self.assertTrue(utility["includedInCategorySpending"])

    def test_variable_salary_dates_do_not_become_a_precise_payday(self):
        rows = history()
        for row in rows:
            if row["transaction_type"] == "salary" and row["date"][5:7] in {"04", "06"}:
                row["date"] = row["date"][:8] + "28"
                row["occurred_at"] = row["date"] + "T12:00:00"
        profile = build_profile(rows, "C", "2026-07-31")
        salary = next(p for p in profile["recurringPatterns"] if p["kind"] == "income")
        self.assertEqual(salary["timing"]["status"], "variable")
        self.assertIsNone(salary["timing"]["estimatedDayOfMonth"])

    def test_calendar_month_end_salary_across_february(self):
        rows = [tx("2026-01-01", -100)]
        for day in ["2026-02-28", "2026-03-31", "2026-04-30"]:
            rows.append(tx(day, 200000, "salary", "Salary", None))
        profile = build_profile(rows, "C", "2026-04-30")
        self.assertTrue(profile["recurringPatterns"][0]["timing"]["monthEnd"])

    def test_missing_latest_month_requires_confirmation(self):
        rows = [r for r in history() if not (r["transaction_type"] == "housing_payment" and r["date"].startswith("2026-07"))]
        profile = build_profile(rows, "C", "2026-07-31")
        housing = next(p for p in profile["recurringPatterns"] if p["category"] == "Housing")
        self.assertEqual(housing["status"], "needs_confirmation")
        self.assertEqual(housing["estimatedActiveMonthTotalCents"], 60000)

    def test_sparse_history_and_no_history(self):
        self.assertEqual(build_profile([], "C", "2026-01-31")["status"], "no_history")
        profile = build_profile([tx("2026-01-15", -1000)], "C", "2026-01-31")
        self.assertEqual(profile["status"], "limited_history")
        self.assertIsNone(profile["income"]["medianCents"])
        self.assertEqual(profile["recurringPatterns"], [])

    def test_unknown_type_retained_in_cash_and_flagged(self):
        rows = history() + [tx("2026-07-28", -4567, "unknown", "Other")]
        profile = build_profile(rows, "C", "2026-07-31")
        self.assertEqual(profile["unclassifiedTransactionCount"], 1)
        self.assertEqual(profile["monthlyCashFlow"][-1]["netChangeCents"], 200000 - 60000 - 8000 - 1000 - 4567)

    def test_balances_are_per_account_and_use_source_order_for_ties(self):
        rows = [tx("2026-04-20", -1000, balance=1000),
                tx("2026-04-20", -500, balance=500, order=2),
                tx("2026-04-19", 9000, account="B", balance=9000)]
        profile = build_profile(reversed(rows), "C", "2026-04-30")
        self.assertEqual(profile["observedBalanceCents"], 9500)
        self.assertEqual(len(profile["accounts"]), 2)

    def test_large_purchase_has_evidence_without_becoming_a_future_bill(self):
        profile = build_profile(history() + [tx("2026-07-28", -100000)], "C", "2026-07-31")
        self.assertEqual(profile["irregularExpenseCandidates"][0]["amountCents"], 100000)
        self.assertFalse(any(p["merchantId"] == "shop" for p in profile["recurringPatterns"]))
        references = {e["id"] for e in profile["evidence"]}
        self.assertTrue(set(profile["irregularExpenseCandidates"][0]["evidenceIds"]) <= references)


if __name__ == "__main__":
    unittest.main()
