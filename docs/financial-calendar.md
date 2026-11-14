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
  most €1 or 10% of the median). Bills may drift by up to six calendar days;
  their median day becomes one estimated date, with the observed day/amount
  range available in details. Salary timing remains strict.
- Merchant purchases with stable amounts/dates across three to six consecutive
  recent months become **possible subscriptions**. A missing recent month or
  frequent shopping with that merchant prevents the match. These candidates
  are not confirmed contracts or invented provider names.
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
  buffer risk means a balance forecast falls below the customer's cash reserve.
  It can appear as a separate forecast notice, never as a payment.

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
| regular (initial UI selection) | CUST00003, bank history through September 2026 | Salary on the 15th and housing near the 3rd; unclear utilities dates flagged |
| engine | CUST00005, same cutoff | Housing near the 3rd; rising purchase spending and uncertain utility dates flagged |
| recurring | CALENDAR-DEMO, fictional ledger through October 2026 | Salary, rent, utilities, monthly cost, annual insurance |
| subscriptions | SUBSCRIPTIONS-DEMO, `fixtures/calendar-subscriptions-demo.json` | Named monthly and yearly renewals from the team's supplied schedule |

`FINANCIAL_ENGINE_URL=http://127.0.0.1:8765` connects the two bank-data samples to
the running Python service. Restart Node and Python together with schema 2.0.
Refresh reruns the engine for that sample. Wrong customer/cutoff/schema and
invalid event responses fail explicitly; previous data remains clearly labelled.
Production needs the app's authenticated customer mapped server-side instead of
these demonstration selectors. Home and Goals still have separate sample data.

## Customer subscription integration

The preserved calendar subscription fixture has no customer identity. It is deliberately
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
authenticated bank feed, external push notification service or payment execution. Calendar
reminders alone do not add a subscription to a financial plan or confirm savings.

## Spending alerts and reminders

`src/calendar_insights.py` returns customer-scoped `notifications`, separate
from scheduled payments. Tappable cards below the calendar open the analysis,
exact amounts, period, transaction IDs and a useful next step. Analysis dates
stay visible when navigating future months; these are historical observations,
not two-year spending predictions.

- Rising spending: three complete months of purchases, at least 10% growth in
  each comparison, at least 25% total growth and €50 absolute growth. Refunds
  reduce totals; transfers and investments are excluded. A single spike does
  not trigger this pattern.
- Repeated shortfall: recorded consumption exceeds positive recorded income in
  both of the last two complete months. Missing/external income is acknowledged.
- Buffer warning: directly reuses the engine's central/possible below-buffer
  dates and chosen reserve; never extrapolates beyond forecast coverage.
- Unclear recurring bills: historical monthly estimate and evidence, with a
  request to check provider due dates. Unknown utilities are not given invented
  dates. Possible subscription matches have a separate evidence reminder.

CUST00005 purchases rise from €798.74 (July) to €995.48 (August) to €1,284.19
(September), a €485.45 / 61% increase. CUST00003's housing observations occur
between the 2nd and 7th; the median date is the 3rd. Neither bank-data example has
an evidenced named subscription: named services remain in the separate demo.

## Google Calendar

Use **Connect to Google Calendar** → **Open Google Calendar**, then confirm Add
in Google. The dialog also provides a copyable URL (Other calendars → + → From
URL in Google's desktop web interface) and a downloadable `.ics` snapshot.
`GET /api/calendar-feed?source=regular|engine|recurring|subscriptions` produces
RFC 5545 all-day, tentative events with stable UIDs and exclusive next-day end
dates. Dates/names are exported; account IDs, transaction IDs, balances, alerts
and payment amounts are excluded. UTF-8 folding and escaping protect the format.

Subscription URLs are one-way; Google controls refresh timing. A downloaded
file does not update, and repeated file imports may duplicate events. Sample
selection does not remove calendars previously added in Google. This requires
no app OAuth credentials and does not grant us access to the user's Google
account. Actual acceptance/Add in Google is a user action.

These public feeds expose only the bundled, already-public synthetic examples.
If `FINANCIAL_ENGINE_URL` enables live bank-data results, export is disabled for
those sources (409). A production private-data connection needs an authenticated,
revocable per-customer URL or Google OAuth; do not put real customers into the
public fixture map. The deployed demo updates when regenerated data is published,
not from a live bank feed.

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
