# Personal Economic Trainer

## Current workflow and progress

This is the shared overview of the build sequence and responsibilities. Update this section when a stage is implemented or its validation changes. Status below describes work verified in this local checkout; it does not establish what teammates have built elsewhere or what has been pushed to GitHub.

We use one shared calculation engine to produce a separate result for each customer from their own history. All 5,100 synthetic customers now have profiles. These are individual calculations, not 5,100 separately trained models. In the intended app, each customer sees their own results.

| Stage | What happens | Current status |
| --- | --- | --- |
| 1. Prepare data | Load transactions and customers, check balances, distinguish spending from account movements. | Done locally: 3,626,755 transactions, 5,100 customers, zero mismatches across checkable adjacent balances. Sweep destinations remain unknown. |
| 2. Build profiles | Calculate income patterns, recurring bill groups, category spending, unusual expense candidates, and evidence. | Done locally for all 5,100 customers at cutoff 2026-09-30. Eleven tests and full-output consistency checks passed. |
| 3. Forecast cash flow | Project daily balances for 30 days, upcoming payments, the lowest balance, and uncertainty. | v1 baseline evaluated across all 5,100 customers. Trained income v2 improves daily error 2.02% on 995 reserved customers; final-day error slightly worsens. Separately calibrated bounds cover 91.36% of complete paths, with a wide margin. |
| 4. Estimate affordable savings | Find what could be set aside while preserving a chosen cash buffer throughout the forecast; account for known irregular costs beyond that horizon. | Conditional preview implemented using calibrated lower balances, an explicit buffer, and supplied future costs. Suggestions remain unconfirmed by default. Historical previews include three buffer breaches; no guarantee or money movement. |
| 5. Generate category budgets | Allocate spending within income, commitments, and the savings plan. Recalculate the forecast when a budget changes. | Implemented locally: protected categories, proportional discretionary limits, explicit targets, daily-buffer checks, and category-edit previews. Accounting checks passed for all 5,100 customers. Infeasible plans are flagged; changed-behavior previews have no new calibration guarantee. |
| 6. Connect coach and UI | Hand over calculated amounts, dates, assumptions, and evidence. Explain and display them, with previews of changes. | Coach functions explain all three forecast/savings examples and all four budget examples, including infeasible plans. Category edits call the shared Python budget engine and return a new conditional preview; failures preserve the previous result. UI/server-route wiring and engine support for new in-horizon expenses remain outstanding. The older coach goal fixture remains standalone. |

Build a transparent baseline first. For each stage: implement it, check representative cases, validate against the available data, document the output, and hand it to the other lanes. A small payday-transition model is now trained on earlier observations, with separate development, calibration, and evaluation periods. Its modest held-out gain and remaining errors are documented rather than treating training itself as success.

### Where to find the work

- [Data preparation](data/README.md): source downloads, import commands, and verified coverage.
- [Profile contract](data/PROFILE_CONTRACT.md): generation commands, output fields, detection rules, and limitations.
- [Three customer examples](fixtures/customer-profiles.jsonl): synthetic profiles the UI and coach can consume now.
- [Profile engine](src/financial_profile.py) and [batch runner](scripts/build_profiles.py): shared calculations and per-customer generation.
- [Profile tests](tests/test_financial_profile.py): historical cutoff, income, spending, transfers, and evidence checks.
- [Forecast contract](data/CASH_FLOW_CONTRACT.md) and [three forecast examples](fixtures/cash-flow-demo.json): daily balance paths, uncertain payment windows, and evidence for the UI and coach.
- [Forecast evaluation](data/FORECAST_EVALUATION.md): measured errors, held-out partitions, limitations, and the next modeling priorities.
- [Income v2 and savings](data/INCOME_AND_SAVINGS.md): trained payday model, calibrated uncertainty, conservative savings calculation, measured limitations, and integration commands.
- [Calibrated forecast and savings examples](fixtures/savings-demo.json): three synthetic customers with a clearly labeled demo buffer.
- [Category budget contract](data/CATEGORY_BUDGETS.md), [four example plans](fixtures/budget-demo.json), and [a category-edit preview](fixtures/budget-adjustment-demo.json): integration fields, rules, and feasibility checks.

- [Shared-engine coach contract](docs/engine-coach.md) and [response function](src/engine-coach.mjs): renderable explanations, one material follow-up question, and pending customer inputs. Run `npm run demo:coach`.

- [Budget coach contract](docs/budget-coach.md), [response function](src/budget-coach.mjs), and [server adapter](src/budget-engine-client.mjs): four customer explanations and a real category-edit round trip. Run `npm run demo:budget-coach`.

Next wire the coach responses and budget adapter into the app UI/server, including input confirmation and infeasible-plan handling. Investigate spending and one-off expense errors to reduce the wide uncertainty range. Forecasts and counterfactual plans must retain their assumptions and confirmation state.

Raw data, the SQLite database, and all-customer outputs live under `data/local/` and are ignored by Git. Share the code, documentation, and small synthetic examples; teammates can reproduce the full output using the documented commands.

## Product direction

Build a mobile coach for S-mobiili that helps customers at any life stage understand what is coming up and make a plan around what matters to them. On opening the app, the customer sees a useful observation or suggested action based on their transaction history. If they choose a savings goal, the coach uses that same history to suggest a contribution and timeline, then adjusts the projection as their finances change. The customer can inspect the evidence, correct assumptions, and choose whether to follow the plan.

Personalize using observed patterns such as income timing, recurring obligations, and spending habits. Use the challenge's three spending baskets to distinguish regular obligations, irregular obligations, and everyday spending that can be adjusted. Prefill what the data supports. Ask for a customer's goal only when they want a goal plan, and ask for a correction or missing commitment only when it would materially change the recommendation. Avoid assuming an age, life stage, or goal from transactions.

The partner described attracting people back to S-mobiili as the business goal. Measure whether people return to check a plan after their finances change and whether they make progress toward a goal. Treat adoption of S-Bank as a primary bank as a longer-term outcome to validate separately. The coach can explain savings options in general. Also keep the S-mobiili integration conceptual for the prototype.

## First end-to-end experience

1. The customer opens the app and sees one action based on their transaction history, with a way to inspect the evidence.
2. The customer chooses a goal, and the coach suggests a plan using detected income patterns, regular commitments, and spending habits.
3. When an unexpected expense changes the projection, the coach offers an adjustment grounded in the customer's history. The customer previews the impact and can see the supporting transactions.

Use [the shared fixture](fixtures/coach-demo.json) for the initial integration. The same student goes from a projected €270 saved against a €240 goal to €210 after a €60 expense. Three €10 reductions bring the projection back to €240 if the student follows the plan. Selecting a plan changes the projection only. It does not record savings or move money.

## Learning from transaction data

- Data preparation and descriptive profiles are implemented as described above. Customer IDs come from the source; transaction evidence IDs are generated from the source file hash and row number because the export has no transaction ID column.
- Baseline and trained income-model errors have been measured; see both evaluation reports. Income timing yielded only a modest reserved-customer gain. Next investigate flexible spending and one-off costs while preserving separate evaluation data. The current export already supplies category labels.
- At runtime, use the customer's own history to calculate their profile and choose what to show. Pass detected patterns, estimates, confidence, and evidence IDs to the planning engine. The engine calculates amounts and evaluates tradeoffs. An explanation model can turn the result into plain language with the app supplying the figures.
- Evaluate on customers held out from training and predict later transactions using only earlier history. Track date and amount error and incorrect recurring bill predictions. Include profiles with sparse history or irregular income. When evidence is weak, show an observation or ask for a focused confirmation before relying on the forecast for a recommendation.
- Demo the same flow with two customers whose histories produce different actions. For example, one gets a goal recovery option based on flexible spending, while another gets a reminder about a recurring bill before their next expected income.

## Calculation and data

- Keep all amounts in integer euro cents. The engine owns calculations and returns figures, assumptions, and transaction IDs. The UI formats numbers. A language model can explain the result using those figures. The initial implementation can use a template.
- Use the prepared bank store and customer profile contract for data-driven calculations. Preserve generated evidence IDs and source categories. The earlier coach fixture already supplies projected cash available per period; it remains a standalone integration example until the forecast can provide those figures.
- Count expenses once. Subtract the new expense from the period it falls in. Keep goal savings already set aside separate from future cash. Preview a spending reduction only if that spending is already in the projection.
- Show projections as conditional on the inputs. If balances, bills, or income are missing, name what is missing and avoid implying the plan covers all of the customer's finances. Surface periods with negative projected cash separately, even if a later period makes up for them.
- The initial [calculation module](src/coach.mjs) takes the goal, planning periods, delivery history, and new expenses. It returns the baseline projection, a breakdown by period, and a conditional recovery option. The app's next step is to render that result and source evidence.

## Three build assignments

| Owner | Owns | Hands off |
| --- | --- | --- |
| Mobile app and integration | Set up the mobile web app. Build the home card, evidence view, and action preview. Own shared components and merges. | A runnable app that displays an insight and lets the customer inspect and try the proposed action. |
| Data and calculations — this workstream | Prepare bank data, build customer profiles, then implement the shared forecast, affordable savings, and category budget calculations. | Versioned customer results with amounts, dates, assumptions, uncertainty, and transaction evidence. Profile, forecast, savings, and budget examples are ready. |
| Coach and guidance | Explain the calculation engine's results and turn supported insights into suggestions and small experiments. Pass customer choices back to the engine for recalculation. | Customer-facing explanations and actions using the supplied figures and evidence. |

The data lane owns the financial arithmetic. The coach owns explanations, and the app lane owns presentation and integration. Start the coach and app against the shared profile and forecast examples, using the documented contracts. Integrate one insight with evidence and an action preview before adding more categories, settings, or coaching features. Keep separate work scoped to each lane, review changes through GitHub, and rerun the relevant checks when integrating.
