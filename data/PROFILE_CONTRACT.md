# Customer financial profiles, version 1.0.0

The profile is a historical description of one customer's visible accounts. It provides income timing, recurring payment groups, category spending, large expense candidates, cash movements, and transaction evidence. It does not yet calculate a forecast, affordable savings, or recommended budgets.

The separate [cash-flow engine](CASH_FLOW_CONTRACT.md) now consumes this profile logic and the underlying transaction history to produce 30-day baseline forecasts.

## Run

Prepare `data/local/bank.sqlite` using [the download and import instructions](README.md), then run from the repository root:

```sh
python3 scripts/build_profiles.py --as-of 2026-09-30
python3 -m unittest discover -s tests -v
```

This writes one JSON object per line to `data/local/profiles.jsonl` and a source manifest to `data/local/profiles.audit.json`. The full outputs remain local and are ignored by Git. The database is opened read-only. Output replacement happens only after generation succeeds.

The default cutoff is the last transaction date in the export, not the computer's current date. A later cutoff is rejected because the export cannot establish what happened after its end. For historical replay:

```sh
python3 scripts/build_profiles.py --as-of 2026-06-15 --customer-id CUST00001 --output data/local/june-profile.jsonl
```

The profile calculation itself also filters out transactions after the cutoff and transactions belonging to another customer. `--lookback-months` defaults to 12; recurring patterns use the last six complete months within that window. A customer with no transactions by the cutoff returns `status: "no_history"`; fewer than three complete months returns `"limited_history"`. `"ready"` means enough history for these descriptive calculations, not that a forecast has been validated.

Three synthetic examples are available in [customer-profiles.jsonl](../fixtures/customer-profiles.jsonl). Regenerate them with:

```sh
python3 scripts/build_profiles.py --as-of 2026-09-30 --customer-id CUST00001 --customer-id CUST00002 --customer-id CUST00003 --output fixtures/customer-profiles.jsonl
```

JavaScript consumers can read JSONL using `text.trim().split('\n').map(JSON.parse)`. Python callers can use `from src.financial_profile import build_profile` and pass transaction dictionaries with the prepared database columns, customer ID, and an ISO cutoff date.

## Fields for the team

| Field | Meaning |
| --- | --- |
| `schemaVersion`, `customerId`, `asOf`, `currency` | Versioned identity and observation cutoff. Currency is EUR. |
| `coverage` | Complete months used, first/last observed dates, and row counts. |
| `accounts`, `observedBalanceCents` | Latest observed balance per account and their sum; each account includes its balance date and evidence. This is not a confirmed real-time bank balance. |
| `income` | Positive salary and other-income monthly totals, median, observed range, median absolute deviation, and separate totals by type. Investment withdrawals are excluded. |
| `consumption`, `categorySpending` | Historical expense magnitudes, including zero-activity months. All amount fields ending in `Cents` are integers or null when there is insufficient history. These are observed spending levels, not budget recommendations. |
| `recurringPatterns` | Account/merchant/type/category groups with repeated monthly activity, typical active-month totals, observed payment amounts, timing, and evidence. |
| `irregularExpenseCandidates` | Up to ten largest qualifying historical purchases to inspect. Not confirmed future obligations. `irregularExpenseCandidateCount` gives the uncapped total. |
| `accountMovements` | Investment deposits, withdrawals, and salary sweeps retained separately from income and consumption. |
| `monthlyCashFlow` | All observed cash inflows/outflows and net change, including movements and unknown types. |
| `evidence` | Referenced source transactions with signed amounts. `evidenceIds` resolve here. Samples support inspection; they are not every row used in an aggregate. |
| `warnings`, `unclassifiedTransactionCount` | Coverage assumptions and inputs needing review. |

The forecast should use these inputs alongside the original history. Keep recurring payments within their category spending totals: adding both independently would double-count expenses. The coach can explain supported observations now; it must wait for the calculation engine before presenting an amount as affordable savings.

## Baseline rules and limitations

- The first observed calendar month is conservatively excluded from monthly statistics because account coverage may have started mid-month. An unfinished cutoff month is also excluded. Its transactions still update observed balances and history coverage. Later full months with no activity count as zero; this assumes continuous export coverage. Stale accounts and accounts first appearing during the analysis window get warnings.
- Monthly medians include zero months. Observed minima/maxima are historical ranges, not prediction intervals. Monetary medians round a half cent upward using integer arithmetic.
- A recurring candidate needs activity in at least three months and at least two-thirds of the last six complete months (or the shorter available window). Its last payment must be within 62 days of the cutoff. Missing the latest complete month sets `needs_confirmation`. Patterns that disappeared earlier are not presented as active; their spending remains in historical totals.
- Salary, housing, utilities, and account movements can be grouped without merchant IDs. Their scope explicitly says `account_type_category_aggregate`. Multiple utility payments do not become invented individual providers or one exact payment date.
- A timing window is produced only when there is one payment per active month and every observed payment is within the final four days of its month, or the observed day numbers span at most six days. Otherwise timing is variable. The day histogram remains available to the forecast. Weekly, fortnightly, and annual recurrence are not detected by this monthly baseline.
- Merchant purchases require one payment per active month, consistent timing, and an amount range no wider than the larger of EUR 1 or 10% of the median. Even then they are called repeated merchant payments, not confirmed subscriptions. Missing merchant IDs cannot establish a purchase subscription.
- `evidenceStrength` is strong at five or more active months with no missing latest month; otherwise it is limited. It measures support for repeated activity, not accuracy of amount or date predictions. Variable salary dates can coexist with strong monthly recurrence.
- A large expense candidate is a purchase of at least EUR 100 and at least three times the median transaction amount in its category. This deliberately broad review heuristic is not a customer alert or evidence of a financial problem. No annual expense prediction is claimed.
- Salary sweeps have unknown destinations. Investment movements and sweeps change cash and cannot simply disappear from the future forecast or be counted as newly affordable savings. Unrecognized and reversed flows remain in cash totals and are flagged for classification.
- No demographics are used to infer needs, goals, risk tolerance, or life stage. These descriptive profiles use rules applied to synthetic transaction history. A separate [income model](INCOME_AND_SAVINGS.md) now learns payday transitions for forecasting.

## Verification on the sponsor export

Using cutoff 2026-09-30, the full run produced 5,100 profiles with sufficient historical coverage. It found 9,673 recurring bill groups, 5,080 income patterns, and 1,747 account-movement patterns. These are detected groups, not confirmed providers. There were no purchase groups meeting the strict recurring-merchant rules.

Of these profiles, 3,743 had a detected salary pattern with variable timing, 37 had a negative latest observed balance, and 4,784 contained at least one large-purchase review candidate. These figures describe the synthetic export, not real-world prevalence. They also show why large-purchase candidates need filtering before becoming customer-facing messages.

All 5,100 outputs passed checks that evidence references resolve and respect the cutoff, monetary outputs remain integers, account balances sum correctly, monthly cash inflows minus outflows equal net change, and category totals reconcile to consumption. There were zero unclassified transactions in the analysis windows.

The unit suite checks future-data isolation, customer isolation, zero/partial months, transfer handling, missing merchant aggregates, variable and month-end income timing, missing recent bills, sparse history, unknown transaction types, account balance ordering, and large-expense evidence. Forecast accuracy will be measured separately when the forecast engine is built.
