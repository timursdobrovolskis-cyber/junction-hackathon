# Income model, calibrated uncertainty, and savings previews

The second iteration adds a small trained payday model, a separately calibrated 30-day balance range, and a conditional savings calculation. The original `calendar-scenarios-v1` remains available as the comparison baseline. The new model is `conditioned-income-v2`.

## Measured result

Training used eligible salaries through **2026-04-30**, excluding the customer bucket reserved by the existing SHA-256 split. The model learns cross-customer counts of payday dates and transitions between consecutive single-salary months. It combines those counts with each customer's own recent history; it is not a language model or 5,100 separately trained models.

Model selection used 4,105 development customers at the May 31 and June 15 cutoffs (8,210 forecasts). The candidate's daily balance error improved **12.30%** versus v1. Calibration used those customers at July 31, with outcomes through August 30. Final evaluation used **995 different customers** at August 31, with outcomes through September 30. No evaluation-customer outcomes were used to fit, select, or calibrate v2. Their v1 aggregate results had been inspected in the previous iteration, so this is not a completely unseen benchmark across the project's lifetime.

| Final evaluation metric | v2 | v1 on the same customers/date |
| --- | ---: | ---: |
| Daily mean absolute balance error | €802.70 | €819.23 |
| Final-day mean absolute balance error | €840.97 | €826.86 |
| Lowest-balance mean absolute error | €523.32 | €519.28 |

The held-out daily improvement is **2.02%**. Final-day and lowest-balance errors slightly worsen. This is a modest daily improvement, not a general accuracy breakthrough. Uncalibrated v2 scenario coverage is only **59.99%** of daily observations: the income expectation reduces raw scenario spread.

The calibrated range covered the **entire 30-day actual path in 909 of 995 cases (91.36%)**, and **97.69% of daily observations**. Achieving that required expanding each side of the scenario envelope by **€2,438.53**. This large margin is useful evidence that the model is still uncertain. It must not be hidden in the UI or described as precise individual financial advice.

The complete [machine-readable report](income-v2-evaluation.json) includes counts and metrics. In that report, fields prefixed `flat` refer to the frozen v1 calendar model, not the older constant-daily baseline; this is stated in `comparisonNote`.

## Income behavior

- Replace salary templates only for recently observed monthly salary groups with exactly one payment in every examined complete month. Other income groups retain the original historical-scenario behavior.
- Estimate the next amount using the median of the customer's last three salary payments. This amount is customer-specific and uses only pre-cutoff observations.
- Combine the customer's last six payday tokens with learned transition counts and a small global prior. Payday tokens distinguish day numbers from offsets within the last four days of a month.
- When no salary has arrived this month, remove dates that have already passed and renormalize the remaining date weights. When salary has already arrived, add no second payment this month.
- Allocate integer cents over the remaining payday possibilities without losing or inventing a cent of the monthly estimate. Expected income is distributed over dates; it is not a promise of installments.
- Keep future transactions out of both profile and income calculations. Reject a model trained after the requested forecast cutoff.

## Calibration behavior

For each calibration customer, score the largest amount by which any actual daily balance falls outside that forecast's scenario envelope. The finite-sample 90th-percentile path score expands both bounds for all 30 days. One complete customer path is one calibration observation.

Calibration is tied to a hash of the exact fitted model, the 30-day horizon, and its last observed outcome date. Mismatched artifacts, a different horizon, or a forecast cutoff earlier than the calibration outcomes are rejected. Coverage depends on stability of the synthetic population; temporal change or a particular customer's circumstances can defeat it. No individual guarantee follows from the 90% target.

The calibrated forecast adds `calibration` and, for each daily row, `calibratedLowerBalanceCents` and `calibratedUpperBalanceCents`. The old scenario-bound fields remain available and are still uncalibrated. The UI should use the calibrated fields when displaying the new range. Existing `possibleBelowBufferDates` still refers to raw scenario bounds; compare calibrated lower bounds with the supplied buffer for a calibrated-range warning.

## Savings calculation

The engine previews a one-time amount that could be set aside now:

```text
capacity = max(0,
    min(current balance, every calibrated lower daily balance)
    - chosen cash buffer
    - supplied future-cost reserves)
```

Costs beyond the forecast horizon are fully reserved without assuming later income. Each must have a unique `id`, an ISO `date`, and nonnegative integer `amountCents`. Costs within the forecast horizon must be incorporated into that forecast; they are rejected here to prevent accidental double counting. The engine does not claim to have discovered all future irregular costs from the transaction history.

Savings is withheld for insufficient history, unreviewed inputs, uncalibrated forecasts, or multiple accounts whose separate liquidity has not been modeled. The current export has one visible account per customer.

By default the result is `status: "needs_confirmation"`, with `conditionalCapacityCents` for a preview and `suggestedSavingsCents: null`. Confirming the known commitments explicitly produces `conditional_estimate` and a suggested amount. That confirmation does not remove forecast uncertainty. `movesMoney` is always false.

For the three supplied synthetic examples, using an **illustrative €500 buffer** and **no supplied additional costs**, capacities are €400.79, €0, and €2,861.39. All remain unconfirmed. The buffer is a demo input, not a recommended amount for every customer.

In historical evaluation, 529 of 995 customers had positive savings previews under those assumptions. **Three of those 529 previews would have breached the €500 buffer** on actual future balances. These failures remain in the report. Do not label the estimate guaranteed safe or wire it to automatic transfers.

## Run

Prepare the bank database as described in [data preparation](README.md). Fitted [income](models/income-v2.json) and [calibration](models/income-v2-calibration.json) artifacts are included for reproduction.

```sh
python3 scripts/forecast_savings.py --as-of 2026-09-30 --customer-id CUST00001 --customer-id CUST00002 --customer-id CUST00003 --buffer-cents 50000 --output fixtures/savings-demo.json
python3 -m unittest discover -s tests -v
```

The resulting [UI examples](../fixtures/savings-demo.json) contain a `forecast` and `savings` object per customer. For one customer's known future costs, pass `--future-cost-file path/to/costs.json`. Only pass `--commitments-confirmed` after that customer's commitments have actually been checked. No flag makes or authorizes a bank transfer.

To reproduce training, development selection, calibration, and evaluation:

```sh
python3 scripts/improve_forecast.py
```

Results are written under `data/local/income-experiment/`; the script does not automatically overwrite the shared fitted artifacts. The shared artifacts are copies of this successful run. Training source hashes and revision are included in the income artifact. The 35-test suite checks historical isolation, paid/unpaid salary handling, model/calibration cutoffs, finite-sample scoring, exact buffer preservation, future-cost reserves, and withholding unsafe or incomplete inputs.

## Next work

Integrate the calibrated forecast and unconfirmed savings preview into the UI/coach using these examples. To improve the model further, investigate spending and one-off expenses rather than presenting the modest payday gain as sufficient. Reducing the wide uncertainty margin is still necessary for more useful savings estimates. [Category budgets and edit previews](CATEGORY_BUDGETS.md) are now implemented on top of these calculations.
