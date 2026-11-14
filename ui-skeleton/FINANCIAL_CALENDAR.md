# Financial calendar UI branch

This branch adds the Calendar tab to the latest `codex/frontend-coach-preview`
app (base `2fc66c4`). It preserves the updated Home/Coach copy, Gemini endpoint,
S-Pankki colours, typography, phone preview and persistent navigation. Changes
are confined to `ui-skeleton/`; it does not merge the separate planning backend.

## Run

```sh
cd ui-skeleton
npm run dev
```

Open http://127.0.0.1:4174/spendvest.html#calendar or the phone preview at
http://127.0.0.1:4174/preview.html and select Calendar. No installation, build,
Gemini key, or Python service is required for the included calendar examples.
If another preview is running, use `PORT=4175 npm run dev`.

## What works

- A month grid, day selection and cost/income/yearly filters.
- Automatically populated payment windows from generated financial-engine data.
- Monthly recurring candidates and possible yearly subscription/renewal costs.
- Payment details with source transaction IDs and uncertainty explanations.
- Estimated daily balances and buffer-risk markers inside the supplied forecast
  horizon. Later recurring entries are reminders, not invented balance forecasts.
- Accessible navigation and dialogs, mobile layout, and retention of the previous
  calendar when a new request fails.

The default example is synthetic customer CUST00005 with observations through
30 September 2026 and a 30-day October forecast. The recurring-cost example is
a separate fictional ledger illustrating monthly bills and an annual renewal
in November 2026. Home's sample amounts are separate. An annual candidate is
not a verified subscription, and this UI neither schedules payments nor edits
the customer's saved financial plan.

## Integration and deployment

`api/calendar.js` serves the two generated examples from `server/calendar/`.
The Vercel configuration includes that endpoint and its fixtures. This branch
can be deployed independently using the UI project's existing deployment setup;
creating or merging the branch does not itself establish a new deployment.
Any existing Vercel automatic branch previews are controlled by that project.

For a live local calculation, set `FINANCIAL_ENGINE_URL` in `.env.local` and run
the Python service from the companion
[planning/calendar backend branch](https://github.com/timursdobrovolskis-cyber/junction-hackathon/tree/feat/planning-coach).
That service must include calendar commit `47b7b64` or a descendant. The older
frontend branch's Python engine does not have `/api/calendar`. Do not configure
the URL until the compatible service is running; a failed upstream request is
shown as an error rather than silently falling back to sample data.

The backend's recurrence rules, generator, source limitations and API contract
are in the [backend calendar guide](https://github.com/timursdobrovolskis-cyber/junction-hackathon/blob/47b7b64d711c5cbcb2e69b1875c433664f9772ff/docs/financial-calendar.md).
Financial amounts remain engine outputs; the UI does not recalculate forecasts.

## Validation

`npm test` runs the existing coach checks and the calendar API/presentation tests.
Browser verification covers the latest Home and Coach screens, Calendar in the
phone preview, monthly/yearly examples, source evidence, mobile navigation,
forecast boundaries, and failed calendar requests. Real Gemini replies require
the separately configured server key and are not part of this calendar change.
