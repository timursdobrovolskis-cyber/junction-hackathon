# Historical data in the coach

Run `npm run demo:history` to see advice calculated from 218 transactions for
`CUST00001` and `CUST00002`, selected from the organizer's synthetic S-Bank dataset.
The example covers June–September 2026; its reference date is **2026-10-01**.
These are historical synthetic records, not live November balances or real customers.

## What the coach learns

- Recorded income, gross consumption, refunds, and net consumption by complete month.
- Each category's latest complete month compared with the mean of up to three preceding complete months.
- Income changes and the observed monthly income range/median, including zero-income months inside declared coverage.
- Whether the latest month's recorded consumption after refunds exceeded recorded income.
- The minimum observed post-transaction balance for each account separately.

Every actionable observation includes source transaction IDs. The coach describes the
change and asks the customer to inspect it; it does not invent a reason for it, infer
priorities from age, or treat a lower bill total as money now available to spend.
Recurring-payment prediction remains the data teammate's signal handoff.

A recent income decrease or spending above recorded income takes precedence over a
new savings experiment. These findings prompt a review of assumptions. Historical
averages do not silently replace the forecast or create a savings contribution.
Category changes and historical summaries can appear without requiring a goal.

## Input contract

```js
import { createCoachAction } from './src/planning.mjs';

const card = createCoachAction({
  customerId: 'selected-customer', currency: 'EUR', asOf: '2026-10-01',
  dataSource: 'historical_bank_data', missingInputs: [],
  assumptions: ['Historical replay; coverage checked by the data adapter.'],
  transactionHistory: {
    startDate: '2026-06-01', endDate: '2026-09-30',
    transactions: [/* normalized customer-scoped rows */],
  },
  categoryPreferences: [
    // Explicit customer choices, not automatic classifications by category name.
    { category: 'Restaurants', basket: 'everyday', adjustable: true },
  ],
});
```

Each normalized row has `id`, `customerId`, `accountId`, `date` (`YYYY-MM-DD`),
`category`, `kind`, and signed integer `amountCents`. `balanceAfterCents` is optional.
Supported kinds are `income`, `expense`, `refund`, `transfer`, `savings`, `investment`,
and `other`. Income/refunds must be positive; consumption expenses must be negative.
Rows for another customer, duplicate IDs, invalid dates/amounts, and rows outside the
declared history coverage are rejected. The data service must enforce access control
and scope queries before calling this pure calculation module.

Dates after `asOf` never contribute to analysis. The current reference month is
excluded even when `asOf` is its final day; move to the following day to analyze it.
The default lookback is six calendar months before the reference month. Only months
fully covered by `startDate`/`endDate` enter comparisons. A partially covered first or
last month is not compared with a full month. Missing recent coverage is disclosed.

Coverage must be declared honestly by the adapter. A period with no transactions
counts as zero only inside coverage that the adapter declares complete. The engine
cannot detect missing accounts or a truncated source simply by inspecting rows.

`analyzeTransactionHistory` from `src/history.mjs` can also be called directly with
`{ customerId, asOf, history, categoryPreferences }`. Its optional second argument
configures `lookbackMonths` (2–24), `baselineMonths` (less than lookback),
`minChangeCents` (default €20), and `minChangePercent` (default 20%). A change must
meet both thresholds to become an insight. These are transparent display thresholds,
not calibrated confidence scores. All category comparisons remain available in the
result even when they fall below the thresholds.

## Refunds, financial movements, and customer corrections

Refunds reduce consumption in the month they are recorded. They are not salary and
are not matched to an original purchase unless the upstream data provides that link.
Transfers, savings movements, investment deposits/withdrawals, and unknown movements
are excluded from consumption and income totals. Unknown movements are counted and
flagged for review. Income less consumption is not a claim about realized savings.

History-derived budgets are produced only for categories with explicit preferences.
Their baseline uses **gross consumption**; refunds are reported separately and are
not assumed to recur. Other categories still receive factual historical comparisons.
Essential and non-adjustable categories never automatically receive a reduction.
When both inputs exist, explicit `spendingHistory` aggregates and classifications take
precedence over history-derived budget rows/preferences. The delivery opt-out also
applies to history-informed suggestions and previews.

## Outputs for the app and future explanation model

The coach's normal action now optionally includes `historicalAnalysis` containing:

- `monthly`, `categoryComparisons`, `incomeSummary`, and `observedBalances`.
- `insights`, each with calculated amounts, dates, explanation, suggested action, and evidence IDs.
- `coverage`, `method`, `dataQuality`, and `limitations`.
- `spendingHistory` containing eligible derived budget rows.

New card kinds are `review_history`, `history_summary`, and `insufficient_history`.
Render the action's evidence references using the selected customer's evidence
resolver. Show source dates and limitations alongside the figures. A future LLM can
explain selected structured insights; do not send the full bank dataset as context.
The current explanation remains a deterministic template, not an LLM response.

Observed balance minima are per-account, post-transaction observations. They are not
daily closing balances, not a consolidated minimum, and not the future weakest day.
Missing balances remain missing; no value is filled in. No forecasting accuracy or
causal explanation is claimed from these descriptive statistics.

## Verified S-Bank source and adapter

Source: https://github.com/hackjunction/Junction-2026-S-pankki

The organizer currently calls the file `tx_junction_transactions.csv`, rather than
the `.txt` name in the initial brief. It has a UTF-8 BOM and is stored in Git LFS.
The full source was checked while implementing this feature:

- 3,626,755 records, with observed dates 2024-10-01 through 2026-09-30.
- SHA-256: `49b3265d8e44e751de305a074dcffcda732bb79aa1e07b46fcca774ce76f1e63`.
- `salary`/`other_income` → income for positive amounts.
- `purchase`/`housing_payment`/`utilities_payment` → consumption for negative amounts, refunds for positive amounts.
- `investment_deposit`/`investment_withdrawal` → investment movements.
- `salary_sweep` → transfer; unsupported or conflicting classifications → other.

`src/sbank.mjs` parses decimal euro strings without floating-point multiplication.
It preserves merchant identifiers when available and never invents merchant names.
The source has no transaction ID column, so evidence IDs combine the source checksum
with the logical CSV row number (header = row 1). Source timestamp/type are retained.
The caller supplies the checksum/row mapping; normalization does not independently
download or reverify the full file on each invocation.

## Use another customer without loading millions of records into the coach

Download the **actual CSV** from the organizer repository's **Download raw file**
button. A three-line file beginning `version https://git-lfs...` is only a pointer.
Then run this optional Python 3 standard-library extraction script:

```sh
python3 scripts/extract-sbank.py /path/to/tx_junction_transactions.csv \
  --customer CUST00001 CUST00002 \
  --from-date 2026-06-01 --to-date 2026-09-30 \
  --output work/customer-history.json

npm run demo:history -- work/customer-history.json
```

The script hashes and scans the local CSV, keeping only the requested customers and
dates in memory. It preserves source row numbers, rejects a Git LFS pointer/missing
schema, and sets the reference date to the day after the requested window. A window
outside the source's observed dates or a customer with no matching rows is rejected.
Source dates alone do not establish complete coverage of every account; the adapter
owner remains responsible for that claim. The full 363 MB source is not committed.
The bundled small extract is reproducible with the command above.

Tests cover source-derived financial totals independently cross-checked using Python
Decimal, signed movements/refunds, no future-data leakage, incomplete coverage,
multiple accounts, customer isolation, evidence references, and protected spending.
