# Coach access to app sections

Every coach message now includes the latest section selection and local entries.
The server adds the same Home and Budget data used to render those pages. Replies answer directly in chat with the relevant amounts, dates and progress;
they do not add section navigation buttons or hide answer paragraphs. This is read-only access: it does
not activate a plan, move savings or recalculate the forecast.

## Sources and boundaries

| Section | What the coach reads | Meaning |
| --- | --- | --- |
| Home | Server account snapshot, displayed daily amount, remaining everyday spending and baskets | CUST00005; the daily display is an October demo replaying historical spending, not a live affordability guarantee |
| Goals | Goal name, target, recorded savings, target date, completion, horizon and monthly savings preferences | Current browser-local entries; recorded savings are not verified bank balances |
| Calendar | Selected source, date/view, filters, matching events, evidence, personal reminders, deletions and warnings | Dates are estimates/reminders; different sample customers remain separate from Home |
| Budget | Selected month, category amounts, available activity and comparison | Server-owned amounts; missing activity stays missing |

Calendar defaults to the fictional RISK-DEMO household. Its payments and warnings
must not be combined with Home's account to judge affordability. The CUST00005
calendar can be selected explicitly. Personal event edits change the calendar
only; they do not change forecast totals, bank payments or the Google feed.

## Integration contract

`dist/app-state.mjs` supplies `collectAppState(customerId)` before each POST to
`/api/coach`. Section modules share their latest state; storage supplies Goals and
Calendar if those views have not been opened. The Goals iframe sends state only
to its own origin, and the parent accepts messages only from that iframe. The
planner and server use the same default `server/goals/planner-fixture.json`.

The optional request field `appState` has version 1 and the root customer ID.
`dist/app-context-contract.mjs` validates bounded goal entries, calendar source,
view/date/filter state, customer-scoped edits and the selected budget period.
Wrong-profile sections and malformed values are rejected. Design-profile chat
does not receive the CUST00005 sections. Arbitrary client balances or an incoming
`appContext` are never accepted as authoritative account data.

`server/app-context.mjs` constructs the read context from validated state and
server data. Calendar fetch failures are marked unavailable, not empty. Event
lists are bounded and marked when truncated; named payments and explicit dates
can narrow a question. Deterministic read replies work without Gemini, preserve
pending confirmations and return the answer as visible text. Goal advice uses the conversational model
instead of returning a canned goal inventory.
Open-ended Gemini replies receive the same context as untrusted user data, with
rules against treating titles as instructions or mixing sample accounts. No
financial forecast or savings arithmetic has been moved into the language model.

## Verify

Run `npm test` inside `ui-skeleton` (104 tests). With `npm run dev` running, use:

```sh
COACH_TEST_URL=http://127.0.0.1:4174 python3 scripts/check-coach-context.py
CALENDAR_TEST_URL=http://127.0.0.1:4174 python3 scripts/check-integration.py
CALENDAR_TEST_URL=http://127.0.0.1:4174 python3 scripts/check-calendar-controls.py
```

Browser checks require Python Playwright and Chromium at `/usr/bin/chromium`.
The context check creates/deposits/deletes a goal, adds/deletes a reminder,
switches calendar sources and verifies replies, reloads, direct visible answers without section buttons and mobile widths.
It uses an isolated browser context, makes eight coach requests and never changes
the engine plan. Allow for the existing 12-request/minute demo rate limit when
repeating it.

## Remaining limits

This remains a synthetic-account prototype without authenticated bank access.
Goals and personal calendar edits are local to the browser, not cloud-synced.
Reading them is not evidence of an affordable savings contribution. Chat drafts
remain separate from saved Goals; editing a goal/reminder still happens in its
section. Gemini explanations remain probabilistic; read routes provide exact
stored figures. Cross-section recommendations that need a new calculation still
require the engine connection and a confirmed recalculated result.
