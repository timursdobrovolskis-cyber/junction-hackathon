# Backend implementation handoff: saved plans and upcoming expenses

Status: agreed requirements and proposed implementation, **not implemented by this document**.
Prepared November 14, 2026, for the three-person hackathon team.

## Outcome

A customer tells the coach, “I need to pay EUR 200 for a car repair next week.”
After confirmation, the app remembers the expense, updates the forecast, savings and budget, and restores the plan after reopening.
If the plan no longer fits, the customer chooses between saving less and reducing flexible spending.
When the actual payment appears, the app matches it without counting the expense twice.

This is a backend and coach-integration task. Reuse the existing coach; no frontend redesign or new model-training experiment is required.

## Decisions already made with the product owner

- Remember confirmed upcoming expenses; allow editing and removal.
- Automatically match an actual payment only when the match is clear; ask when uncertain.
- Offer two alternatives when a new cost makes the plan infeasible: save less, or reduce flexible spending.
- Protect rent, bills, essentials, and customer-defined category floors.
- Apply the alternative the customer selects, not an automatic silent change.
- Persist expenses, preferences, and the selected plan across reloads and server restarts.

Implementation assumptions: use the prepared synthetic customer dataset, the existing 30-day horizon, integer euro cents, and the supported income-v2 model. No live bank connection, actual money movement, or production deployment is included.

## Repository state and starting point

Verified against GitHub before publishing this handoff:

- Main engine baseline is commit `f094898`: Python calculations and `POST /api/plan`.
- `feat/planning-coach` is nine commits ahead of that main baseline and already includes it.
- The coach calls the combined API, handles confirmations and pending expenses, and supports savings targets, buffers, category overrides, and later-cost reserves.
- Additional expenses within the forecast horizon are deliberately blocked by `in_horizon_expenses_need_engine_support`.
- The current API does not persist customer plans.
- Timurs has a separate **local, unpushed** purchase-preview implementation, explanations, and three demo fixtures. They are not dependencies available on GitHub at this handoff. Coordinate before editing the overlapping Python engine and API files. That preview shifts a separate scenario; it does not implement persistent expenses or combined budget recovery.

Start from the latest coach branch, preserving your existing work. Bring this handoff commit from main into your branch using your normal workflow. Do not overwrite teammates' changes or replace the coach with an older standalone calculator.

Read these files first:

| Area | Files |
| --- | --- |
| Shared engine and API | [src/financial_engine.py](../src/financial_engine.py), [scripts/run_financial_engine.py](../scripts/run_financial_engine.py), [data/FINANCIAL_ENGINE.md](../data/FINANCIAL_ENGINE.md) |
| Financial calculations | [src/cash_flow.py](../src/cash_flow.py), [src/forecast_safety.py](../src/forecast_safety.py), [src/category_budgets.py](../src/category_budgets.py) |
| Coach integration, on the coach branch | [Integration guide](https://github.com/timursdobrovolskis-cyber/junction-hackathon/blob/feat/planning-coach/docs/financial-coach-integration.md), [financial-coach-client.mjs](https://github.com/timursdobrovolskis-cyber/junction-hackathon/blob/feat/planning-coach/src/financial-coach-client.mjs) |
| Input capture, on the coach branch | [engine-coach.mjs](https://github.com/timursdobrovolskis-cyber/junction-hackathon/blob/feat/planning-coach/src/engine-coach.mjs), [budget-coach.mjs](https://github.com/timursdobrovolskis-cyber/junction-hackathon/blob/feat/planning-coach/src/budget-coach.mjs) |

## Build in this order

### 1. Persist customer plans

Keep the imported bank database read-only. Add a separate ignored SQLite store, for example `data/local/plans.sqlite`, with a schema initializer/migration.

Store:
- Stable plan ID and customer ID, observation cutoff, revision, timestamps.
- Exact preferences: buffer, savings target, category protections/floors/overrides, and confirmation flags.
- Planned expenses with stable IDs, date, amount, label/category, optional account/merchant IDs, inclusion state, lifecycle status, and any matched transaction ID.
- Selected alternative and the plan revision it was computed from.
- An audit of meaningful edits and matching decisions, including whether the customer or matching rule made them.

Preserve the coach's existing inclusion vocabulary: `additional`, `already_included`, `unsure`.
Keep this separate from lifecycle status such as `planned`, `matched`, or `cancelled`. “Included in the forecast” does not mean “already paid.”

Recommended routes, **new proposals rather than existing endpoints**:
- `GET /api/customers/{customerId}/plan`: load saved state plus recalculated results, or return an explicit no-saved-plan response.
- `PUT /api/customers/{customerId}/plan`: save a validated full state after explicit customer action, using `expectedRevision` and `mutationId`.
- Extend the existing stateless `POST /api/plan` for expense previews and alternative calculations. Previewing must not save or approve anything.

Use atomic writes, revision conflict responses (409), and idempotent mutations. Retrying the same mutation must not duplicate an expense or plan change. Reject conflicting reuse of a mutation ID. A failed calculation must not be presented as a successfully updated financial plan.

Persist pending input separately from the last successfully calculated/accepted state if needed. On error, restore both the pending choices and the last valid result without claiming that the latter reflects those choices.

Scope every load, expense mutation, match, and option selection to its customer and plan. Customer IDs are a demo selector, not production authentication. Keep the service bound to localhost.

### 2. Incorporate confirmed additional expenses once

Suggested additive request field:

```json
{
  "plannedExpenses": [
    {
      "id": "repair-001",
      "date": "2026-10-07",
      "amountCents": 20000,
      "category": "Transportation",
      "label": "Car repair",
      "inclusion": "additional"
    }
  ]
}
```

This is added to the existing request's customer, cutoff, buffer, target, and preference fields. Support multiple expenses by stable ID. Validate shapes, dates, amounts, duplicates, and customer ownership. Updates replace the expense with the same ID; they do not append another charge.

Routing:
- After cutoff and on/before the horizon's last day: include as an explicit dated outflow.
- After the horizon: reserve as a later commitment.
- `already_included`: do not add another outflow; preserve the existing inclusion-review rules.
- `unsure`: retain a blocker and ask for clarification.
- A past-due unmatched expense needs review; do not silently discard it or repeatedly charge it every day.

Derive horizon routing from one canonical expense store. As the cutoff advances, move an expense from later reserve to dated outflow exactly once. Reject duplicate IDs appearing simultaneously in legacy `futureCommitments` and `plannedExpenses`, rather than guessing how to combine them.

Keep the historical base forecast intact. Produce an explicit plan scenario containing the known-expense adjustment; use that scenario consistently for plan savings, budgeting and recovery alternatives.
Each added expense affects balances on its date and later, not earlier. Maintain daily net-change/component reconciliation in integer cents.

Known obligations are locked: an added repair must not be cut away merely because Transportation or another category is adjustable. Add an explicit locked commitment component or reserve constraint understood by the budget engine. Avoid subtracting it both from the scenario and again as a future reserve.

The existing calibrated base range does **not** automatically establish coverage for a changed plan. Use conditional bounds and `calibrationCoverageClaimApplies: false`; retain model/data eligibility checks. Do not simply attach an old calibration label to changed balances to bypass those checks. Update savings and coach contracts together.

Expose the basis clearly: historical forecast, expense-adjusted plan, and each recovery alternative. The coach must never combine numbers from different scenarios into one apparent recommendation.

### 3. Calculate and select recovery alternatives

Evaluate feasibility after incorporating the confirmed obligations.

Return up to two independently calculated options:
1. **Save less:** keep the customer's existing spending plan, reduce the savings target only as much as needed, never below zero.
2. **Reduce flexible spending:** retain the savings target and reduce permitted discretionary categories, honoring bills, floors, explicit fixed choices, and dated obligations.

Do not “save less” and quietly reduce restaurants as well. Do not make a spending-cut option feasible by reducing rent or erasing the new repair.

For each option return:
- Stable option ID, source plan revision/cutoff, and exact preference changes.
- Savings target and category limits before/after.
- Scenario daily path, expected low point, conditional buffer shortfall, income constraint, and feasibility.
- Changed assumptions and a short explanation grounded in engine figures.

If an option is impossible, mark it unavailable and explain why. If neither works, return infeasible; do not manufacture a feasible plan. Preserve the difference between conditional savings capacity and the customer's selected savings target.

Generate options without saving them. On selection, verify the revision, recompute against current data, then atomically save the chosen inputs. Stale options must be rejected. Keep existing confirmation-reset behavior when financial inputs change.

### 4. Reconcile planned expenses with actual transactions

Operate on observed transactions only: transaction date must be on/before the current cutoff. Never match against future data during a historical replay.

Start with a strict documented rule:
- Same customer and account, outflow, exact amount, and matching merchant where available.
- A small explicit date window (suggested initial demo policy: three days either side).
- Exactly one eligible transaction and one compatible expense, with no prior competing match.
- The transaction must not predate the point at which the expense was recorded as upcoming.

Category plus amount alone is not enough for automatic matching. The export often lacks merchant IDs; ask the customer in these cases. Keep candidate evidence and a matching reason. Permit rejection or undoing a match. Split/partial payments and refunds may remain manual-review cases for this first version; do not silently mark them fully settled.

After a match, the actual payment already affects the observed account balance. Stop adding the planned outflow or later reserve; do not subtract the payment again. Maintain a one-to-one ledger link and history. Repeated imports/reconciliation must be idempotent.

For unresolved possible matches, show a review state rather than claiming a reliable combined savings recommendation.

### 5. Wire into the existing coach

Extend both client request validation and Python validation with the same contract.
Update:
- `captureCoachInputs`: route reviewed in-horizon expenses to the engine instead of its current blanket blocker.
- `captureFinancialPlanInputs`: preserve stable expense IDs, preferences, revisions, and pending choices.
- `fetchFinancialPlan` / `previewFinancialPlanChange`: handle the new scenario/alternative output without dropping state or mixing old/new panels.
- Coach rendering: consume engine amounts and reasons; do not recalculate money in JavaScript.
- Loading: restore saved plan state, not merely fixtures or reconstructed category defaults.

Keep blockers for uncertain inclusion, stale revisions, incomplete source data, and ambiguous matches. Refresh all affected panels only after a complete validated response. Retain the existing customer/date checks and stale-response handling.

## Acceptance tests: the task is done when these pass

1. Save a EUR 200 expense, restart the server, reload the same customer: expense and chosen preferences remain.
2. Another customer cannot load, mutate, match, or select the first customer's state.
3. Previewing never persists; repeated save/retry never adds another EUR 200.
4. For a dated extra expense, earlier daily balances are unchanged; affected balances are EUR 200 lower exactly once. Components reconcile.
5. Multiple expenses sum correctly; editing/removing an expense recalculates reversibly.
6. Final-horizon-day expenses are outflows; next-day expenses are reserves. Advancing the cutoff never creates both deductions.
7. Included or uncertain expenses are not silently charged again. Past-due unresolved expenses remain visible.
8. Strict unique matches settle an expense; ambiguous, missing-merchant, duplicate, partial, and refund cases require review. Rejection/undo works.
9. On advancing the cutoff past a matched payment, the starting balance reflects the transaction and no planned duplicate remains.
10. “Save less” changes only savings; “reduce spending” preserves the savings target and protected costs. Impossible alternatives stay infeasible.
11. Reload restores the selected option; stale/concurrent edits receive a conflict and do not overwrite newer choices.
12. Failed API calls retain the prior valid display plus pending input. Conditional scenario ranges never claim newly measured coverage.

Use deterministic fixtures for arithmetic and matching, plus at least one real-engine end-to-end test. For payment matching, replay dates **within the export** (for example August 31 to a September cutoff); October actual transactions are not available. Do not invent October transactions and describe them as sponsor observations.

Run the relevant existing suites from the coach branch:

```sh
python3 -m unittest discover -s tests -v
npm test
python3 scripts/check_financial_api.py
npm run check:coach-api
```

The API checks require the prepared database. Add tests for the new behavior; preserve the existing baseline behavior when no saved expenses are supplied.

## Deliverables and scope boundaries

Deliver one reviewed backend/coach change with:
- Saved-plan store and migration.
- Expense-aware preview/calculation and recovery options.
- Matching/review lifecycle.
- Updated API and coach contracts.
- Reproducible examples covering feasible, infeasible, and ambiguous-match cases.
- Test results and a brief setup/demo walkthrough.

No new forecast training, automatic transfers, investment recommendations, live bank integration, or production-security claims are part of this task.

Suggested implementation priority: first finish save → reload → expense-adjusted calculation → coach display. Then add both recovery alternatives and matching before declaring this handoff complete. Report any remaining limitations explicitly.
