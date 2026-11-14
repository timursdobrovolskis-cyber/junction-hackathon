# Calendar UI: recurring payments on exact dates

This branch builds on the team's integrated frontend (including Goals and Coach).
Run `npm run dev` inside `ui-skeleton` and open
http://127.0.0.1:4174/spendvest.html#calendar. `PORT=4176 npm run dev` chooses another
port. No Gemini key or Python service is needed for the saved calendar samples.

- Monthly calendar covering the current partial month and 24 future months;
  previous/next controls and a month/year selector, remembered per sample.
- One estimated date per regular salary, bill or renewal. No multi-day windows,
  irregular payments, one-off costs or buffer-risk overlays.
- Click a day to open every payment on that date (including payments hidden by
  the month filter); click a payment for amount, cadence and supporting IDs.
  Back and Escape restore the appropriate list/focus. Empty dates are explicit.
- Separate customer/sample selection: CUST00003's regular payday on the 15th,
  CUST00005's history with inconsistent dates omitted, a fictional recurring
  ledger, and the team's named subscription demo. These are not combined with
  Home's illustrative balance or Goals' separate example.
- Refresh keeps the selected month. Failed requests keep the previous customer's
  label and values together. Browser storage is optional.

`GET /api/calendar?source=regular|engine|recurring|subscriptions` serves generated
schema 2.0 JSON. Each event has `date == earliestDate == latestDate`. Financial
amounts and scheduling originate in Python or supplied subscription schedules;
the browser only formats amounts, filters dates and renders evidence.

Optional live connection: set `FINANCIAL_ENGINE_URL=http://127.0.0.1:8765` and
restart Node. The Python service must run the **schema 2.0 calendar upgrade** on
[feat/planning-coach](https://github.com/timursdobrovolskis-cyber/junction-hackathon/tree/feat/planning-coach).
The older calendar at `47b7b64` returns windows and is intentionally rejected.
Both bank-data samples are recalculated using server-selected customer/cutoff
inputs; demo ledgers remain explicitly labelled saved examples. The Python API
supports any customer in its database; an authenticated app should supply that
customer from its server session rather than use this demo selector.

The main subscription fixture has no owner. Its Netflix/Spotify/iCloud/gym/Adobe
schedules are therefore shown under `SUBSCRIPTIONS-DEMO`, not assigned to a bank
customer. Customer-scoped subscription schedule and cancellation integration is
available in the Python adapter, but the React demo's local cancellation state
is not connected to this static UI. This calendar is not a live bank/provider
connection and does not move money, confirm contracts or recalculate plan costs.

Full scheduling rules, backend interface and fixture regeneration:
[backend integration guide](https://github.com/timursdobrovolskis-cyber/junction-hackathon/blob/feat/planning-coach/docs/financial-calendar.md).

## Checks

Run `npm test` here: 57 checks including the team's Coach/Goals tests and calendar
API validation, date boundaries, isolation, exact-day filters and yearly
subscriptions. Browser checks cover 320/390/1024px layouts, date and evidence
dialogs, Escape/focus restoration, February 2028, reload persistence, all four
sources and failed refreshes. No live Gemini requests are needed.
