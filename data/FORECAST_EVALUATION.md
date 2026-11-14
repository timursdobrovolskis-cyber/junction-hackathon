# First cash-flow baseline evaluation

`calendar-scenarios-v1` was replayed for all 5,100 synthetic customers at four historical cutoffs: 2026-05-31, 2026-06-15, 2026-07-31, and 2026-08-31. Each forecast covers the next 30 days. Total: 20,400 customer windows and 612,000 daily balance predictions. Every window had sufficient history; none was excluded. The comparison baseline extends the previous 90 days' mean net cash change at a constant daily rate.

No learned parameters were trained. Both methods use only data through each cutoff. Actual future bank balances are read separately for evaluation, carrying balances forward on days without transactions. Results describe the sponsor's synthetic export, not expected real-bank performance.

## Results

| Metric | Calendar scenarios | Flat daily baseline |
| --- | ---: | ---: |
| Mean absolute daily balance error | €827.58 | €1,347.37 |
| Mean absolute final-day balance error | €1,056.97 | €1,139.26 |
| Mean absolute lowest-balance error | €612.64 | €2,023.34 |
| Recall of windows containing a negative balance, using central estimate | 67.04% | 15.76% |
| Precision of negative-balance window flags, using central estimate | 76.32% | 93.57% |

The daily error reduction is **38.58%**, while final-day accuracy improves much less. Average signed daily error is **−€81.19**: on average the estimate is lower than the actual balance. Absolute errors remain too large for a precise affordability promise.

The historical-scenario envelope contained the actual daily balance **70.62%** of the time, with a mean width of **€2,263.13**. It is not a calibrated confidence interval. Flagging a risk whenever any scenario drops below zero detects **91.94%** of windows that actually go negative, but precision falls to **54.43%**. That tradeoff must be visible if the app uses the broader warning.

There were 3,140 windows containing at least one actual negative end-of-day balance. These risk metrics concern whether a window contains any negative day; they do not measure whether the exact negative date was predicted correctly. Intraday overdrafts are not evaluated.

## Separate customer and time checks

Customers are assigned deterministically using the first eight hexadecimal digits of SHA-256(customer ID), modulo five. Bucket zero reserves 995 customers. The latest cutoff, 2026-08-31, reserves a later time period. Neither algorithm fitted parameters to any of these outcomes.

| Evaluation partition | Windows | Daily error | Flat daily error | Reduction |
| --- | ---: | ---: | ---: | ---: |
| Development customers and earlier dates | 12,315 | €823.64 | €1,390.94 | 40.79% |
| Reserved customers, earlier dates | 2,985 | €844.14 | €1,387.54 | 39.16% |
| Development customers, reserved later date | 4,105 | €829.41 | €1,223.71 | 32.22% |
| Reserved customers and later date | 995 | €819.23 | €1,197.82 | 31.61% |

These are evaluation partitions for a fixed baseline, not evidence that a trained model generalizes to unseen customers. A future training experiment must preserve its own untouched evaluation set. Some forecast windows overlap and all four include the same underlying customers, so observations are correlated.

## What to improve next

The June 15 cutoff has the largest final-day error, **€1,666.14**, versus €797.73 at August 31. This identifies forecasts crossing month boundaries as an area to investigate. Salary-date uncertainty, partial-month conditioning, and repeating the same template month are plausible causes to test; this evaluation does not establish their individual contributions.

Before adding affordable-savings recommendations:

1. Break development errors down into income timing, bill timing, and flexible spending amounts. Evaluate exact low-cash dates as well as window-level warnings.
2. Compare a model for the next income date/amount and recent spending changes with this fixed baseline. Use historical features only; choose the training target from the measured error breakdown.
3. Calibrate uncertainty on a separate past validation period and evaluate coverage on untouched future periods. A six-month min/max envelope alone is insufficient.
4. Keep showing assumptions and source transactions. Treat future irregular costs and external commitments as missing information until evidence or the customer supplies them.

## Reproduce and inspect

```sh
python3 scripts/evaluate_cash_flow.py
```

The full aggregate result is saved locally at `data/local/forecast-evaluation.json`; per-customer/window metrics are in `data/local/forecast-evaluation.cases.jsonl`. A copy of the aggregate [evaluation metrics](cash-flow-evaluation.json) is included with this documentation. Source hashes are recorded in both aggregate files. See [the forecast contract](CASH_FLOW_CONTRACT.md) for assumptions and integration instructions.
