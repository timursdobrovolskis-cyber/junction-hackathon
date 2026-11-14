# Budget coach integration

For persistent expenses, in-horizon recalculation, and recovery choices, use the [saved-plan integration](saved-plans.md). This document describes the earlier standalone category-budget adapter, which remains available for fixture demos.

The coach explains the shared Python engine's budget results and sends customer edits back to `build_category_budgets`. It performs no allocation, forecast, or savings calculations. `src/coach.mjs` and the existing forecast/savings coach are preserved.

## Try it

Requires Node 22+ and Python 3; no bank database or additional packages are needed for the fixture demo.

```sh
npm run demo:budget-coach
npm run demo:budget-coach -- --json
```

The demo explains all four entries in `fixtures/budget-demo.json`, including both infeasible customers. It then runs the real Python engine with CUST00005's Entertainment override of 20509 cents. Its returned plan matches `fixtures/budget-adjustment-demo.json`: Entertainment changes from €195.09 to €205.09, Lifestyle is reallocated, and total spending remains €1,793.99. The engine returns the changed daily balances.

The €500 buffer and €100 savings target are illustrative fixture inputs, not inferred customer preferences. All amounts are integer euro cents. Category projections cover the supplied rolling forecast window, not past spending or a calendar month.

## Render a response in the frontend

```js
import { createBudgetCoachResponse, captureBudgetInputs } from './src/budget-coach.mjs';

const coach = createBudgetCoachResponse({ budget, originalForecast });
// Render coach.insight.title / explanation and, if present, coach.followUp.question.
```

| Field | Rendering contract |
| --- | --- |
| `insight` | One main finding grounded in the engine's amounts. |
| `followUp` | One question with supported `inputFields`, or null when no useful question is available. |
| `facts` | Engine amounts with `sourcePath` for inspection. |
| `period` | Exact rolling window; null for withheld results. |
| `categories` | Source figures, transaction IDs, and `displayMode`. `historicalForecastCents` is a projection based on history. |
| `evidence` | Transaction IDs resolved against `originalForecast.evidence`; unresolved IDs are explicit. |
| `balancePreview` | The supplied engine path with `conditional` or `diagnostic` display mode; null if withheld. |
| `uncertainty`, `warnings`, `assumptions` | Display alongside the preview. Payment dates and savings are uncertain. |

For `needs_confirmation`, category limits are **drafts** and suggested limits remain null. `conditional_plan` means the inputs were confirmed and the engine found a fit; it still depends on the forecast and spending behavior. For `infeasible`, render the shortfall explanation. `previewLimitCents` and `suggestedLimitCents` are null in the coach response; any amounts under `diagnosticLimitCents` explain the failed scenario and must not become recommended zero budgets. For `withheld`, show the engine's reason and any missing history or review requirements.

Changed spending has not been independently calibrated. `calibrationCoverageClaimApplies` stays false. Do not attach the original forecast's coverage percentage to a budget preview.

## Capture and recalculate an edit

```js
const pending = captureBudgetInputs(engineResult, {
  categoryOverrides: { Entertainment: 20509 },
}, previousInputs);
// Persist pending.inputs; show the current preview with a pending indicator.
// Do not change displayed balances or allocations from these inputs alone.
```

`captureBudgetInputs` patches category overrides and minimums. `removeCategoryOverrides` removes selected overrides; an empty object does not erase them. `adjustableCategories` replaces the chosen set. `futureCommitments` replaces the full list of missing later costs, with unique `{id, date, amountCents}` records; only reserve costs not already included. Any date inside the forecast window blocks this request because the original forecast must first incorporate that expense. Use the existing `captureCoachInputs` flow for tracking new expenses and their inclusion status; the engine still needs support for adding them to the forecast.

The supported fields are `bufferCents`, `savingsTargetCents`, `categoryOverrides`, `removeCategoryOverrides`, `adjustableCategories`, `minimumCategoryCents`, `futureCommitments`, `savingsConfirmed`, and `commitmentsConfirmed`. Financial edits reset confirmations unless the customer explicitly renews them in the same answer. Confirming an input never bypasses infeasibility.

Always persist and return `inputs` on subsequent edits, including after a failed calculation. When no prior state is supplied, the coach reconstructs overrides and adjustable categories from the result and conservatively retains every `protectedCents` amount as a floor. To explicitly relax a reconstructed purchase floor, the customer must supply both the desired adjustable category set and the new `minimumCategoryCents` value. The engine still protects bills. Prior input state must be scoped to the same customer and reference date.

On the **Node server**, the included adapter can perform the round trip:

```js
import { previewBudgetChange } from './src/budget-engine-client.mjs';

const response = await previewBudgetChange(engineResult, {
  categoryOverrides: { Entertainment: 20509 },
}, previousInputs);

if (response.status === 'recalculated') {
  // Store response.engineResult and response.inputs; render response.coach.
} else {
  // Keep the previous preview visible; show response.message and any blockers/error.
  // Retain response.inputs for correction or retry.
}
```

The adapter invokes `scripts/coach_budget_bridge.py` over JSON stdin, without a shell, and calls Timurs's existing function. It bounds execution time and output size. Python is required only on the server. Browser code should import `budget-coach.mjs`, not `budget-engine-client.mjs`. No HTTP route is included; the frontend teammate can call this adapter from the app's server handler or use the documented `engineRequest.engineInputs` with a Python backend directly.

Each edit uses the same immutable `originalForecast`; it never feeds an already-adjusted balance path back as a baseline. `budgetChanged: true` means a new budget result was received, including an infeasible or withheld result. `forecastChanged` stays false because the underlying original forecast has not changed. No flow moves money.

On failure or blocked inputs, the adapter returns the previous `engineResult` and `coach`, pending inputs, and `budgetChanged: false`. The UI must check the top-level status. The app owns customer authentication, loading the correct current forecast, persisting inputs, and ordering requests so an older response cannot overwrite a newer edit. It should regenerate forecasts when transactions change and explicitly reconcile preferences for the new reference date.

## Verification

```sh
npm test
python3 -m unittest discover -s tests
```

The integration tests exercise all four customers, the exact before/after engine fixture, repeated edits without compounding, confirmations, preserved floors and reserves, protected-category failures, missing history/components, withheld results, blocked in-window expenses, evidence validation, and unavailable/timed-out engines.
