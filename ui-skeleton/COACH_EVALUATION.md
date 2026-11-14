# Coach evaluation and improvement

This is application evaluation, routing improvement and prompt guidance, **not
fine-tuning or retraining Gemini**. No customer conversations were collected or
sent as training data. The evaluation examples are original synthetic dialogue.

## Repeatable checks

`test/fixtures/coach-evaluation.json` contains 12 multi-turn scenarios checked by
`test/coach-evaluation.test.mjs`. They exercise the actual conversation adapter,
not only the underlying draft state machine. Known financial questions must use
server calculations: an unexpected model fallback fails the test. Replies are
checked for amounts, periods, scope, currency, short length and unchanged plans.

```sh
npm --prefix ui-skeleton test
COACH_TEST_URL=http://127.0.0.1:4174 python3 ui-skeleton/scripts/check-coach-dialogues.py
COACH_TEST_URL=https://junction-money-ui.vercel.app python3 ui-skeleton/scripts/evaluate-coach-live.py
```

All 127 automated tests pass. The browser script uses seven requests and the live
model review uses five. The app permits twelve requests/minute per instance/IP;
do not repeatedly run both without allowing the rate window to clear. Browser
checks need Python Playwright and Chromium at `/usr/bin/chromium`.

## Findings and changes

| Observed failure | Change |
| --- | --- |
| “grocery spending last year” returned all spending (€20,792.23) | Recognise the category wording; return groceries (€4,825.19) |
| A second “what about” follow-up lost the category and date context | Retain a validated, customer-scoped history query; always recompute totals |
| “Make it €200” or “And €300?” fell through to Gemini | Accept natural contribution corrections within an active illustration |
| “by 1 June 2027” was treated as 30 June | Honour explicit named dates and count only preceding month-end contributions |
| Live emotional-support question was answered with an old October bill | Add supportive-response examples and explicit historical-date guidance |
| Live request to invent spending money produced an unrelated £100 target | Add relevant-response/currency guidance and reject unexpected £/$ in generated account replies |

History continuation metadata stores only validated query inputs, not trusted
financial results. Foreign customer IDs, malformed dates, unknown categories and
invalid limits cannot reuse the query. Ledger arithmetic remains server-side.

## Live model review

The initial live run exercised emotional support, an instruction to fabricate
spending room, the demo date explanation and a savings guarantee question. Date
explanation and guarantee rejection were appropriate; the two weaknesses above
were found in the other replies. The repeatable script prints actual replies for
human review. Generated phrasing is nondeterministic, so these four observations
are not a universal quality score or a guarantee against future mistakes.

Further work: broaden this corpus with real **user-reported prompts**, verify
expected facts against the ledger before adding them, and rerun the model review
when changing models or instructions. The app still uses synthetic account data,
a 30-day affordability forecast, and conditional longer-term contributions; this
work does not create a trained multi-year forecasting model.
