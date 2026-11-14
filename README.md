# Junction Hackathon

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
