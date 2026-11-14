# Financial calendar — exact recurring dates

Run `npm run dev:app` and open http://127.0.0.1:4174/spendvest.html#calendar.
The monthly view covers the remainder of the observation month plus 24 future
months. Use the month selector to jump across years. Click any date to open all
payments on that date, then a payment to inspect its amount and transactions.
The date dialog shows all payments even if the month list has an active filter.

## Scheduling rules

`src/financial_calendar.py` builds schema `2.0`. Each event has one ISO `date`;
compatibility fields `earliestDate` and `latestDate` equal that date. This is an
estimated calendar date, not a narrower or newly calibrated cash-flow forecast.
Amounts come from the Python engine: an existing forecast payment where one
matches, otherwise the profile's historical median. Supplied subscription
amounts are used unchanged. No financial arithmetic runs in the browser.

- Monthly history: at least three observations, one payment in every examined
  recent complete month (up to six), a consistent day or exact month-end rule,
  and a recent observation. Fixed costs also require stable amounts (spread at
  most €1 or 10% of the median). Salary amounts may vary if dates are stable.
- Annual history: at least two observations, annual intervals, the same month
  and day (including leap-day clipping), and stable amounts. Estimates remain
  unconfirmed; repeated transactions do not establish a subscription contract.
- February clips a 29th–31st anchor without shifting March's date. No business-day
  adjustment is invented because the dataset supplies no such rule.
- Irregular payments, account movements, one-off planned costs, variable dates,
  missed monthly payments and ambiguous multi-payment groups are not scheduled.
  One-off costs still affect the financial plan normally. `omittedPatterns`
  explains rejected recurring candidates; it is not a list of all spending.
- Already observed payments are not repeated in that month. Dates before the
  observation cutoff and other customers' transactions are excluded.
- Buffer-risk and payment-window overlays are removed from this calendar. A
  buffer risk means a balance forecast falls below the customer's cash reserve;
  that belongs to the financial plan, not an extra payment on a date.

## Data and API

`POST /api/calendar` on the Python service accepts the same inputs as `/api/plan`:

```json
{"customerId":"CUST00003","asOf":"2026-09-30","bufferCents":50000,"savingsTargetCents":10000}
```

The engine can calculate any customer present in its database. It filters rows
by customer and cutoff. Existing `daily`, `bufferCents`, forecast coverage and
uncertainty are returned unchanged for other consumers; calendar entries never
subtract money again or extend the 30-day balance forecast.

The static UI uses server-owned, explicitly selected sample profiles via
`GET /api/calendar?source=regular|engine|recurring|subscriptions`:

| Source | Identity and input | Calendar result |
| --- | --- | --- |
| regular (initial UI selection) | CUST00003, bank history through September 2026 | Salary on the 15th for 24 future months |
| engine | CUST00005, same cutoff | No reliably fixed dates; inconsistent payments are explained, not invented |
| recurring | CALENDAR-DEMO, fictional ledger through October 2026 | Salary, rent, utilities, monthly cost, annual insurance |
| subscriptions | SUBSCRIPTIONS-DEMO, `fixtures/subscriptions-demo.json` | Named monthly and yearly renewals from the team's supplied schedule |

`FINANCIAL_ENGINE_URL=http://127.0.0.1:8765` connects the two bank-data samples to
the running Python service. Restart Node and Python together with schema 2.0.
Refresh reruns the engine for that sample. Wrong customer/cutoff/schema and
invalid event responses fail explicitly; previous data remains clearly labelled.
Production needs the app's authenticated customer mapped server-side instead of
these demonstration selectors. Home and Goals still have separate sample data.

## Customer subscription integration

The subscription fixture on main has no customer identity. It is deliberately
assigned a separate demo identity, never attached to a synthetic bank customer.
Its dates and amounts are reused exactly; the calendar does not manufacture
Netflix/Spotify matches in bank transactions.

A trusted server integration can call
`FinancialEngine.calendar(request, subscriptions=customer_subscriptions)` or
`build_financial_calendar(rows, result, subscriptions=customer_subscriptions)`.
Each record needs `customerId`, unique `id`, `merchant`, `status` (`active`,
`cancelled`, `needs_confirmation`), `intervalMonths` (1 or 12), `nextPaymentDate`
and positive integer `amountCents`. Optional `transactions` contain `id`, `date`
and `amountCents`; optional `accountId` plus `merchantId` identify the matching
historical series. An explicit schedule replaces that series, avoiding duplicate
reminders; cancelled/unconfirmed schedules suppress it. Cross-customer records
and duplicate IDs are rejected. Recalculate after a schedule/status change.

This adapter is not connected to the React subscription demo's component-local
cancellation state. There is no live subscription provider, contract validation,
authenticated bank feed, notification service or payment execution. Calendar
reminders alone do not add a subscription to a financial plan or confirm savings.

## Verification and regenerated examples

```sh
python scripts/build_calendar_examples.py
python -m unittest discover -s tests
npm test
npm --prefix ui-skeleton test
```

The generator needs the local bank database and v2 model. Commit generated JSON,
not the database. The focused UI branch needs the matching schema 2.0 backend
from `feat/planning-coach` for optional live requests; examples work standalone.
