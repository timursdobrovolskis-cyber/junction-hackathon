# Coach responses from the shared calculation engine

The forecast/savings response function is `src/engine-coach.mjs`. It consumes one
`{ forecast, savings }` entry from `fixtures/savings-demo.json` directly. It does not
call our older standalone planning/history calculations, infer savings from balances,
or change any engine amount. `src/coach.mjs` is preserved unchanged by this integration.

The [saved-plan upgrade](saved-plans.md) connects this function to persistent plans, reviewed in-horizon expenses, matching, and recovery options. Use the combined client for new app integrations.

Run `npm run demo:coach` for readable examples for all three customers. Run
`node examples/engine-coach-demo.mjs --json` for the structured response array.
No model API key is needed. The explanations use templates grounded in engine fields.

## Frontend handoff

```js
import { createEngineCoachResponse, captureCoachInputs } from './src/engine-coach.mjs';

const response = createEngineCoachResponse(engineResult, {
  bufferConfirmed: false, // default: the example's €500 is illustrative, not a user choice
});
```

Render these fields:

| Field | Display / behavior |
| --- | --- |
| `customerId`, `asOf`, `currency`, `modelVersion` | Selected customer and historical reference/model labels. The source fixture uses 2026-09-30; October dates are forecasts. |
| `insight` | One `{ kind, title, explanation }` describing the most relevant issue. |
| `facts` | Supplied cents and their `sourcePath`: buffer, opening balance, lowest expected balance, and savings preview/estimate. Null means unavailable, never zero. |
| `paymentContext` | Up to one estimated outflow and one estimated inflow group with date windows, amounts, and evidence. Groups can cover several payments/providers. |
| `evidence` | Transaction IDs, available source records, and unresolved IDs. Resolve any missing IDs through the customer-scoped data service. |
| `followUp` | One useful question with `kind`, `prompt`, reason it can change the recommendation, and structured form fields where applicable. Null only when a withheld result needs backend/model repair that a customer answer cannot resolve. All three supplied examples have a question. |
| `uncertainty` | Show its `message` alongside the main explanation. The supplied calibration margin is large and must remain visible. The calibrated range is copied from the engine row at its supplied expected low date. |
| `warnings`, `assumptions` | Preserve and make the engine's complete disclosures accessible. |
| `calculationState`, `movesMoney` | `engine_result` and `false`; this module never transfers money. |

Amounts are integer euro cents (`50000` → €500). The coach only formats them,
compares supplied balance fields with the buffer to select an explanation, and
selects existing daily records. It does not derive a new forecast, minimum balance,
savings capacity, or reserve. It uses calibrated lower bounds for uncertainty alerts;
`possibleBelowBufferDates` contains raw scenario flags and is not used for that alert.

The examples produce:

| Customer | Main insight | Savings field | First question |
| --- | --- | --- | --- |
| CUST00001 | Conditional savings preview | €400.79, still `needs_confirmation` | Choose a cash buffer; the fixture uses €500. |
| CUST00002 | Expected balance could drop to €459.32 on the estimated 2026-10-14 low date, below the €500 buffer | €0 conditional preview | Check for additional upcoming expenses. |
| CUST00003 | Conditional savings preview | €2,861.39, still `needs_confirmation` | Choose a cash buffer; the fixture uses €500. |

Set `bufferConfirmed: true` only after the customer has selected the buffer and the
engine result reflects that choice. The next question then checks additional expenses.
`needs_confirmation` always uses `conditionalCapacityCents`, never a fictional
suggested amount. `conditional_estimate` uses `suggestedSavingsCents` but retains
uncertainty. `needs_review` and `insufficient_history` suppress savings amounts.

Insight priority: incomplete history → inputs needing review → recorded balance below
buffer → expected low below buffer → calibrated-range buffer risk → withheld savings
→ zero capacity → positive conditional preview/estimate. Source warnings explain
missing coverage, stale balances, or unclassified flows. No exact payday is promised:
an expected income amount over a date window is not a confirmed salary or installments.

## Capture answers without claiming recalculation

```js
const pending = captureCoachInputs(engineResult, {
  bufferCents: 75000,
  upcomingExpenses: [
    { id: 'repair', date: '2026-10-20', amountCents: 15000,
      label: 'Repair', inclusion: 'additional' },
    { id: 'annual-fee', date: '2026-12-01', amountCents: 10000,
      inclusion: 'additional' },
  ],
  commitmentsConfirmed: false,
});

// A later answer: preserve earlier costs and update the buffer.
const next = captureCoachInputs(engineResult, { bufferCents: 80000 }, pending.inputs);
```

This returns `status: 'awaiting_recalculation'`, the structured `inputs`, an
`engineRequest`, and `forecastChanged: false`, `savingsChanged: false`. It returns no
new forecast or savings amount. Show its pending message and retain the previous
engine result until the backend supplies a recalculated result. Never show a captured
buffer choice as though the existing engine result already used it.

`upcomingExpenses` upserts costs by stable ID, preserving other costs and existing
engine future-cost reserves. `removeExpenseIds` explicitly removes costs. Duplicate
IDs within one answer and conflicting update/removal are rejected. IDs, valid dates,
nonnegative integer cents (including a zero buffer), and customer/reference-date
isolation are checked. Dates must follow the historical cutoff; correcting an already
recorded expense belongs to the source-data workflow.

For each expense, ask whether it is `additional`, `already_included` in the supplied
calculation, or `unsure`. Missing inclusion defaults to `unsure`, which blocks
recalculation until reviewed. Do not match a new expense to a forecast group merely
because its category or amount happens to match.

`commitmentsConfirmed` must be an explicit boolean customer answer. Changing a buffer
or expense clears prior confirmation unless the customer explicitly renews it in the
same answer. Confirmation never makes the financial estimate guaranteed.

### Routes to Timurs's engine

- `engineRequest.forecastInputs` uses the existing Python argument names:
  `customer_id`, `as_of`, `horizon_days`, `buffer_cents`.
- `engineRequest.savingsInputs` uses `buffer_cents`, `future_commitments`, and
  `commitments_confirmed`, matching `estimate_savings` exactly.
- `inHorizonExpenses` holds additional costs dated within the daily forecast,
  including its final date. These must be incorporated by the forecast engine once.
- Costs strictly after the horizon go into `savingsInputs.future_commitments`.
- `alreadyIncludedExpenses` does not create another deduction. Previously reserved
  future costs remain in the reserve inputs once; an unknown beyond-horizon cost
  claimed to be included is held for review.
- `needsInclusionReview` holds uncertain expenses or expenses whose routing cannot
  be established because no forecast horizon exists.

The combined engine now accepts `engineRequest.plannedExpenses` as canonical inputs.
It creates a separate conditional plan scenario with locked dated expenses, preserving
the historical forecast. Reviewed in-horizon expenses no longer receive the blanket
`in_horizon_expenses_need_engine_support` blocker. Missing calibration/source review,
uncertain inclusion, and past-due unresolved expenses still block reliable advice.
Use `captureFinancialPlanInputs` to build the complete API request; do not send a later
expense both in `plannedExpenses` and legacy `futureCommitments`.

For ready requests, the backend scopes the customer's transaction rows, retains the
selected model and compatible calibration, runs `forecast_cash_flow` followed by
`apply_calibration`, then `estimate_savings`. It returns a new `{ forecast, savings }`
pair. Only then call `createEngineCoachResponse` again to display updated figures.
The integration test calls the actual Python savings engine for a changed buffer and
a beyond-horizon cost; it verifies the old response remains unchanged before that call.

The capture result is a request contract, not an HTTP endpoint or backend dispatcher.
Keep pending input state server-side or scoped to the authenticated customer, correlate
engine replies with the latest request, and discard superseded results. Do not reuse
pending additions after an engine has acknowledged incorporating them. Engine statuses
are authoritative; a frontend confirmation cannot turn `needs_review` into `estimated`.

For `review_inputs` questions, route the user to the account/history correction flow.
A conversational “yes” does not repair missing source data. Neither function implements
open-ended natural-language parsing or LLM chat in this first deliverable.

## Verification

Run `npm test` with Node 22+ and Python 3 available for the engine integration test.
Run `python3 -m unittest discover -s tests -v` for the shared engine suite. Coverage
includes all three customer outputs, conditional/withheld states, evidence, income
date uncertainty, missing data, input isolation, double counting, horizon boundaries,
explicit confirmations, pending state, and a real-engine recalculated savings result.
