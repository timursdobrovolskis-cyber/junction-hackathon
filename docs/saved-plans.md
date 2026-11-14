# Saved plans, known expenses, and recovery choices

This implements the [backend handoff](BACKEND_IMPLEMENTATION_HANDOFF.md) on the coach branch. It uses the existing Python engine and income-v2 model. Bank observations remain read-only. A separate local SQLite database stores plans, preferences, customer-written priorities, expenses, selected alternatives, revisions, mutation receipts, and audit events.

## Start and try it

Prepare the bank database using [the data guide](../data/README.md), then run:

```sh
python3 scripts/run_financial_engine.py --serve --port 8765 --allow-origin http://localhost:3000 --plans-database data/local/plans.sqlite
```

The plan database initializes schema version 1 automatically. Stop and restart the server using the same file to retain plans. Both SQLite files and the raw bank data stay under the ignored `data/local/` directory. The plan file must be separate from the bank database and model artifacts.

In another terminal:

```sh
npm run demo:saved-plans
npm run check:saved-plans
```

The demo makes read-only previews of three [reproducible scenarios](../fixtures/saved-plan-requests.json): a feasible known cost, a €200 repair with both recovery options, and a plan where neither option fits. For CUST00003, the €200 repair produces a choice between lowering savings from €100 to €93.91 while retaining spending, or keeping the €100 target and changing permitted flexible spending. These are conditional examples, not recommendations for every customer. No option is silently selected.

The integration check starts an ephemeral server with a temporary plan database, saves a €200 expense, restarts the actual server process, reloads the same state and selected option, and exercises conflicts and matching. It removes its temporary store afterward. Matching replays actual September observations. The October repair is a hypothetical user input; the export contains no October actual transactions.

## API contract

| Route | Behavior |
| --- | --- |
| `POST /api/plan` | Existing stateless preview; now accepts `plannedExpenses`. Does not save. |
| `GET /api/customers/{customerId}/plan` | Saved state plus recalculated results, or `status: "no_saved_plan"`. On calculation failure returns saved state and the last valid result labeled `recalculation_failed`. |
| `PUT /api/customers/{customerId}/plan` | Explicit full-state save using `request`, `expectedRevision`, `mutationId`, and `planId` for an existing plan. |
| `POST /api/customers/{customerId}/plan/select` | Select a current available `optionId`; verifies revision, recomputes, then saves atomically. |
| `POST /api/customers/{customerId}/plan/reconcile` | Advance `asOf` and reconcile observed payments. Clear matches are committed automatically. |
| `POST /api/customers/{customerId}/plan/matches` | Apply explicit `decisions` containing `expenseId`, `transactionId`, and `action: "confirm"`, `"reject"`, or `"undo"`. |

All mutation routes require `expectedRevision` and `mutationId`; existing plans require `planId`. Initial revision is 0. Retry the identical body with the same mutation ID to receive the original successful response without another charge, audit entry, or revision. Reusing the ID with a different body, or using a stale revision, returns 409. Foreign customer/plan combinations return 404. Invalid input returns 400. A calculation error rolls back the write.

Example initial save:

```json
{
  "expectedRevision": 0,
  "mutationId": "record-repair-001",
  "request": {
    "customerId": "CUST00003",
    "asOf": "2026-09-30",
    "bufferCents": 50000,
    "savingsTargetCents": 10000,
    "plannedExpenses": [{
      "id": "repair-001", "date": "2026-10-07", "amountCents": 20000,
      "category": "Transportation", "label": "Car repair", "inclusion": "additional"
    }]
  }
}
```

The response includes stable `planId`, incremented `revision`, `state`, and complete `engineResult`. `state.request` contains the exact financial preferences; `state.plannedExpenses` also contains server-owned lifecycle/matching metadata; `state.spendingPlan` records accepted category limits separately from the customer's floors and fixed choices. `state.selectedAlternative` records the selected option and source revision. Ordinary financial edits mark a previous selection inactive while preserving its history.

Financial edits reset confirmation flags. Renew them only through an explicit mutation-envelope `confirmations` object, for example `{"savingsConfirmed":true,"commitmentsConfirmed":true}`. Copying true flags from an old saved request does not confirm new expenses. Selecting an option also resets confirmations unless renewed explicitly.

For a preview based on an existing plan, include `sourcePlanId` and `sourceRevision` alongside the request. The service verifies ownership/revision and uses the existing spending plan and canonical expense history. Do not submit these fields inside a saved `request`; saved-plan actions already identify their source through the envelope.

## Expenses and accounting

Expenses use stable IDs and integer euro cents. Mutable fields are `id`, `date`, `amountCents` (positive), `category`, `label`, optional `accountId`/`merchantId`, `inclusion`, and `status`. Up to 100 expenses are accepted. Account IDs must belong to the selected customer's observed accounts. Full-state updates replace an expense with the same ID; omission cancels an unmatched expense while retaining its history. Explicitly set `status: "planned"` to reactivate a cancelled entry.

Inclusion (`additional`, `already_included`, `unsure`) and lifecycle (`planned`, `matched`, `cancelled`) are separate. Matching metadata, `recordedAsOf`, and ledger links are server-owned. A matched expense must be undone before its amount/date is edited or it is cancelled.

- Confirmed additional expenses within the horizon are locked, dated outflows. Earlier balances are unchanged; balances on and after the due date include the amount once.
- Expenses after the horizon become future reserves. The canonical entry moves to a dated outflow as the cutoff advances, so it is never both a reserve and an outflow.
- An in-window expense explicitly marked `already_included` is not added again. Uncertain inclusion, unverified later inclusion, and past-due unmatched costs remain review blockers.
- Duplicate IDs across `futureCommitments` and `plannedExpenses` are rejected. New coach flows use canonical `plannedExpenses`; legacy later-cost requests remain supported.

`forecast` stays the historical base. `planScenario` contains the expense adjustment and is the common input to savings, current-budget evaluation, and recovery options. `planScenario.daily` uses `conditionalLowerBalanceCents`/`conditionalUpperBalanceCents`; it has no copied `calibration` label. Its `sourceEligibility` retains the base model/data eligibility, and `calibrationCoverageClaimApplies` is false. Components and paths reconcile in cents.

Known costs appear as locked `planned_expense` components outside adjustable category allocations. Budget `lockedCommitments` and `lockedCommitmentsCents` identify them; they are included in `otherAccountOutflowsCents` for the income constraint and already in the scenario's dated balances. `totalPlannedSpendingCents` covers category limits, excluding these separately displayed locked obligations. Do not subtract them again.

## Recovery options

The engine first evaluates the customer's existing spending plan with the new obligation. It does not silently replace that plan with a reduced-spending allocation. A saved plan retains its accepted category limits; a new preview starts from the base engine's feasible plan, or historical spending if the base plan is already infeasible.

When the plan fails, the engine computes:

1. `save_less`: holds all existing category amounts fixed and finds the largest feasible savings target at or below the customer's target, never below zero. If even zero fails, the option is unavailable.
2. `reduce_flexible_spending`: keeps the target, caps categories at the existing spending limits, and adjusts only permitted discretionary amounts. Bills, nonadjustable categories, user floors, fixed overrides, and dated costs stay protected.

Each option contains its stable ID, source plan revision/cutoff, exact `preferenceChanges`, `spendingPlan`, `categoryChanges` with before/after figures and evidence IDs, full budget/path, shortfalls, assumptions, and availability. Unavailable plans contain diagnostic figures only. No money moves. Selection rechecks the source revision and a fingerprint covering the current source scenario/preferences, recalculates the chosen option, and commits only if it still fits.

## Payment matching

Automatic matching requires one eligible expense and one eligible observed transaction: same customer, explicit same account, exact outflow amount, matching nonempty merchant IDs, and a date within three days either side of the planned date. The transaction must be after `recordedAsOf` and on/before the current observation cutoff. Editing the amount, date, category, account, or merchant also advances `matchingSince`, preventing an earlier partial payment from settling a newly edited remaining amount. Competing candidates, including transactions already linked to another expense, missing merchants/accounts, partial payments, and refunds require review. Amount plus category alone never triggers automatic settlement.

Manual confirmation also requires a same-customer observed exact outflow in the date window and compatible account. Partial/split settlements and refunds are not implemented as settlements; correct or cancel the expense after reviewing them. Rejections are remembered; undo removes the ledger link and rejects the old transaction so it is not immediately matched again. An unresolved past-due expense stays visible and blocks reliable savings/budget recommendations.

A matched payment is already in the observed balance, so its planned outflow/reserve stops. The ledger enforces one transaction per expense and one expense per transaction. Matching decisions are audited with the customer/rule actor. Reconciliation is idempotent. `GET` does not write: if source data changed at the same cutoff, it can return `pendingMatchingDecisions`; commit them through reconciliation. Advance cutoffs using `/reconcile`, not by editing stored matching metadata.

## Coach integration and remembered priorities

Use `src/saved-plan-client.mjs` for `loadCustomerPlan`, `saveCustomerPlan`, `selectRecoveryOption`, `reconcileCustomerPlan`, and `reviewPaymentMatch`. Calls return the saved envelope, restored `inputs`, and renderable `coach`. On failures they retain the pending mutation and previous saved display; reload before retrying a conflict. Serialize edits and ignore stale responses using the revision/customer guards described in the [combined API guide](financial-coach-integration.md).

```js
const saved = await loadCustomerPlan(customerId);
const priority = prepareProtectedCategory(saved, {
  category: 'Entertainment', reason: 'Time with friends matters to me',
});
const updated = await saveCustomerPlan(customerId, priority.request, {
  savedPlan: saved, mutationId: crypto.randomUUID(), priorityNotes: priority.priorityNotes,
});
// Render updated.coach only when status === 'saved'. Keep its mutationId for retries.
// When the customer chooses an available recovery card:
const chosen = await selectRecoveryOption(updated, optionId, {
  mutationId: crypto.randomUUID(),
});
```

The priority helper uses the engine's historical category projection (or an explicit customer minimum), preserving an already higher floor by default. It does not save automatically. Reasons are customer-written, stored in `priorityNotes`, and restored after reopening. Render them as text, not HTML. The coach supplies transaction-linked tradeoff explanations and both recovery cards; it does no financial arithmetic.

The active cash-flow/savings panel uses `planScenario` when present. The original forecast remains separately available. `forecastChanged` describes the historical forecast; `planScenarioChanged` describes the expense-adjusted plan. Refresh panels only after a complete validated result. Review blockers and infeasible states remain explicit.

## Checks and current limits

```sh
python3 -m unittest discover -s tests -v
npm test
python3 scripts/check_financial_api.py
npm run check:coach-api
npm run check:saved-plans
```

This is a localhost prototype with one active plan per synthetic customer, not production authentication or deployment. Existing income-v2 uncertainty remains wide. There is no live bank feed, automatic transfer, partial-payment ledger, or forecast retraining. Actual transaction dates end September 30, 2026. Same-day payments recorded before/after an expense cannot be distinguished from dates alone, so the rule conservatively excludes payments on the recording cutoff. A changed source schema or disappearing category may require preference review rather than silently dropping a protection. Pending failed edits are returned to the client; only successfully calculated saves survive a server restart. Timurs's unpushed purchase simulator is not a dependency.
