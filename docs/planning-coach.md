# Person Three: Planning and coach

This module owns category budget suggestions, savings projections, purchase previews,
and a structured coaching action. It uses deterministic JavaScript and has no runtime
dependencies. Run `npm test` and `npm run demo` with Node 22 or later.

The repository currently has no bank-data adapter, application, daily cash-flow model,
LLM credentials, or authentication layer. Examples are explicitly illustrative fixtures.
Their November dates do not represent live S-Bank balances. The bank data described
in the brief ends in September 2026; select a historical reference date for those records.

## Public functions

```js
import {
  createCoachAction,
  calculateCategoryBudgets,
  calculatePurchaseScenario,
  calculateRecoveryScenario,
} from './src/planning.mjs';

const card = createCoachAction(profile, { directAnswer: false });
const purchase = calculatePurchaseScenario(profile, {
  id: 'scenario-weekend', date: '2026-12-05', amountCents: 20000,
});
const experiment = calculateRecoveryScenario(profile); // null when unsupported
```

`calculateGoalPlan` remains exported from `src/coach.mjs`. Existing fixture fields
and amounts remain compatible; results add `cashShortfalls` and, when applicable,
`recoveryOption.remainingShortfallCents`. Invalid inputs throw `TypeError`.
The mobile integration should catch these and ask for corrected input.

## Data and predictions → Planning and coach

Use `fixtures/planning-profiles.json` as two executable contract examples. Every input
must belong to the selected customer. The server/data adapter must scope queries and
evidence lookups to that customer; this pure module is not an authorization boundary.
Do not allow an explanation model to choose arbitrary customer IDs or SQL.

| Field | Contract |
| --- | --- |
| `customerId`, `currency` | Stable selected-customer identifier; currency is `EUR`. |
| `asOf` | Valid `YYYY-MM-DD` reference date, independent of the computer's clock. |
| `dataSource` | `illustrative_fixture` or `historical_bank_data`. |
| `missingInputs` | Explicit array of missing inputs, such as income timing, essential commitments, or reserve. Use `[]` only after checking coverage. Missing input changes the card to `confirm_inputs`. |
| `assumptions` | Human-readable income estimates, commitments, reserve, uncertainty, and customer corrections. |
| `goal` | Optional `{ label, targetCents, savedCents, targetDate }`. Already saved money must be separate from future period cash. |
| `periods` | Required for a goal: consecutive `{ month, availableToSaveCents, plannedDeliveryCents, evidenceIds? }` from `asOf` through the goal month. |
| `deliveryHistory` | Optional `{ id, date, amountCents }[]` of positive consumption amounts, at or before `asOf`. The adapter/customer must identify delivery; a broad restaurant category does not establish this. |
| `newExpenses` | Optional `{ id, date, amountCents, label? }[]` of additional scenario expenses not already deducted from period cash. IDs must be unique and dates within the forecast window. |
| `spendingHistory` | Optional complete-month consumption totals: `{ month, category, spentCents, basket, adjustable, evidenceIds? }[]`. Months must precede the reference month. |
| `signals` | Optional `{ id, type: 'recurring_bill', dueDate, amountCents, confidence, evidenceIds }[]`. Confidence is `low`, `medium`, `high`, or `confirmed`; `confirmed` means customer-confirmed amount and date. Evidence is required. |

All money is a safe integer in euro cents. Only `availableToSaveCents` and calculated
net results may be negative. Convert signed bank outflows to positive consumption
amounts after distinguishing refunds, transfers, investments, and savings. Do not
apply `abs()` to every row. Preserve source transaction IDs; if the dataset lacks IDs,
create stable row identifiers and retain their mapping. Never invent merchant names.

### Period semantics and double counting

`availableToSaveCents` is projected incremental cash after income, committed payments,
essential spending, discretionary spending (including `plannedDeliveryCents`), and
the selected reserve. The data/forecast owner supplies it. Do not repeat the opening
balance in each month or include money already counted in `goal.savedCents`.
The first period covers the remainder from `asOf`; the last stops at `goal.targetDate`,
including a mid-month deadline. The adapter must clip these windows before aggregation.

```text
period contribution = availableToSaveCents - additional scenario expenses
projected savings = already saved + sum(period contributions)
goal gap = max(0, target - projected savings)
```

Each additional expense is subtracted once. A negative contribution is surfaced as a
cash gap. This is a conservative monthly alert, not a bank-overdraft prediction:
opening cash, carryover, and within-month timing need the future daily forecast.
Negative projected savings mean an unmet cash requirement, not an executed withdrawal.

The delivery experiment uses median observed cost and suggests at most one avoided
delivery per eligible period. A period qualifies only if that spending is already
projected. The result can still leave a goal gap, which the explanation reports.
It assumes the alternative has no incremental cost; the customer can reject/correct
this. Delivery flexibility is a fixture assumption, not an inference from age.

Category budgets use the rounded mean of supplied complete monthly totals. Include
explicit zero rows for genuine zero-spend months; missing history is not zero.
Coverage is returned in `observedMonths`. `reductionPercent` defaults to zero and is
a customer-selected experiment. Reductions apply only to `basket === 'everyday'`
AND `adjustable === true`. Apply customer corrections consistently before calling.
The baskets are `mandatory_regular`, `mandatory_irregular`, and `everyday`.
Budget suggestions do not automatically change the goal plan; recalculate its
forecast before incorporating them.

## Planning and coach → Mobile app

Render `action.title`, `action.explanation`, and `action.suggestedAction` as text.
The result includes a schema version, customer/reference date, source label, numeric
plan, budgets, assumptions, missing inputs, limitations, and evidence IDs.
Priority: missing inputs → cash gap → recovery → unsupported goal gap → upcoming bill
→ goal on track → observation. Bill signals are observations and are never silently
subtracted again from a forecast that may already include them.

Use `evidenceIds` for customer-scoped transactions and `scenarioExpenseIds` for
user-entered scenario inputs. The legacy `plan.recoveryOption.evidenceIds` mixes both
for compatibility; use the top-level lists in new UI code. Fixture references are not
bank transactions. Show a missing-evidence state if an adapter cannot resolve a reference.

Call `calculateRecoveryScenario` for before/after projections and period breakdowns.
It returns `null` for unsupported experiments, missing inputs, or a baseline cash gap.
`calculatePurchaseScenario` returns `needs_information`, `cash_shortfall`,
`goal_shortfall`, or `within_projection`; the last is not an affordability guarantee.
Previews do not mutate inputs, record savings, or move money.
Both preview functions currently require a goal and its period plan; the home-card
function can return bill observations and budgets without a goal.

Offer inspect, preview, edit, and dismiss controls. Set `directAnswer: true` to omit
optional `learning`; keep evidence and limitations accessible. Do not show a
weakest-day chart using monthly values.

## AI and implementation order

The initial coach uses templates grounded in engine figures, as permitted by the
build plan. It runs without an API key and does not claim to be LLM chat. It includes
an optional concept, implementation intention, and reflection prompt. Advanced habit
tracking and open-ended chat are not implemented.

1. Mobile owner renders the student recovery card, evidence, and preview from the fixture.
2. Data owner supplies customer-scoped profiles from normalized bank data. Query selected
   rows and pre-aggregate complete months with parameterized DuckDB queries. Keep the
   millions of raw rows out of model prompts.
3. Integrate the second customer, who gets a bill observation without choosing a goal.
4. Add daily forecasts with dated obligations/income before weakest-day or delayed-salary scenarios.
5. For an LLM, keep keys server-side. Allow validated operation selection and explanations
   of structured results. Render engine amounts directly in cards, restrict context to
   the selected customer, and fall back to templates on failure. The model must not
   calculate or execute financial actions.

No backtest or model accuracy is claimed: bank records and a daily forecast are not
present. Tests cover the numeric demo, cash gaps, purchase/experiment previews,
evidence routing, budget corrections, incomplete history, missing inputs, date and
horizon validation, integer cents, and duplicate expenses.
