# Three visual refinement passes — 14 November 2026

## Pass 1: hierarchy and readability

Starting capture: `00-before.jpg`. Increased small supporting text, removed a redundant comparison link from Home, softened the decorative watermark, replaced generic coach copy with a concrete explanation, and made Home/Coach navigation persistent. Result: `01-home-refined.jpg`.

## Pass 2: a functioning coach

Added a compact plan summary, explicit Home/transaction example selection, question shortcuts, message composer and asynchronous conversation. Wired the existing financial coach module to its saved synthetic engine response and Gemini through a server-only endpoint. First inspection (`02-coach-first-pass.jpg`) showed the explanatory paragraph made the screen unnecessarily tall.

## Pass 3: reduce density and verify interactions

Moved the long explanation into a native disclosure while retaining the three figures. Increased composer text to 16px, adjusted tap targets and focus states, and bounded scrolling for long conversations. Final captures: `03-coach-mobile.jpg`, `03-live-coach.jpg`.

Verified 390px and 320px layouts with no horizontal overflow, scenario switching, clearing chat, actual Gemini replies for both examples, loading state, purchase validation and Escape dismissal. No browser warnings/errors observed in the final check. Five automated tests cover untrusted input bounds, source figure parity, server-only request context, upstream failures/truncation, invalid origin, missing-key behavior and method validation. Provider-generated financial statements still require human review; no changed financial plan is calculated by this frontend.

Design process reference: Anthropic frontend-design SKILL.md (read from its official GitHub repository); used without a global skill installation. The requested three-pass workflow takes precedence over the guide's default process.

## Device preview and S-Pankki branding

Added an interactive iframe inside a CSS phone frame, device-size and zoom controls, a working copy-link button, and a locally generated QR SVG for the direct production app URL. Verified embedded Home/Coach navigation and device/zoom selection. The official S-Pankki logo and green palette replace the placeholder branding. Screenshot: `04-s-pankki-device-preview.jpg`. The browser instrumentation reported MutationObserver errors; none of the application scripts creates a MutationObserver, and the checked preview interactions worked.

## Customer-facing copy and narrow-screen preview

Replaced repeated illustrative/demo copy with direct plan language, while keeping a persistent Sample data label and a data-information panel. Simplified the coach context and instructions to avoid unsolicited demo reminders. Purchase-impact integration is documented in `IMPLEMENTATION_PLAN.md`; the UI does not yet show calculated purchase impacts. At 320px, preview controls now use two rows and the page has no horizontal overflow at fit zoom. Device/zoom selections survive reloads and are included in copied preview links. Existing five API tests pass.

## Structured conversation integration

Integrated the teammate's conversation mechanism with Gemini. Verified a €400 monthly request corrected to €300 before confirmation, preservation of the gym priority, reload persistence and isolation from the October profile. Forty-seven automated tests cover upstream conversations and adapter behavior, including exact dated expenses, retries, confirmation boundaries and failed Gemini calls. The compact Your draft disclosure keeps choices inspectable without adding dashboard cards. Financial-engine and backend-save integration remains outstanding.

## Team feature integration

Short/long-term goals and Calendar now sit beside Home and Coach in the same iPhone frame. Browser checks verified the €210→€240 recovery preview, zero-return long-term arithmetic, yearly filtering and payment evidence. 56 automated tests pass. Captures: 06-integrated-goals.jpg, 07-long-term-goals.jpg, 08-integrated-calendar.jpg. Browser instrumentation continues to report the previously observed MutationObserver error; the checked app flows work and app source does not construct a MutationObserver.

## Account-backed coach and structured replies

Added four compact suggestion cards, an Ideas toggle, a shared account header and structured response blocks with metrics, bullets and expandable evidence. Home and Coach now share CUST00005’s observed account snapshot; no live bank connection is claimed. Verified Home balance €6,466.14, bills €926.13, savings target €100, account-based payment replies and live structured Gemini output. Compact coach width and scroll width both measured 331px. 61 automated tests pass. Screenshots: 09-coach-suggestion-cards.jpg and 10-structured-account-answer.jpg.

## Coach scrolling repair

Replaced nested transcript scrolling with one full-height reading surface and a separate composer above navigation. Replies reveal their beginning without reopening the keyboard; readers who scroll away get a Read new reply button. Removed repeated scroll-to-bottom layout work. Verified standard/compact phone frames, expanded evidence to the bottom, multi-turn replies, reading position during a live Gemini request, reply shortcut, and Home/Goals/Calendar navigation. All 61 tests pass. Physical iOS keyboard behavior still needs device testing. Screenshot: 11-coach-single-scroll.jpg.
