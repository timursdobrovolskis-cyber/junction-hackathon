# Historical transaction answers in the phone coach

The phone app is `ui-skeleton/`; the root Vite prototype is unchanged. Before this
change, origin/main e069da2 matched the deployed preview, phone HTML, Coach/Budget
scripts and Goals entry. Work starts on `feat/coach-ledger-history`.

## Data and routing

`server/transaction-history.mjs` uses the same `activity` export and spending
classification as Budget. The ledger contains 430 transactions for CUST00005 /
ACC000005, covering October 2024–September 2026. The original rows, amounts, dates,
IDs and coverage remain unchanged. Only `merchantId` was added from the original
validated SQLite database. Reproduce with:

```sh
python3 ui-skeleton/server/budget/build-fixture.py --database /path/to/bank.sqlite
```

`conversation.mjs` routes recognised historical reads before plan/purchase or
Gemini answers. Queries scope customer/account, date range and category/merchant;
code computes integer-cent totals, refunds, rankings and evidence. These answers
need no Gemini call, and no full ledger is sent to the model. API `history` remains
chat text, not transaction data. Request-supplied customer IDs, ledgers and totals
are ignored; the selected scenario fixes the customer. Design-profile history is
unavailable. Invalid/foreign account rows and duplicate IDs fail closed.

Replies appear in the existing chat format, without section links or interface
changes. Pending confirmations and drafts survive a historical read unchanged.
Forecasts, October demo replay and proposed budgets never count as actual spending.

## Semantics and limits

- “Last month” uses Coach's existing scenario date: 30 September 2026 for the
  historical profile, so it means **August 2026**. Answers name the month.
- English month names (optional year), YYYY-MM, ISO dates and ISO date ranges are
  supported. A missing/ambiguous period gets one question; a simple month reply
  can resolve it. Comparisons require selecting one period first in this version.
- Spending and ranked spending payments follow Budget: purchases, housing and
  utilities; income, transfers and investments are excluded. Refunds are separate.
- No-overlap periods are unavailable, not zero. Partial periods identify their
  observed range and never claim a full-month total. A complete, empty category
  can legitimately total zero (September 2026 groceries is one such example).
- Merchant matching is exact and case-insensitive after punctuation/space
  normalization. No fuzzy mapping from a category to a retailer is performed.
- **Sponsor data has anonymous merchant IDs, with no retailer-name mapping.**
  “Lidl” therefore receives an explanation and a useful clarification, not a
  fabricated total. Name lookup works when a future verified ledger supplies
  `merchantName`. Merchant-ID queries work now. Missing merchant identifiers make
  matched totals identifiable amounts, not a claim of complete merchant coverage.
- Rankings are capped at ten; evidence at twelve rows. Totals include all matched
  rows. This is a single synthetic customer, not authenticated bank integration.

## Verification

```sh
npm --prefix ui-skeleton test
COACH_TEST_URL=http://127.0.0.1:4174 python3 ui-skeleton/scripts/check-coach-history.py
```

Tests reconcile every month/category against Budget, use the source database's
October 2024 groceries total (€551.27), verify refunds and merchant IDs, verify
September's top three (€2,151.08), and cover missing/partial periods, foreign
customers/accounts, duplicate evidence, relative dates and draft preservation.
Named-Lidl test rows are unit-test-only, not added to the production fixture.
Browser checks require Python Playwright and Chromium at `/usr/bin/chromium`.

Try:
- “How much did I spend on groceries in October 2024?”
- “What did I spend at Lidl last month?”
- “Show my three biggest payments in September.”

Release only `ui-skeleton/` from clean, latest main via its guarded deploy script.
