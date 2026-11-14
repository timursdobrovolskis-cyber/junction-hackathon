# Integrated team app

## Sources

- Conversation mechanism: `feat/planning-coach`, commit `47b7b64` (two source modules copied unchanged into `server/conversation/`).
- Calendar: `feat/financial-calendar-ui`, commit `99b74c2` (API, fixtures, browser model/UI and tests reused).
- Short/long-term goals: `main`, commit `d92fa78` (original goal calculation and fixture under `server/goals/`; React presentation adapted to the existing static UI).
- Shared frontend: `codex/frontend-coach-preview`.

## Run and deploy

Use Node 22+ and `npm run dev` inside `ui-skeleton`; open `/preview.html`. `npm test` runs all 56 checks. Deployment remains the existing `junction-money-ui` Vercel project with server-only Gemini configuration. Git pushes do not deploy automatically.

## Navigation

Home → Goals → Calendar → Coach. One phone frame, one navigation, S-Pankki visual styling. The original React app on main and the teammate branches are not overwritten.

## What works

- Short-term trip projection: €270 before a €60 repair, €210 after it, €240 if three €10 delivery reductions are followed. Evidence and planned contributions can be inspected. Saved money remains €150 throughout.
- Long-term illustration: editable contribution, 2–40 years and return assumption; zero and negative returns supported. It is not a product prediction or an assessment of affordable contributions. No real transfers, round-ups or investment actions are switched on.
- Calendar: month navigation, cost/income/yearly filters, estimated payment windows, recurring candidates, daily balances within forecast coverage and source transactions. These are not verified subscription contracts; no cancellation feature is claimed.
- Coach: teammate state machine for goals, priorities, buffers and dated expenses; explicit confirmations; Gemini explanations; browser-local conversations and uncalculated drafts isolated by sample profile.

## Remaining integration boundary

The screens still use separate sample profiles/periods. Home is a November design plan; Goals is a fictional trip/contribution sample; the main Calendar and historical Coach view use CUST00005 through September, and calendar recurring mode uses a separate fictional ledger. Do not combine their values as one customer's finances. Data provenance stays in the sample-data information and details panels.

A chat draft does not recalculate Home, change the goal fixture or save to Python's durable plan service. Deploy/connect that service, select one shared customer, validate draft-to-engine category and date mapping, show a calculation preview, and require explicit selection before saving. The existing purchase-preview UI still awaits this same connection.

## Checks

56 automated tests pass across conversation behavior, Gemini/API boundaries, calendar fixtures/filtering/errors and goal arithmetic. Browser checks cover corrected-goal confirmation, local reloads, profile isolation, live Gemini explanations, short-term recovery and a 0% long-term illustration (€50/month for 10 years = €6,000), calendar yearly filtering and transaction evidence.

## Account-backed coach update

Home, Coach and the main Calendar now share synthetic customer CUST00005 and the existing financial-engine snapshot. Home displays the observed account balance (€6,466.14, last observed 28 September), not an invented safe-to-spend amount. The October spending plan and unconfirmed savings target are shown separately. Goals and the optional recurring calendar remain separate samples. The coach is not connected to a live bank feed.

Four suggestion cards open server-grounded spending, bills and savings answers or the expense capture flow. Account answers use the supplied calculation figures and evidence, with no language-model arithmetic. Open-ended Gemini responses use a validated JSON structure: title, summary, up to three bullets, nextQuestion. The UI renders these as text blocks; numeric account metrics come from server data. The Ideas button reopens suggestions without clearing state.

Available: read the account snapshot, explain forecast/payment evidence, draft goals/expenses/priorities, confirm draft changes. Unavailable: live bank synchronization, recalculation from chat, backend plan saves, transfers and subscription cancellation. Drafts remain browser-local. Account cards and structured draft flows work even when Gemini is unavailable; open-ended replies then show an explicit error.

Verification: 61 automated tests and live structured Gemini output. Home/Coach identity and observed balance match; payment evidence resolves to the account fixture; pending confirmations survive account questions; malformed structured replies are rejected. Browser checks include card replies, Ideas reopening, restored conversation layouts and compact-phone overflow.

Structured output reference: https://ai.google.dev/gemini-api/docs/structured-output ; the configured generateContent responseMimeType/responseJsonSchema was verified with the live provider.
