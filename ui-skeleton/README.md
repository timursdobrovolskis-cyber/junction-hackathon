# Production app

Canonical source: **main**, directory **ui-skeleton**. Use `npm run dev` here
for the app, `npm test` for checks, and `npm run deploy` from a clean checkout at
origin/main to publish. Never publish an old feature checkout over production.
See [TEAM_INTEGRATION.md](TEAM_INTEGRATION.md) for integration/release details.

---

# S-Pankki financial coach concept

Spendvest-inspired Home and Coach screens with S-Pankki branding. The default Vercel page is an interactive phone preview with device/zoom controls and a QR link. The original visual sketch remains at `/index.html`. Production: https://junction-money-ui.vercel.app.

## Run locally

Node 22+; no dependencies or build required.

```sh
npm run dev
```

Open http://127.0.0.1:4174/preview.html. `.env.local` supplies `GEMINI_API_KEY` to the server only. This file is excluded from Git and Vercel uploads. Never paste secrets into frontend JavaScript. Optional `GEMINI_MODEL` overrides the verified default `gemini-3.5-flash-lite`.

## What works

- Responsive Home, persistent navigation, expandable plan, purchase dialog with input validation.
- Coach with suggested questions, multi-turn Gemini replies, loading/error/retry states, clear chat, and separate conversations for each selected example.
- Home example matches the illustrative November figures shown on Home.
- Transaction example uses the existing financial coach module and its synthetic CUST00005 fixture: historical data through 30 September 2026, plan for 1–30 October. It is explicitly separate from Home.
- GET `/api/coach` serves the examples and connection state. POST `/api/coach` calls Gemini server-side using a bounded conversation and server-owned financial context. It does not accept client-supplied balances.

## Limits

Home still uses design-example figures. No live bank connection, recalculation, plan persistence, payment matching, or account authentication is wired into this frontend. The purchase dialog does not produce an affordability verdict. Chat can explain a plan and trade-offs, but cannot update it or move money. Messages are sent to Google; this demo asks visitors to use demo information only. Conversation state lives in browser memory and clears on scenario switch/reload.

The existing coach's explanation code is vendored under `server/coach`; this is not a merge of the teammate's backend branch. See `server/coach/SOURCE.md`. Hook up their saved-plan API in a separate integration step. The per-instance chat request guard is only a demo convenience, not durable production rate limiting.

## Deploy

```sh
npm run deploy
```

Static assets come from `dist`; Vercel also runs `api/coach.js` with its included `server` files. The Gemini secret is configured in the Vercel project after explicit owner approval; a local `.env.local` is never published. Without a hosted key, examples remain available and chat is explicitly disabled.

## Validation

```sh
npm test
```

Three screenshot-driven UI passes and live Gemini checks are recorded in `review/REVIEW.md`. Review files, local development scripts and tests are excluded from deployment. Inter is locally hosted with its SIL license in `dist/assets/INTER-OFL.txt`.

For your teammate: start with [COACH_HANDOFF.md](COACH_HANDOFF.md).
