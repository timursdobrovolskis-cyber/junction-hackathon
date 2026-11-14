# Next frontend integrations

The [Financial Calendar UI](FINANCIAL_CALENDAR.md) is now implemented on
`feat/financial-calendar-ui`, based on this frontend's latest preview. It runs
with generated engine examples and an optional compatible backend connection.
Merge this focused UI branch into `codex/frontend-coach-preview` to include it
in that app's next deployment. Saved-plan editing and shared live customer state
remain separate integrations below.

## 1. Connect “Check a purchase” to the forecast

Status: the Python engine already accepts `plannedPurchase` and returns `purchasePreview`. The deployed website only collects amount/date; it does not call that engine yet. See `src/purchase_preview.py`, `src/financial_engine.py` and `data/DEMO_WALKTHROUGH.md` in the main project checkout.

- Use the same selected customer, as-of date, forecast and buffer for Home, purchase checks and Coach. Replace the hard-coded November Home amounts before wiring historical October forecasts into this screen.
- Enter amount, date and category. Clarify whether this is extra spending beyond the forecast so planned spending is not counted twice.
- Call the engine with `plannedPurchase: {date, amountCents, category}`. Keep all calculations on the server.
- Show a compact before/after result: projected balance, lowest expected balance and date, buffer shortfall, and how much less could be saved. Expand for the daily path and assumptions.
- Use `endingExpectedBalanceBeforeCents`, `endingExpectedBalanceAfterCents`, `lowestExpectedBalanceAfter`, `bufferShortfallAfterCents`, `savingsCapacityBeforeCents` and `savingsCapacityAfterCents` from `purchasePreview`.
- Label the actual forecast end date. Only say “until payday” once the engine genuinely calculates that horizon. Current engine previews cover 30 days.
- Handle missing data, out-of-window dates and withheld results. No positive affordability verdict when the engine cannot support one.
- Let the customer change the amount/date or dismiss the preview. No transactions, savings transfers or saved-plan changes occur.
- Pass the exact result to Coach for explanations; Gemini must not invent an alternative calculation.

Acceptance: a dated extra purchase lowers the projected path only from that date; the interface matches engine output for comfortable, tight and insufficient-data cases; clearing the purchase restores the baseline.

## 2. Keep the experience customer-facing

- Use natural language such as “You have €640 until payday” and “€240 is set aside for bills”.
- Keep sample-data provenance in one persistent label and the data-information panel, not repeated in every paragraph or coach reply.
- Keep meaningful uncertainty, historical dates and unavailable actions explicit. Never imply a bank connection, a saved change or a calculated purchase result that does not exist.

## 3. Finish shared plan integration

- Connect the selected customer's results across Home and Coach.
- Integrate the teammate's confirmed plan-change flow before claiming changes are saved.
- Test the same customer through Home → purchase check → Coach, including failed requests and switching profiles.
