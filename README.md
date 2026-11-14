# Junction Hackathon

## Website and releases

The complete website is in [ui-skeleton](ui-skeleton/) on **main**: Home, Goals,
Coach, Budget and the latest Financial Calendar. Run `npm run dev:app` to open it
locally, or `npm run test:app` for the UI checks. The root React goals app and
Python engine remain available with their existing commands.

Production: https://junction-money-ui.vercel.app/spendvest.html#calendar

Merge frontend changes into main before publishing. From a clean checkout at
origin/main, run `npm run deploy` using the existing Vercel project credentials.
The command checks the branch version and runs UI tests before deploying.
Deployments replace the whole site; do not deploy an old feature checkout.
See [the integration guide](ui-skeleton/TEAM_INTEGRATION.md) for the source and
release workflow. Manual Vercel/dashboard releases bypass the local guard.


Start with [the build plan and current workflow](BUILD_PLAN.md) for the product direction, completed work, next steps, and three-person team responsibilities.

- [Run the combined forecast, savings, and budget API](data/FINANCIAL_ENGINE.md) for UI and coach integration. No API key required.
- [Review the spending-model experiment](data/SPENDING_MODEL_EXPERIMENT.md): v2 remains the default because v3 performed worse on reserved customers.
- [Prepare the bank data](data/README.md).
- [Generate customer profiles and understand their fields](data/PROFILE_CONTRACT.md).
- [Use three synthetic customer profiles](fixtures/customer-profiles.jsonl) for UI and coach integration.
- [Generate 30-day cash-flow forecasts](data/CASH_FLOW_CONTRACT.md) and [inspect historical evaluation](data/FORECAST_EVALUATION.md).
- [Use the trained income model, calibrated forecast, and conditional savings preview](data/INCOME_AND_SAVINGS.md).
- [Generate personalized category budgets and preview edits](data/CATEGORY_BUDGETS.md).
