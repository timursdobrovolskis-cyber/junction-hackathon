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
