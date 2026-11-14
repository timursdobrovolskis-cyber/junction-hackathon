# Cash-flow forecast baseline

Model `calendar-scenarios-v1` estimates the next 30 end-of-day balances for one customer. It uses the prepared bank history and profile engine. It is a deterministic historical baseline, not a trained machine-learning model. Savings and budget recommendations are separate future stages.

This document describes the retained v1 baseline. The newer [income v2 and savings workflow](INCOME_AND_SAVINGS.md) adds a trained payday model, calibrated bounds, and conditional savings previews. [Category budgets](CATEGORY_BUDGETS.md) now add adjustable limits and conditional balance previews.

## Run and integrate

After [preparing the bank data](README.md), run:

```sh
python3 scripts/forecast_cash_flow.py --as-of 2026-09-30 --customer-id CUST00001 --customer-id CUST00002 --customer-id CUST00003 --output fixtures/cash-flow-demo.json
python3 -m unittest discover -s tests -v
python3 scripts/evaluate_cash_flow.py
```

The first command produces [three synthetic forecast examples](../fixtures/cash-flow-demo.json). They use the export's last observed date, 2026-09-30; October is a projection with no actual outcomes available in the export. Use the replay script to measure predictions at earlier dates.

For a single customer, repeat the forecast command with one `--customer-id`. `--horizon-days` supports 1–90 days and defaults to 30. `--buffer-cents` defaults to zero: below-buffer flags then mean a projected negative balance. A different buffer is an explicit input, not a learned personal recommendation. Output defaults to `data/local/forecasts.json`.

Python integration:

```python
from src.cash_flow import forecast_cash_flow

result = forecast_cash_flow(transaction_rows, customer_id, "2026-09-30")
```

`transaction_rows` contains the prepared database columns. The function filters by customer and cutoff itself. The CLI also queries only eligible history. The read-only database remains unchanged. The forecast JSON wrapper records the source revision and hashes for reproduction.

## What the UI and coach receive

| Field | Use |
| --- | --- |
| `status` | `estimated`, `needs_review`, or `insufficient_history`. With insufficient history, `daily` is empty: do not display a zero-valued forecast. |
| `startingBalanceCents`, `accounts` | Last observed balances and dates of the accounts covered. |
| `daily` | Future date, expected balance, expected net change, and lower/upper historical-scenario balances. The first day is the day after the cutoff. |
| `lowestExpectedBalance` | Lowest central estimate and its first date in the future window. |
| `lowestScenarioBalance` | Lowest amount across the historical scenarios and its first date. This is not a guaranteed floor. |
| `endingExpectedBalanceCents` | Expected balance on the final forecast date. |
| `upcomingPayments` | Estimated recurring inflow/outflow groups with date windows, amounts, scope, and evidence. These amounts are already included in `daily`; never deduct them again. Utilities can be a monthly group containing several providers. |
| `belowBufferDates` | Dates when the central estimate is below the supplied buffer. |
| `possibleBelowBufferDates` | Dates when at least one historical scenario is below the buffer. This is a broader signal with more false alarms. |
| `startingBalanceBelowBuffer` | Whether the current observed balance is already below the buffer; separate from the future minimum. |
| `scenarioPaths`, `sourceMonths` | Six or fewer historical paths and the months behind them, for inspection and uncertainty displays. |
| `suppressedAlreadyObservedMonthlyGroups` | Single-payment monthly groups already observed this month and therefore excluded from another payment in the remaining month. |
| `warnings`, `evidence` | Assumptions and supporting source transactions. Evidence covers payment annotations and opening balances; the database contains the full history behind everyday spending. |

Show the central line alongside the historical-scenario range and a visible “estimate” label. Upcoming groups are not confirmed payments (`isConfirmed: false`). A category aggregate is not an identified company. In the initial UI, prioritize the lowest expected balance, its date, and the next estimated bill/income windows.

## How the baseline works

1. Build the customer's profile using only observations through the cutoff. Take up to six complete recent months, excluding the first observed month and an incomplete current month. Require at least three complete months for every visible account.
2. Treat each complete month as a separate scenario, including months with zero activity. Map its signed transactions onto future calendar dates. Clip days that do not exist in the target month. For profile-detected month-end payments, preserve the offset from the end of the month.
3. Keep all cash movements, including investments, salary sweeps, and unknown types. Transactions are replayed once; recurring group annotations do not add separate deductions. Starting balances come from the latest observed bank balances.
4. If a detected single-payment monthly group has already occurred in the cutoff month, suppress another payment from that group in the remainder of that month. It can occur again in the next month. This avoids a second projected salary when payday moved earlier.
5. Accumulate each scenario's daily balances. The rounded mean is the expected balance; the minimum and maximum form the displayed historical-scenario envelope. Expected daily net changes reconcile exactly with the central balance path.

All monetary results are integer euro cents. Within a multi-month forecast, each scenario repeats the same source month across target months. Longer horizons therefore require more caution; the measured evaluation currently covers 30 days only.

## Limits and next modeling work

- The range is an empirical envelope of recent months, not an 80%/95% confidence interval or a guarantee. Its measured coverage is reported separately.
- Variable payday scenarios can make the average path look like income arriving in installments. Show the uncertainty and payment window; do not present the mean path as a promised schedule.
- Calendar mapping can omit income expected earlier in the current month if it has not actually arrived. It does not invent a catch-up payday. Multiple-payment groups do not yet match each actual utility payment to a specific forecast bill.
- Recent partial-month spending is included in the opening balance but does not retrain the historical templates. New habits, salary changes, future seasonal expenses, and external commitments may not be captured. Historical large purchases can recur in a scenario even when they were one-off; they are not asserted to be obligations.
- Forecasts are total observed end-of-day balances. They do not guarantee liquidity within a day or in each individual account. Stale accounts and unclassified flows produce `needs_review`.
- No new savings transfer should be called affordable solely because the mean forecast stays positive. Future savings logic must account for forecast errors, buffers, uncertain income, and costs beyond 30 days.

See [the evaluation report](FORECAST_EVALUATION.md) for measured errors and the next modeling priority. Improvements should be chosen using development results and then assessed on an untouched later period/customer set. Do not repeatedly tune on a reported holdout and continue calling it unseen.
