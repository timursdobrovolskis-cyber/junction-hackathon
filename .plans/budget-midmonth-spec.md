# Budget: mid-month view (Home card)

Decisions (interview, 14 Nov):
- Simulate mid-month: demo day 14 Oct, replaying the customer's own 1–14 Aug transactions (most recent month with ≥4 budgeted categories). Clearly labelled as a demo.
- Headline: safe to spend per day = everyday money left ÷ days left, after bills and savings are reserved.
- Three baskets on top: Bills & essentials (non-adjustable plan categories), Set aside (savings target), Everyday spending (adjustable categories).
- Keep the ring chart (planned split by category).
- Overspend: name the category furthest over and suggest covering it from the adjustable category with the most room (preview only, no money moves).
- Goal impact: straight-line pace for everyday categories only; show how much of the savings target would be left.

Code: ui-skeleton/server/budget-live.mjs (maths), server/budget.mjs (adds `live` to plan view), dist/budget-ui.mjs paintHome, dist/budget.css.
Next: one-tap "Cover it" preview on the budget page; feed the same numbers to the Coach.
