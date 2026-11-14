# Conversational coach prototype

Run `npm run dev:chat`, then open http://localhost:3000 on the same machine.
Set `CHAT_PORT=3001 npm run dev:chat` if port 3000 is occupied. Node 22+ is sufficient;
no package installation, API key, financial server, or bank database is needed.
The server binds to localhost and serves only the chat assets, not repository files.

This is a standalone, mobile-friendly conversation prototype for the frontend
teammate to integrate. It is **not yet LLM-powered**. The visible demo label and
bounded fallback replies make that limitation explicit. The existing engine,
saved-plan API, and `src/coach.mjs` are unchanged.

## Try the conversation

1. Type `I want to save €400`.
2. Answer `Each month`, then `Add goal`.
3. Type `Don't cut my groceries`.
4. Type `I have a €200 car repair` and supply a future date as `YYYY-MM-DD`.
5. Choose `Extra cost`, then `Add expense`.
6. Ask `Show my draft`, reload, and check that the conversation and draft remain.

For the upgraded flow, try `I want to save €400 monthly but don’t cut my gym`,
then `actually, €300`, then `sounds good`. Ask `What is an emergency fund?` or
`My income changes every month`. You can interrupt a pending goal to ask a
question and then continue without restarting. See the
[research and conversation examples](conversation-research.md) for sources and
the boundaries of this rule-based upgrade.

You can also set a buffer, ask what a buffer means, explore spending categories,
cancel a pending change, or replace a goal. Only explicit confirmation adds goals,
buffers, and expenses to the draft. Stated priorities are remembered immediately.
An identical label/amount/date expense is not appended twice. Unknown messages
do not mutate the draft. Tomorrow and weekdays resolve to an exact displayed
date for confirmation; a weekday means its next future occurrence relative to
the conversation date. Ambiguous dates such as “next week” still need clarification.
Euro amounts accept a decimal point or comma with up
to two digits; thousands separators and multiple amounts require clarification.
Dollar/pound inputs ask for explicit euro confirmation; no conversion occurs.

Chat and draft live in localStorage under a customer-specific key. Reset requires
confirmation and affects that chat only. Invalid or cross-customer snapshots are
discarded. If storage is unavailable, the UI explains that state lasts only for
the open tab. This is browser-local demo persistence, separate from the existing
engine-backed durable plan store. The demo page uses `demo-customer`; it is not an
authenticated customer session or the shared bank-data fixture.

## Frontend handoff and future API connection

- `src/chat-coach.mjs`: pure `createChatSession`, `respondToChat`, validation,
  customer-scoped storage helpers, and an async `demoChatProvider.reply` adapter.
- `src/chat-knowledge.mjs`: original, curated educational answers and approved
  source links. This is used by the demo adapter without external API calls.
- `fixtures/chat-conversations.json`: original fictional evaluation dialogues.
- `chat/app.mjs`: transcript, quick replies, editable message box, draft panel,
  pending/error handling, persistence, reset, and safe text rendering.
- `chat/index.html` and `chat/style.css`: responsive demo shell, keyboard support,
  labelled controls and live announcements. No external assets or dependencies.

The asynchronous adapter currently accepts `{ session, message }` and returns the
next renderable demo session. The UI keeps its previous state and leaves the
message available to retry on failure. Replace the adapter with a server call
when the conversational API is available; extend the explicitly versioned demo
schema for live mode rather than removing its validation. Keep model API keys
server-side. Supply only the current customer's relevant history and engine
results, and validate model-proposed input changes before previewing them.

The draft is **not an engine request**. It intentionally has no affordability
result. Integration must map customer priorities to real engine category IDs
and ask for any needed minimum amounts. A total goal needs a timeframe before
mapping to a monthly engine target. The live flow must preview input changes
with the existing financial client, show the returned calculated result, obtain
the customer's choice, and then use the saved-plan API. A chat confirmation here
only confirms a local draft; it does not claim a recalculation, save to the bank
backend, select a recovery option, or move money.

## Verification and limits

`node --test test/chat-coach.test.mjs` exercises multi-turn goal/expense flows,
currency clarification, pending confirmations, interruptions, cancellation,
duplicate expenses, customer isolation, restoration and unavailable storage.
`npm test` includes the existing coach and financial integration unit tests.

The current demo does not answer arbitrary questions, retrieve actual spending,
calculate forecasts, or interpret every phrasing/date. Use Edit/Remove in the
draft panel, or say `Change repair to €250` / `Remove repair`; ambiguous records
ask you to select an ID. These operations change only the local draft. Use
Start over to clear the demo draft. Do not describe this bounded
conversation prototype as the finished AI coach. LLM interpretation and engine
integration are the next connection steps when those APIs are ready.
