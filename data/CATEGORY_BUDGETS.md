# Personalized category budgets

The budget engine turns the customer's projected spending into limits for the **next 30 days**. It keeps bills and protected categories, reserves an explicit savings target and future costs, and adjusts discretionary categories using the customer's spending proportions. Category edits recalculate a conditional daily balance preview. No money is moved.

## First examples for the coach and UI

- [Four customer budgets](../fixtures/budget-demo.json) include each `budget` and its `originalForecast`.
- [Before/after category adjustment](../fixtures/budget-adjustment-demo.json) shows CUST00005 increasing Entertainment from €195.09 to €205.09. Other discretionary allocations adjust; total spending stays €1,793.99, while balances between spending dates can change.
- [Adjustment input](../fixtures/budget-adjustment-preferences.json) is the JSON submitted back to the engine for that edit.

All demo plans use an **illustrative €500 buffer and €100 savings target**, with commitments and the target unconfirmed. These are explicit demo choices, not inferred recommendations for every customer. CUST00001 and CUST00002 are infeasible under these assumptions; CUST00003 fits its historical spending; CUST00005 needs discretionary reductions. Do not hide infeasible customers from the demo.

## Run

After preparing the bank database:

```sh
python3 scripts/generate_budgets.py --as-of 2026-09-30 --customer-id CUST00001 --customer-id CUST00002 --customer-id CUST00003 --customer-id CUST00005 --buffer-cents 50000 --savings-target-cents 10000 --output fixtures/budget-demo.json
```

To preview a category edit:

```sh
python3 scripts/generate_budgets.py --as-of 2026-09-30 --customer-id CUST00005 --buffer-cents 50000 --savings-target-cents 10000 --preferences-file fixtures/budget-adjustment-preferences.json --output data/local/adjusted-budget.json
```

Python integration:

```python
from src.category_budgets import build_category_budgets

plan = build_category_budgets(
    calibrated_forecast,
    buffer_cents=50000,
    savings_target_cents=10000,
    category_overrides={"Entertainment": 20509},
    savings_confirmed=False,
    commitments_confirmed=False,
)
```

Optional inputs are `adjustable_categories`, `minimum_category_cents`, and `future_commitments`. The CLI preference file uses `adjustableCategories`, `minimumCategoryCents`, `categoryOverrides`, and `futureCommitments`. Supply customer-specific preferences for one customer per run. Confirmation flags must reflect actual customer choices; they are not a way to bypass an infeasible result.

Use a freshly generated forecast: it now includes `cashFlowComponents` with daily expected amounts by transaction type, category, and direction. Older saved forecast fixtures without these components return a withheld budget. The additional component ledger does not change the original numerical forecast. Tiny component-rounding differences are recorded as `componentRoundingResidualCents` so daily totals reconcile exactly.

## Allocation rules

1. Take category spending directly from the forecast's consumption outflows. `historicalForecastCents` means the next-window projection from historical habits, not money already spent and not a calendar-month allowance.
2. Preserve housing and utility bill components. By default only purchases in Restaurants, Entertainment, Lifestyle, Travel, and Home & Tech may be reduced. Groceries, Health, Transportation, and unknown categories retain their projected amounts. These are conservative product defaults, not a claim to know personal needs. Customer preferences can change which purchase categories are adjustable and supply minimum category totals; bill components remain protected.
3. Restrict total planned spending to projected salary/other income minus other account outflows, the savings target, and supplied future-cost reserves. Existing capital and investment withdrawals do not increase this recurring-income spending limit. This is an additional conservative policy: a customer can have substantial cash but still fail the income constraint.
4. Also check the **whole daily path**, including today's balance after the proposed savings withdrawal. Retain the buffer plus future-cost reserves at every point. Later spending cuts cannot fund a withdrawal today.
5. Start with the protected minima and explicit category overrides. Allocate remaining discretionary amounts proportionally to historical spending, using exact-cent rounding, and search for a feasible amount up to the historical level. Unedited categories are not automatically inflated just because cash is available. A larger explicit override can reduce other discretionary allocations or make the plan infeasible.
6. If even the protected minimum plan cannot fit, return `infeasible`, quantified shortfalls, and null suggested limits. Do not present diagnostic zero discretionary limits as recommendations to stop spending altogether. The engine never silently lowers the savings target or buffer.

Future commitments follow the savings contract: unique IDs, dates beyond the forecast horizon, and nonnegative amounts. They are reserved in the funding and liquidity constraints, not also charged as in-horizon transactions. Already-projected bills are not added twice. New in-horizon costs must be incorporated into the forecast separately.

## What the frontend should display

| Field | Meaning |
| --- | --- |
| `status` | `needs_confirmation`, `conditional_plan`, `infeasible`, or `withheld`. |
| `periodStart`, `periodEnd` | The exact rolling budget window; do not label it a calendar month. |
| `categories` | Category, historical projection, protected amount, preview limit, change from history, source, and evidence IDs. |
| `previewLimitCents` | What-if amount. It can appear as a draft when feasible; in an infeasible plan it is diagnostic only. |
| `suggestedLimitCents` | Null unless the plan fits and savings/commitments are confirmed. Still conditional on the forecast and behavior assumptions. |
| `expectedIncomeCents`, `otherAccountOutflowsCents`, `futureCostReserveCents` | The funding explanation. Investment movements remain visible rather than being mistaken for income or omitted. |
| `constraintFailures` | `income_limit`, `cash_buffer`, both, or neither. |
| `preview.incomeShortfallCents`, `preview.bufferShortfallCents` | Remaining deficits even after the selected adjustments. |
| `preview.daily` | New expected balance and conditional lower/upper balances if the plan is followed. |
| `preview.lowestConditionalBalanceDate`, `preview.lowestConditionalBalanceCents` | The tightest point including today's savings reservation. |
| `confirmationRequired`, `savingsConfirmed`, `commitmentsConfirmed` | Which assumptions are still unconfirmed. |

Resolve category `evidenceIds` against `originalForecast.evidence`. Keep the immutable original forecast for comparison. Send edits to the engine, then render its returned allocations and preview rather than recomputing money in the coach.

## Counterfactual limits

The preview distributes each planned purchase amount over its historical projected spending dates, subtracts the original projected purchases once, and applies the resulting cumulative change to the original balances. Fixed bills and other account movements stay in place. The savings target is previewed as a withdrawal now; accepting a plan does not create an actual transfer or record savings.

The original uncertainty allowance is retained, but **changed-behavior previews are not newly calibrated forecasts**. `calibrationCoverageClaimApplies` is false. Do not carry over the model's measured 91.36% path coverage as an accuracy claim for the edited budget. Spending earlier than assumed, failing to follow the plan, or missing a future cost can break the projected buffer. Plans are withheld when the original forecast needs review, lacks calibration/history, or combines multiple accounts without account-specific liquidity handling.

## Verification

The 46-test suite covers the existing models plus protected categories, proportional allocation, exact-cent reconciliation, category overrides, funding and daily-buffer constraints, future reserves, and immutable forecasts.

```sh
python3 -m unittest discover -s tests -v
python3 scripts/validate_budgets.py
```

The full synthetic population passed accounting checks: **5,100 customers**, with 2,718 feasible unconfirmed previews and 2,382 infeasible plans under the demo assumptions. Of the feasible previews, 917 required reductions. These are accounting and constraint checks, not a prediction-accuracy or customer-adherence test. The [validation record](budget-validation.json) lists the checked invariants.
