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
