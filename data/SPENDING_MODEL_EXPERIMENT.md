# Spending model experiment: v2 remains the default

One v3 candidate was implemented and evaluated. It smooths flexible purchases into daily expectations, learns a category-specific blend of recent 28-day and longer 84-day spending, separates large-purchase excess into a 180-day allowance, and scales uncertainty using customer history. Detected recurring purchases keep their calendar behavior. Large purchases are retained as an allowance rather than erased.

Training tried exactly three recency weights per category: 0%, 50%, and 100%. All categories selected 0%: this dataset favored the 84-day rate. Labels ended by April 30, 2026. The candidate improved daily balance error by 1.69% on 8,210 development windows. Calibration then used 4,105 separate later customer paths, followed by evaluation on 995 customers excluded from fitting, selection, and calibration.

| Reserved-customer metric | Supported v2 | Experimental v3 |
| --- | ---: | ---: |
| Daily mean absolute balance error | €802.70 | €815.00 |
| Final-day mean absolute balance error | €840.97 | €881.25 |
| Lowest-balance mean absolute error | €523.32 | €542.47 |
| Entire actual path inside calibrated range | 91.36% | 90.45% |
| Mean calibrated range width | €6,630.23 | €7,467.03 |
| Positive savings previews | 529 | 533 |
| Actual buffer breaches after those previews | 3 | 7 |

Savings comparisons use an illustrative €500 buffer and no additional future commitments. Errors and range widths worsened, and more savings previews breached the buffer. **Do not replace v2 with this candidate.** The implementation is preserved for reproducibility; no further tuning loop was run. These synthetic benchmark customers had already been evaluated in earlier project iterations, so this is not a fresh, independently untouched test set.

See the [full report](spending-v3-evaluation.json), [candidate model](models/spending-v3-candidate.json), and [matching calibration](models/spending-v3-candidate-calibration.json). The calibration hash was canonicalized after JSON serialization; fitted parameters and measured results did not change.

To reproduce the bounded experiment, run `python3 scripts/train_spending_model.py`. Outputs go under ignored `data/local/spending-experiment/`; the script never overwrites the default artifacts. To inspect a candidate response explicitly:

```sh
python3 scripts/run_financial_engine.py --request fixtures/financial-plan-request.json --model data/models/spending-v3-candidate.json --calibration data/models/spending-v3-candidate-calibration.json --output data/local/candidate-plan.json
```

The useful integration deliverable is the [combined engine and local API](FINANCIAL_ENGINE.md), which uses the better-supported v2 by default. Better handling of future irregular costs and tighter, reliable uncertainty remain unresolved modeling work.
