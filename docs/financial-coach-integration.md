# Coach connected to the combined financial API

Follow [Timurs's engine setup](../data/FINANCIAL_ENGINE.md) first. The coach now consumes the complete `POST /api/plan` response: `forecast`, `savings`, and `budget`. Customer edits go back to that endpoint so the three panels refresh together. The existing forecast/savings coach, budget coach, and standalone Python budget bridge remain available.

## Run and test

After [preparing the synthetic database](../data/README.md), start the engine in one terminal from the repository root:

```sh
python3 scripts/run_financial_engine.py --serve --port 8765 --allow-origin http://localhost:3000
```

In a second terminal, also from the repository root:

```sh
npm run demo:api-coach
```

This makes a real request for CUST00005, prints the coach's explanation, then submits a €400 savings target with the existing €500 buffer. The returned spending preview is €1,493.99 and the next question concerns upcoming expenses. The savings target is confirmed only because this example explicitly simulates the customer's choice; upcoming expenses remain unconfirmed.

Use `npm run demo:api-coach -- --json` for structured output. To inspect the saved sample without a database or running server, use `npm run demo:api-coach -- --fixture`; this mode is labeled and does not simulate a recalculation.

The cutoff `2026-09-30` is the last observed date in the synthetic export. These are historical demo scenarios, not a forecast based on today's transactions. The €500 buffer and initial €100 target are sample preferences.

Run the checks:

```sh
npm test
python3 -m unittest discover -s tests -v
python3 scripts/check_financial_api.py
npm run check:coach-api
```

The last two commands need the prepared database. Each starts its own temporary local server and stops it after checking. The coach check covers all four demo customers, exact fixture parity, category overrides, repeated edits, €400 savings, confirmations, shared buffers and reserves, infeasible plans, and errors that preserve the previous result.

## Frontend usage

`src/financial-coach-client.mjs` is browser-safe and uses `fetch`; it also runs on Node 22+. It imports neither Python nor `node:child_process`. Set the engine's `--allow-origin` to the frontend's exact localhost origin, including its port.

```js
import {
  fetchFinancialPlan, createFinancialCoachResponse, previewFinancialPlanChange,
} from './src/financial-coach-client.mjs';

const options = { endpoint: 'http://127.0.0.1:8765/api/plan' };
let engineResult = await fetchFinancialPlan({
  customerId: 'CUST00005', asOf: '2026-09-30',
  bufferCents: 50000, savingsTargetCents: 10000,
  savingsConfirmed: false, commitmentsConfirmed: false,
}, options);
let inputs;
let revision = 0;
render(createFinancialCoachResponse(engineResult));

async function submitAnswer(answer) {
  const currentRevision = ++revision;
  const response = await previewFinancialPlanChange(engineResult, answer, inputs, options);
  if (currentRevision !== revision) return; // An older response must not overwrite a newer one.
  inputs = response.inputs; // Preserve choices even on a failure or a blocked expense.
  if (response.status === 'recalculated') {
    engineResult = response.engineResult;
    render(response.coach);
  } else {
    showPendingOrError(response.message, response.engineRequest.blockers, response.error);
  }
}

// Call only after the customer explicitly chooses this target:
await submitAnswer({ savingsTargetCents: 40000, savingsConfirmed: true });
```

`render` and `showPendingOrError` are app callbacks. Disable submission while a request is running, or queue edits, so multiple rapid patches retain each other's choices. The revision guard is an additional safeguard when loading a different customer; increment it and clear customer-specific state on a customer/date switch. A request supports an optional `signal` for cancellation and a `timeoutMs` (default 10000).

The returned top-level `insight` and `followUp.question` are the active card and its single question. The `budget` and `cashFlow` panels preserve source evidence, warnings, assumptions, confirmation states, and uncertainty. `focus: 'budget'` is the default; use `focus: 'cash_flow'` in the response/client options for the forecast/savings card. Missing history or inputs needing review take priority; infeasible or withheld budgets remain visible.

Keep the panel bases explicit: `cashFlow` describes historical spending and savings capacity before category edits. `budget` describes the selected savings target and changed spending scenario. The budget path is not newly calibrated, and its savings target is not the same concept as historical-spending savings capacity. Render the engine's amounts and both explanations without independently calculating a new forecast.

## Answers and pending state

`captureFinancialPlanInputs(result, answer, previousInputs)` can be used separately to show pending state before submission. It returns `engineRequest.request` in the API's camelCase format and a `ready` flag with blockers. The request contains only supported API fields; labels and expense-inclusion answers stay in coach state.

Supported answers combine the existing [budget preferences](budget-coach.md) and [expense capture](engine-coach.md):

- `bufferCents`, `savingsTargetCents`, `categoryOverrides`, `removeCategoryOverrides`, `adjustableCategories`, `minimumCategoryCents`, `savingsConfirmed`, `commitmentsConfirmed`.
- `upcomingExpenses` upserts `{id, date, amountCents, label?, inclusion}`; inclusion is `additional`, `already_included`, or `unsure`. `removeExpenseIds` removes selected known entries.
- Alternatively, `futureCommitments` replaces the full later-cost list. Do not combine that replacement with expense upserts/removals in the same answer.

Missing later expenses become `futureCommitments` in the API. Expenses already in the forecast are not added again. Unknown inclusion requires review. New in-window expenses remain blocked because this API does not yet add them to the forecast. Pending expenses survive subsequent edits until corrected or removed.

Financial changes reset confirmations unless the customer explicitly renews them. Existing category protections, overrides, and future reserves are preserved across edits. Persist `response.inputs` for the same customer and observation date; do not reuse it for a different customer or date. When loading a previously saved request, retain the exact preference state if available; otherwise the coach conservatively reconstructs category floors from the returned protections.

On success, replace all three engine panels together. `forecastChanged`, `savingsChanged`, and `budgetChanged` compare the newly returned objects with the previous objects; a category edit can change only the budget while still fetching all three calculations. On an HTTP error, timeout, malformed response, identity mismatch, or blocked expense, retain the old complete result. The UI should show the pending/error status alongside it. No flow moves money.

This uses the guide's unauthenticated localhost development API. It is not a deployed application. App screens, customer authorization, and deployment remain with the app lane.
