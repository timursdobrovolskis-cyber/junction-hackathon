# Conversation upgrade: sources and implementation

Reviewed 2026-11-14. This work uses public financial education and published
conversation-design examples. We did not ingest private chats, copy customer
stories into the app, fine-tune a model, or connect an AI API. Replies in
`src/chat-knowledge.mjs` and the fictional examples in
`fixtures/chat-conversations.json` are original writing.

## What changed

- A message can contain a goal and a protected priority: “Save €400 monthly but
  don’t cut my gym.” The coach retains both and asks for goal confirmation.
- “Actually, €300” corrects the pending amount while retaining its cadence.
  Invalid or ambiguous corrections ask for clarification without replacing it.
- An educational question can interrupt an unfinished goal or expense. The
  coach answers, then returns to the open question without losing draft state.
- “Why are you asking?” explains the reason for the current question.
- Brief educational conversations cover irregular income, emergency funds,
  debt versus saving, getting started, and budgeting. Replies expose source
  links and distinguish general education from a personal financial assessment.
- Existing priorities inform later options instead of repeatedly asking for
  them. Short replies such as “gym”, “both”, and “sounds good” work in their
  supported contexts. Repeated unknown inputs offer concrete examples.
- Tomorrow, the day after tomorrow, and weekdays resolve to a displayed date.
  A named weekday means its next future occurrence, relative to `session.today`.
  The customer confirms that exact date; “next week” still needs clarification.
- Expenses can be edited or removed through chat or the draft panel. Changes
  require confirmation, retain stable IDs, and survive reload. Ambiguous labels
  ask the customer to select the record. Adding an identical expense stays blocked.

## Public sources

| Source | Use in this upgrade |
| --- | --- |
| [CFPB: Guide to Remote Financial Coaching](https://files.consumerfinance.gov/f/documents/cfpb_guide-to-remote-financial-coaching_report_2021-09.pdf) | Customer-led priorities, listening and keeping questions relevant to the goal. Design reference, not claims about our product's effectiveness. |
| [Google: Confirmations](https://developers.google.com/assistant/conversation-design/confirmations) | Published dialogue examples informed contextual corrections and confirmation before draft changes. |
| [Google: Questions](https://developers.google.com/assistant/conversation-design/questions) | One focused question and supported follow-up answers. These design principles are independent of Google's retired Assistant Actions platform. |
| [MoneyHelper: Irregular income](https://www.moneyhelper.org.uk/en/everyday-money/budgeting/how-to-budget-for-an-irregular-income) | General education about varying income and payment timing. |
| [MoneyHelper: Emergency savings](https://www.moneyhelper.org.uk/en/savings/types-of-savings/emergency-savings-how-much-is-enough) | Distinguishing accessible emergency money from a known future cost. |
| [MoneyHelper: Getting into the savings habit](https://www.moneyhelper.org.uk/en/savings/how-to-save/getting-into-the-savings-habit) | Starting with goals and acknowledging borrowing costs when discussing saving. |
| [MoneyHelper: Managing your money](https://www.moneyhelper.org.uk/en/everyday-money/budgeting/beginners-guide-to-managing-your-money) | General budgeting and debt guidance. |

MoneyHelper is a UK source. The app uses general concepts, labels the source
region, and does not transplant UK benefits, tax rules, debt priorities or
product eligibility into the Finnish banking prototype. Sources are a curated
allowlist; user messages and stored snapshots cannot supply executable links.
The app does not browse the web during conversations or send user text to these
sites. A source link opens only when the user chooses it.

## Evaluation and boundaries

`test/chat-conversations.test.mjs` replays ten original fictional conversations
and checks resulting customer choices, pending confirmations, education sources,
corrections, ambiguous expense edits, reload, old-session compatibility, and
customer-safe source/record validation. These examples are evaluation cases,
not a training dataset. `test/chat-coach.test.mjs` keeps the original contract
and financial-claim checks.

The reply provider remains bounded and rule-based. Unsupported language can
still require rephrasing. Browser drafts are separate from saved engine plans.
No amount in a guidance article becomes a forecast, spending limit or personal
savings recommendation. The existing Python engine remains responsible for
financial arithmetic and actual recalculations when that integration is ready.
