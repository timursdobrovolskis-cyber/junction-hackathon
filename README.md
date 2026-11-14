# Junction Hackathon

Start with [the build plan and current workflow](BUILD_PLAN.md) for the product direction, completed work, next steps, and three-person team responsibilities.

- [Prepare the bank data](data/README.md).
- [Generate customer profiles and understand their fields](data/PROFILE_CONTRACT.md).
- [Use three synthetic customer profiles](fixtures/customer-profiles.jsonl) for UI and coach integration.
- [Generate 30-day cash-flow forecasts](data/CASH_FLOW_CONTRACT.md) and [inspect historical evaluation](data/FORECAST_EVALUATION.md).
- [Use the trained income model, calibrated forecast, and conditional savings preview](data/INCOME_AND_SAVINGS.md).

## Run the planning and coach module

Requires Node.js 22 or later; no dependencies or API keys are needed.

```sh
npm test
npm run demo
npm run demo:history
```

Person Three's implementation provides category budgets, goal projections, purchase
and recovery previews, and evidence-backed coach actions. See the
[integration contract](docs/planning-coach.md) and
[two customer fixtures](fixtures/planning-profiles.json). These are illustrative
examples. The history demo additionally analyzes 218 organizer-provided synthetic
S-Bank transactions for two customers, using June–September 2026 and a historical
reference date of October 1. It reports spending changes, income variation, and
per-account observed low balances with source references. See the
[historical analysis guide](docs/historical-coach.md) to connect another customer.
The mobile interface, live bank connection, and LLM chat are separate work.
