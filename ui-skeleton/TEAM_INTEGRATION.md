# Production source: main

The production app is `ui-skeleton/` on **main**. Merge frontend changes into
main before publishing. Run `npm run deploy` inside ui-skeleton; it verifies a
clean checkout at exactly origin/main, runs tests, and deploys the whole app.
Git pushes alone are not a claim that the website has been updated.

On 14 November, a production deployment from feat/phone-app included newer Goals
and Coach but an older calendar. The deployed HTML and calendar module matched
that branch byte-for-byte. The integration now preserves those newer screens and
restores the current calendar, its personal events, fixtures, API and Google feed.
The active phone-app branch also receives this calendar integration.

Deployments replace the complete website. The deploy command blocks stale/feature
checkouts; manual Vercel/dashboard releases can bypass it. Always use main for
production releases. This changes the source workflow, not team permissions.
The legacy /index.html entry redirects to the same /spendvest.html app.

---

# Current coach section access

The coach now reads Home, the selected Budget month, saved Goals and the selected
Calendar on every message. See [COACH_APP_CONTEXT.md](COACH_APP_CONTEXT.md) for the
contract, data boundaries, limitations and reproducible checks. The historical
integration notes below describe earlier releases; this document is the current
read-integration reference.

# Integrated team app

## Sources

- Conversation mechanism: `feat/planning-coach`, commit `47b7b64` (two source modules copied unchanged into `server/conversation/`).
- Calendar: `feat/financial-calendar-ui`, commit `99b74c2` (API, fixtures, browser model/UI and tests reused).
- Short/long-term goals: `main`, commit `d92fa78` (original goal calculation and fixture under `server/goals/`; React presentation adapted to the existing static UI).
- Production frontend: `main` (earlier iterations used `codex/frontend-coach-preview`).

## Run and deploy

Use Node 22+ and `npm run dev` inside `ui-skeleton`; open `/preview.html`. `npm test` runs all 102 checks. Deployment remains the existing `junction-money-ui` Vercel project with server-only Gemini configuration. Git pushes do not deploy automatically.

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

## Budget page and spending history

Home → Your budget → View all opens `#budget`. The October plan uses the same CUST00005 / ACC000005 budget as Home and Coach. `GET /api/budget?period=plan|history` supplies the view. Proposed category limits total €1,793.99. September actual spending totals €2,209.34; income and investment/transfer movements are excluded. Refunds are listed separately, not added to available budget.

The source export ends 30 September; no October actuals exist. `spentCents` and `remainingCents` are therefore **null**, never fabricated zeros. September is its own history view, never deducted from October limits. The calculation supports same-period posted spending, negative remaining amounts, unbudgeted categories, and partial coverage. Budget changes/recalculation are not enabled by this page.

`server/budget/activity.json` contains only seven synthetic September transactions for the selected account, exported from the prepared SQLite database by `python3 ui-skeleton/server/budget/build-fixture.py` from repository root. Do not package the full database. To wire a real account feed, supply matching customer/account identities, a trustworthy coverage start/end, all posted activity in that window, and the matching plan period. Keep missing coverage distinct from no transactions. Authentication and a live bank connection remain outside this prototype.
