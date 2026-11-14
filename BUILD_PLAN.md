# Personal Economic Trainer

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

- Profile the bank dataset first. Check whether it has stable customer and transaction IDs, enough history per customer, merchant and category fields, and coverage of income, transfers, and balances. Normalize the fields that exist and carry through source transaction IDs.
- Use the bank dataset to learn patterns across customers. Start with one measurable task, such as predicting the next date and typical amount of a recurring bill. Compare it with a baseline based on the observed interval and median amount. If the dataset has useful category labels, categorization can be a separate task.
- At runtime, use the customer's own history to calculate their profile and choose what to show. Pass detected patterns, estimates, confidence, and evidence IDs to the planning engine. The engine calculates amounts and evaluates tradeoffs. An explanation model can turn the result into plain language with the app supplying the figures.
- Evaluate on customers held out from training and predict later transactions using only earlier history. Track date and amount error and incorrect recurring bill predictions. Include profiles with sparse history or irregular income. When evidence is weak, show an observation or ask for a focused confirmation before relying on the forecast for a recommendation.
- Demo the same flow with two customers whose histories produce different actions. For example, one gets a goal recovery option based on flexible spending, while another gets a reminder about a recurring bill before their next expected income.

## Calculation and data

- Keep all amounts in integer euro cents. The engine owns calculations and returns figures, assumptions, and transaction IDs. The UI formats numbers. A language model can explain the result using those figures. The initial implementation can use a template.
- Normalize the bank dataset behind an adapter. Preserve transaction IDs and categories. Until that adapter is ready, use the synthetic fixture, whose planning periods already include projected cash available before the new expense.
- Count expenses once. Subtract the new expense from the period it falls in. Keep goal savings already set aside separate from future cash. Preview a spending reduction only if that spending is already in the projection.
- Show projections as conditional on the inputs. If balances, bills, or income are missing, name what is missing and avoid implying the plan covers all of the customer's finances. Surface periods with negative projected cash separately, even if a later period makes up for them.
- The initial [calculation module](src/coach.mjs) takes the goal, planning periods, delivery history, and new expenses. It returns the baseline projection, a breakdown by period, and a conditional recovery option. The app's next step is to render that result and source evidence.

## Three build assignments

| Owner | Owns | Hands off |
| --- | --- | --- |
| Mobile app and integration | Set up the mobile web app. Build the home card, evidence view, and action preview. Own shared components and merges. | A runnable app that displays an insight and lets the customer inspect and try the proposed action. |
| Data and predictions | Normalize bank transactions, identify recurring bills and subscriptions, and flag a developing spending pattern. | Two customer histories and a feed of detected signals with transaction IDs and any uncertainty. |
| Planning and coach | Calculate category budgets, savings projections, and purchase scenarios. Turn the results into explanations and small experiments the customer can try. | A function that takes a customer profile and returns an action with calculated amounts and evidence. |

Agree on two handoffs before splitting into branches. Data and predictions passes detected signals and evidence to Planning and coach, which passes the recommended action and calculated amounts to the mobile app. Use fixture examples for both handoffs so all three people can start in parallel. Integrate one insight with an explanation and action preview before adding more categories, settings, or coaching features.
