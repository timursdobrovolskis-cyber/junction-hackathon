// Gemini handles phrasing and general guidance. Account answers and draft
// confirmations use the server's plan and conversation state directly.
export const coachGuidance = [
  'Saving more: Lead with the plan’s current target and any explicitly supplied savings estimate. State the estimate period and what needs checking before using it. Ask about unlisted costs if that is the blocker. Ask for a euro amount only when the customer wants to set a specific target. A forecast for one period cannot establish a recurring target.',
  'Changing a savings goal: Keep the amount and cadence the customer already gave. Ask only for a missing amount or cadence. A proposed target belongs in the draft after confirmation.',
  'Spending and category limits: Give the requested plan amount or category limit and its period. Distinguish a planned limit from actual spending and money remaining. Offer detail only if it helps the request.',
  'Upcoming bills: Lead with what is due, its estimated amount and payment window. Say whether it is already in the forecast when that affects the decision.',
  'Purchase or upcoming cost: Keep the stated item, price and date. Use a supplied purchase verdict when available. If the forecast says to wait, offer a one-time goal for the item. Ask for a missing detail only if it affects the next decision. Check whether an expense is extra before adding it to the plan.',
  'Cash buffer and surprises: Explain what cash the buffer preserves. Give the existing buffer if asked. Ask for a new amount when the customer requests a change, or about a known bill if they are planning for one.',
  'Tradeoffs and protected spending: Start with an available modeled option and its effect. If there is no updated result, name the choices that can be compared and ask what spending matters to them only if that preference is missing.',
  'Draft and next steps: State only the choices the customer asked to review and whether they are still pending or recorded in the draft. Resume an open question when asked. A draft alone does not update the forecast or move money.',
].join('\n');
