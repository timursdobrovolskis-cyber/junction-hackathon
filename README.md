# Junction Hackathon

Start with [the build plan and current workflow](BUILD_PLAN.md) for the product direction, completed work, next steps, and three-person team responsibilities.

- [Run the combined forecast, savings, and budget API](data/FINANCIAL_ENGINE.md) for UI and coach integration. No API key required.
- [Review the spending-model experiment](data/SPENDING_MODEL_EXPERIMENT.md): v2 remains the default because v3 performed worse on reserved customers.
- [Prepare the bank data](data/README.md).
- [Generate customer profiles and understand their fields](data/PROFILE_CONTRACT.md).
- [Use three synthetic customer profiles](fixtures/customer-profiles.jsonl) for UI and coach integration.
- [Generate 30-day cash-flow forecasts](data/CASH_FLOW_CONTRACT.md) and [inspect historical evaluation](data/FORECAST_EVALUATION.md).
- [Use the trained income model, calibrated forecast, and conditional savings preview](data/INCOME_AND_SAVINGS.md).
- [Generate personalized category budgets and preview edits](data/CATEGORY_BUDGETS.md).

## Run the planning and coach module

For the combined live API, start with the [coach integration guide](docs/financial-coach-integration.md). Run `npm run demo:api-coach` after starting the local engine, or add `-- --fixture` to inspect the saved response offline.

Start with the shared-engine coach: [frontend and input contract](docs/engine-coach.md).
The [budget coach contract](docs/budget-coach.md) covers all four budget examples and real Python engine recalculation after category edits.
It explains the three entries in `fixtures/savings-demo.json` and captures customer
answers for recalculation. Requires Node.js 22 or later; Python 3 is also needed for
the engine integration test. No additional packages or API keys are needed.

```sh
npm test
npm run demo:coach
npm run demo:budget-coach
npm run demo
npm run demo:history
```

Earlier standalone work provides category budgets, goal projections, purchase
and recovery previews, and evidence-backed coach actions. See the
[integration contract](docs/planning-coach.md) and
[two customer fixtures](fixtures/planning-profiles.json). These are illustrative
examples. The history demo additionally analyzes 218 organizer-provided synthetic
S-Bank transactions for two customers, using June–September 2026 and a historical
reference date of October 1. It reports spending changes, income variation, and
per-account observed low balances with source references. See the
[historical analysis guide](docs/historical-coach.md) to connect another customer.
The mobile interface, live bank connection, and LLM chat are separate work.
