# One endpoint for the UI and coach

The local Python engine returns a customer's 30-day forecast, conditional savings estimate, and category budget in one request. It uses their own transaction history and the fitted income model. It works with any customer in the prepared 5,100-customer dataset; no retraining per customer or OpenAI API key is needed.

Run commands from the repository root with Python 3.11 or newer. First follow [data preparation](README.md) to create the ignored local SQLite database. Fitted model files are already included.

## Run a request

```sh
python3 scripts/run_financial_engine.py --request fixtures/financial-plan-request.json
```

This writes `data/local/financial-plan.json`. The same [request](../fixtures/financial-plan-request.json) and its [complete response](../fixtures/financial-plan-demo.json) are included so teammates can start without downloading the dataset.

## Connect the frontend

```sh
python3 scripts/run_financial_engine.py --serve --port 8765 --allow-origin http://localhost:3000
```

Set `--allow-origin` to your actual local frontend origin, including its port. Each teammate can run their own local engine. The server binds to `127.0.0.1`; it is not a deployed shared service. Stop with Ctrl-C.

```js
const response = await fetch('http://127.0.0.1:8765/api/plan', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    customerId: 'CUST00005',
    asOf: '2026-09-30',
    bufferCents: 50000,
    savingsTargetCents: 10000,
    savingsConfirmed: false,
    commitmentsConfirmed: false
  })
});
const result = await response.json();
if (!response.ok) throw new Error(result.error);
// Render result.forecast, result.savings, result.budget.
```

The €500 buffer and €100 savings target above are illustrative user preferences. All monetary values are integer euro cents. `asOf` means the last date of observed history, not today's date; this export ends September 30, 2026. With the included calibration, use cutoffs from August 30 through September 30, 2026.

Required fields: `customerId`, `asOf`, `bufferCents`, `savingsTargetCents`. Optional fields:

- `commitmentsConfirmed` and `savingsConfirmed`: booleans, false by default. Only set them after the relevant customer inputs have been reviewed.
- `futureCommitments`: array of `{id, date, amountCents}` for known costs **beyond** the 30-day horizon. In-horizon costs are rejected here because they must be incorporated in the forecast itself.
- `adjustableCategories`: array of category names the customer permits changing.
- `minimumCategoryCents`: category-to-minimum-spending map.
- `categoryOverrides`: category-to-requested-budget map; send another request to preview an edit.

Unknown fields and invalid inputs return HTTP 400. Unknown routes return 404; disallowed browser origins return 403. `GET /health` reports the loaded model version, not database readiness. This is an unauthenticated local development adapter; customer authentication and authorization are required before connecting real accounts or deploying it.

## What to show

Use [forecast fields](CASH_FLOW_CONTRACT.md), [calibrated ranges and savings states](INCOME_AND_SAVINGS.md), and [budget/edit fields](CATEGORY_BUDGETS.md). Preserve the response's warnings, assumptions, supporting transaction IDs, confirmation state, and infeasible-plan state. Savings previews do not move money. A budget edit is conditional on changed behavior; its forecast has no newly measured coverage guarantee.

The default remains `conditioned-income-v2`. Its measured daily balance error is €802.70 on 995 reserved synthetic customers, so display uncertainty alongside the central forecast. The [bounded spending-model experiment](SPENDING_MODEL_EXPERIMENT.md) did not improve this result and was not promoted.

## Verify

```sh
python3 -m unittest discover -s tests -v
python3 scripts/check_financial_api.py
```

The HTTP check requires the prepared database, starts an ephemeral localhost server, compares an actual response with the committed fixture, checks error handling and CORS, then stops the server. No external API calls are made.
