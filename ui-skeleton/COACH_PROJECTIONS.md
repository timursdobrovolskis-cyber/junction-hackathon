# Future savings illustrations in Coach

The cash-flow engine remains a 30-day forecast. Long-term savings questions now
have a separate deterministic, read-only contribution illustration. The model is
not asked to multiply a one-time savings capacity or extend a forecast itself.

`server/savings-projection.mjs` builds monthly contribution dates and reuses the
existing `server/goals/coach.mjs` calculator to sum contributions. The existing
Goals UI/fixture is not used as customer data. A contribution defaults to the
account plan's proposed monthly target (€100), or a confirmed monthly chat-draft
target, and can be replaced by an explicit user assumption. Unconfirmed proposals
and one-time goals do not become monthly contributions.

For CUST00005, the demo date remains 30 September 2026. Month-end contributions
start October 2026: €100 × 15 contributions = €1,500 through 31 December 2027.
This is new money set aside, excluding existing savings, interest and withdrawals.
It is not a verified statement of affordability or a forecast of future income,
bills, inflation or unusual costs. Those limitations are visible in every reply.

Supported deadlines: ISO dates, full English month/year names (month-end), and
calendar years (year-end). A missing date gets a clarification. The next reply
can change the monthly amount (for example, “€200”) or deadline (“What about
2028?”). Calculations are capped at 120 contributions and €10,000/month. Other
currencies/cadences, past/invalid dates and foreign profiles are not silently used.
The date/count assumptions are explicit; future source data is not fabricated.

`conversation.mjs` routes these requests before historical reads and preserves
all draft and pending-confirmation state. `presentation.projection` carries the
read-only calculation and follow-up inputs. Follow-up inputs are validated again
and never authorize saving a plan or moving money. Changing date/amount in this
illustration changes neither the underlying forecast nor the Goals page.

Validation: `npm --prefix ui-skeleton test` (113 tests), including the exact
reported question, repeated contributions/deadlines, leap-year and mid-month
boundaries, missing dates, customer isolation, invalid amounts and preservation
of confirmation flows. Browser check:

```sh
COACH_TEST_URL=http://127.0.0.1:4174 python3 ui-skeleton/scripts/check-coach-projection.py
```

## Remaining forecasting work

A true multi-year affordability forecast is still unimplemented. It would need
an engine model for future income/cost changes, dated commitments, essential
spending and buffers, plus uncertainty calibrated beyond the current 30-day
horizon. This release supplies an honest contribution scenario, not that model.
