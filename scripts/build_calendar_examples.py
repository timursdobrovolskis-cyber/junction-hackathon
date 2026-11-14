"""Build reviewable calendar examples using the Python financial engine."""
import json
from datetime import datetime, timezone
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.financial_calendar import build_financial_calendar
from src.financial_engine import FinancialEngine
from src.cash_flow import forecast_cash_flow
from scripts.calendar_risk_demo import build_risk_demo


def recurring_demo_rows():
    rows, balance = [], 300000
    payments = []
    for year in (2024, 2025, 2026):
        for month in range(1, 13):
            if year == 2026 and month > 10:
                break
            for day, amount, kind, category, merchant in (
                (1, 240000, "salary", "Salary", None), (3, -80000, "housing_payment", "Housing", "demo-landlord"),
                (12, -6000, "utilities_payment", "Utilities", "demo-utilities"),
                (18, -1299, "purchase", "Entertainment", "demo-monthly-subscription"),
            ):
                payments.append((f"{year}-{month:02d}-{day:02d}", amount, kind, category, merchant))
            if month == 11:
                payments.append((f"{year}-11-20", -12000, "purchase", "Insurance", "demo-yearly-renewal"))
    for index, (day, amount, kind, category, merchant) in enumerate(sorted(payments), 1):
        balance += amount
        rows.append({"transaction_id": f"calendar-demo-tx-{index}", "customer_id": "CALENDAR-DEMO", "account_id": "CALENDAR-DEMO-ACCOUNT",
                     "date": day, "occurred_at": day + "T12:00:00", "source_row": index, "amount_cents": amount,
                     "balance_after_cents": balance, "transaction_type": kind, "category": category, "merchant_id": merchant})
    return rows


def main():
    root = Path(__file__).resolve().parents[1]
    engine = FinancialEngine(root / "data/local/bank.sqlite", root / "data/models/income-v2.json", root / "data/models/income-v2-calibration.json")
    request = json.loads((root / "fixtures/financial-plan-request.json").read_text())
    actual = engine.calendar(request)
    actual["label"] = "Transaction example"
    actual["sourceNotice"] = "Synthetic bank customer CUST00005; history through 30 September 2026. Separate from Home's illustrative November figures."
    stable = engine.calendar({**request, "customerId": "CUST00003"})
    stable["label"] = "Regular payday example"
    stable["sourceNotice"] = "Synthetic bank customer CUST00003; history through 30 September 2026. This customer's recent salary arrives on the 15th."
    subscriptions = json.loads((root / "fixtures/calendar-subscriptions-demo.json").read_text())
    sub_customer = "SUBSCRIPTIONS-DEMO"
    sub_forecast = forecast_cash_flow([], sub_customer, subscriptions["asOf"], buffer_cents=0)
    sub_demo = build_financial_calendar([], {"customerId": sub_customer, "asOf": subscriptions["asOf"], "forecast": sub_forecast},
        subscriptions=[{**s, "customerId": sub_customer, "status": "active"} for s in subscriptions["subscriptions"]])
    sub_demo["label"] = "Subscription schedule example"
    sub_demo["sourceNotice"] = "Team subscription demo: Netflix, Spotify, iCloud+, gym and Adobe. These sample schedules are not attached to a bank-data customer."
    rows = recurring_demo_rows()
    forecast = forecast_cash_flow(rows, "CALENDAR-DEMO", "2026-10-31", buffer_cents=50000)
    demo = build_financial_calendar(rows, {"customerId": "CALENDAR-DEMO", "asOf": "2026-10-31", "forecast": forecast})
    demo["label"] = "Recurring costs example"
    demo["sourceNotice"] = "Fictional ledger for demonstrating monthly bills and yearly renewals. Separate from the bank-data customer and Home."
    destination = root / "ui-skeleton/server/calendar"
    destination.mkdir(parents=True, exist_ok=True)
    for name, payload in [("risk", build_risk_demo()), ("engine", actual), ("regular", stable), ("recurring", demo), ("subscriptions", sub_demo)]:
        payload["generatedAt"] = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
        (destination / f"{name}.json").write_text(json.dumps(payload, indent=2) + "\n")
        print(f"{name}: {len(payload['events'])} calendar entries; {len(payload['daily'])} forecast days")


if __name__ == "__main__":
    main()
