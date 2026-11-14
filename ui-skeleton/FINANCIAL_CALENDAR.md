# Calendar UI: recurring payments on exact dates

This branch builds on the team's integrated frontend (including Goals and Coach).
Run `npm run dev` inside `ui-skeleton` and open
http://127.0.0.1:4174/spendvest.html#calendar. `PORT=4176 npm run dev` chooses another
port. No Gemini key or Python service is needed for the saved calendar samples.

- Day, week and month views covering the current partial month and 24 future months;
  previous/next controls and a month/year selector, remembered per sample.
- One estimated date per regular salary, bill or renewal. No multi-day windows,
  irregular payments, one-off costs or buffer-risk overlays. Monthly bills can
  vary by up to six days; the Python engine supplies the median date and
  observed range. Repeated merchant purchases are labelled possible subscriptions.
- Click a day to open every payment on that date (respecting the selected
  categories); click a payment for amount, cadence and supporting IDs.
  Back and Escape restore the appropriate list/focus. Empty dates are explicit.
- Separate customer/sample selection: CUST00003's regular payday on the 15th,
  CUST00005's housing and spending trend, a fictional recurring
  ledger, and the team's named subscription demo. These are not combined with
  Home's illustrative balance or Goals' separate example.
- Refresh keeps the selected month. Failed requests keep the previous customer's
  label and values together. Browser storage is optional.

`GET /api/calendar?source=risk|regular|engine|recurring|subscriptions` serves generated
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

Run `npm test` here: 83 checks including the team's Coach/Goals tests and calendar
API validation, date boundaries, isolation, exact-day filters and yearly
subscriptions. Browser checks cover 320/390/1024px layouts, date and evidence
dialogs, Escape/focus restoration, February 2028, reload persistence, all five
sources and failed refreshes. No live Gemini requests are needed.

## Alerts and Google Calendar

Tappable cards below the month grid show spending increases, repeated recorded
income shortfalls, engine buffer risks and bills needing due-date clarification.
Details include exact monthly figures, supporting transactions, a suggested next
step and the analysis cutoff. No alert changes a plan or extrapolates a balance.

CUST00003 now shows housing near the 3rd as well as salary on the 15th. Its utility
payments have no stable individual provider/date and are explained in a card.
CUST00005 shows housing plus a warning about purchase spending increasing over
July–September (€798.74 → €995.48 → €1,284.19). No named subscription is invented
for these bank-data customers; matching merchant histories appear as candidates.

The Connect to Google Calendar button opens a dialog with an Add-in-Google link,
copyable subscription URL and `.ics` download. Confirm Add in Google; if needed,
use Other calendars → + → From URL in the desktop browser. A URL subscription
refreshes at Google's chosen intervals; a downloaded file is a fixed snapshot.
Changing this app's sample does not remove a calendar already added in Google.

`GET /api/calendar-feed?source=risk|regular|engine|recurring|subscriptions` is a public
feed of the bundled synthetic sample only. It exports tentative all-day names
and dates with stable IDs; no amounts, account balances or transaction IDs.
Live-engine sample sources disable export and return 409 from the feed. Real
private data needs authenticated, revocable feeds or Google OAuth. The sample
feeds change when refreshed fixtures are published, not from a live bank feed.

The latest integrated Home/Coach work through 5cbd9a0 is preserved. Feed tests
cover source isolation, private-data blocking, stable UIDs, next-day dates,
Unicode folding, CRLF escaping and header behavior. Browser checks cover bill
details, warning metrics/evidence and the Google link/download flow. Actual Add
inside a user's Google account is not automated or claimed as tested.


## Unified calendar views

Day, Week and Month share a selected date and checkbox selection. Navigation
moves one day, seven days or one month respectively, with Monday-first weeks and
coverage boundaries. The month selector becomes an exact-date picker in day/week
views. Clicking a grid date opens only payments matching the current checkboxes.
Income, Bills, Subscriptions, Yearly renewals and Alerts start selected. Yearly
renewals form their own group, so unchecking monthly Subscriptions does not hide
an independently checked annual renewal. The separate legend and old filter
buttons are removed. Selections persist per sample under calendar-v3 storage.

The old data selector is inside Calendar details & example data; it never mixes
customers. New visitors initially see the labelled Spending-pressure demo. This
fictional RISK-DEMO household has €900 starting cash, €1,200 housing and €2,400
salary near the 28th; growing purchases reduce its reserve. The Python engine
produces a first negative central estimate of −€300 on 3 November, before
the next estimated salary on 28 November. The warning and details explicitly identify invented
data. Its amount is an engine result, not hard-coded frontend financial math.
The fictional warning is never assigned to CUST00003 or CUST00005. Google exports
prefix this scenario's event titles with DEMO and identify fictional data.

Warnings now use a rose-red palette. Ambiguous utility-date cards are hidden in
this UI; their source explanation remains in Calendar details and the backend
contract. Recorded utility transactions and forecast costs are not deleted.
The Alerts checkbox controls the notification section in all three views.

## Fuller household and compact navigation

The fictional household combines Netflix (€15.99 on the 21st), Spotify (€11.99
on the 25th), iCloud+ (€2.99 on the 19th), gym (€29.99 on the 28th), rent,
electricity, internet, phone and water. Annual home insurance is on 20 November;
Adobe is on 3 March. These named merchants belong only to RISK-DEMO. Historical
transactions support every reminder. November has 11 reminders; dates remain
estimates and irregular restaurant purchases are excluded from the calendar.

Day/Week/Month stay visible. Filters & dates opens the checked categories,
month/date jump, first-date and refresh controls. It closes on a date selection,
outside click or Escape. Google Calendar is alongside it. Grid cells show short
payment names and a count for shared dates; tapping shows every selected payment.

The page previews three payments. All payments opens the complete filtered period
in a dialog, with detail/back navigation. The rose warning is immediately below
the grid, before the list. Its detail shows €900 cash on 31 October, estimated
€1,200 rent on 3 November and €2,400 salary on 28 November. The engine's €300 gap
is the first shortfall, not the later maximum deficit. No action moves money.

Optional `monthSummaries[YYYY-MM]` fields (`incomeCents`, `outflowCents`,
`paymentCount`) are computed in Python after event deduplication. Monthly totals
include all scheduled categories, even when hidden, and exclude irregular
spending; they are not a disposable-income or affordability forecast. Missing
summaries are hidden for compatibility. Warning `timeline` entries contain date,
label, nonnegative amountCents and direction (balance/inflow/outflow).

For the browser regression, install Python Playwright and Chromium, run the dev
server, then `CALENDAR_TEST_URL=http://127.0.0.1:4174 python scripts/check-calendar.py`.
It covers named renewals, short preview/full list, warning timeline, source
isolation, filters/reload, 320/390/1024px widths, Google download and Budget.
