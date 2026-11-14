# Frontend and Gemini coach API handoff

Branch: `codex/frontend-coach-preview`. The teammate's `feat/planning-coach` branch is not merged or overwritten.

## Run

```sh
cd ui-skeleton
cp .env.example .env.local
# Edit .env.local with your own GEMINI_API_KEY, then:
npm run dev
```

Node 22+; no npm dependencies required. Open http://127.0.0.1:4174/preview.html for the interactive phone frame, or `/spendvest.html#coach` for the app directly. `npm test` runs the API checks. No real key is committed.

## Where to work

- `api/coach.js`: Vercel server function. Input limits, Gemini prompt, conversation history, upstream request and safe error messages.
- `server/context.mjs`: trusted example context. Home uses the design example; the transaction example calls the existing structured coach against its saved synthetic engine response.
- `server/coach/`: copies of four explanation modules from your coach branch, plus the existing synthetic engine fixture. `SOURCE.md` records the GitHub blob SHAs. Replace/synchronize these deliberately; do not edit both copies independently.
- `dist/coach-ui.js`: example selection, messages, loading/error/retry, conversation clearing and DOM rendering. All chat replies render as text, not HTML.
- `dist/spendvest.html` and `dist/spendvest.css`: Home/Coach UI. `dist/preview.*` provides the device frame and QR link.

## API contract

Same-origin route: `/api/coach`.

`GET` returns `{ ready, contexts: { design, engine } }`; it never returns the Gemini key. The UI can display both examples without an API key.

`POST` accepts:

```json
{
  "scenario": "engine",
  "message": "Explain this plan in simple words.",
  "history": [
    { "role": "user", "text": "What is the cash buffer?" },
    { "role": "assistant", "text": "It is the amount kept available as a cushion." }
  ]
}
```

Scenario is `design` or `engine`; at most 8 history entries; current message max 1,200 characters; each history entry max 2,400. Success: `{ reply, source: "gemini", scenario, movesMoney: false }`. Failure: `{ error }` with 400/403/405/429/502/503. The browser sends no balances; server-owned context is authoritative. HTTP responses are not cached.

## Next useful integration

1. Replace the saved fixture with a validated result from the existing financial engine for an explicitly selected customer.
2. Use your structured input-capture and saved-plan clients for actual changes. Gemini is currently explanation-only; do not let its text become financial calculations or saved actions.
3. Keep `planScenario`, budget, saved-plan revision and confirmation requirements together when refreshing the UI. Do not silently relabel a 30-day amount as spending until payday.
4. Add real authentication and durable abuse controls before exposing private customer records. The current per-instance request guard is only suitable for a small demo.

## Hosting

Production app: https://junction-money-ui.vercel.app/spendvest.html

Device preview: https://junction-money-ui.vercel.app/preview.html

Vercel project: `agentsquared/junction-money-ui`. `GEMINI_API_KEY` is configured as a Vercel secret after the owner's explicit approval. Local `.env.local` is excluded from Git and deployment uploads. Team members need Vercel project access to deploy; GitHub pushes do not currently deploy automatically. Deploy from this directory with `npx vercel --prod --yes`.

## Brand sources

Official logo: https://www.s-pankki.fi/Assets/img/logos/s-pankki-logo-107x46.svg

Public website token palette: brand `#00AA46`, strong `#007841`, deep `#004628`, pale `#EBF7EC`, light `#F7FCF7`, button accent `#91FA9B`. Original research lives in the working repository's `docs/design/S_PANKKI_STYLE_REFERENCE.md`. The interface remains labelled as a hackathon concept; it is not an official bank service.
