import { accountAnswer } from './account.mjs';
import { formatPlanning, presentationText, validatePresentation } from './reply-format.mjs';
import { createChatSession, respondToChat, validateChatSession } from './conversation/chat-coach.mjs';

export const profileIds = { design: 'home-sample', engine: 'CUST00005' };
export function conversationDate(scenario) {
  // Keep relative dates attached to the selected plan's period.
  return scenario === 'engine' ? '2026-09-30' : '2026-11-14';
}
export function validateConversation(session, scenario) {
  if (JSON.stringify(session).length > 90000) throw new Error('Session too large');
  validateChatSession(session, profileIds[scenario]);
  if (session.messages.length > 40 || session.messages.some(m => m.text.length > 3000)
      || session.draft.expenses.length > 30 || session.draft.priorities.length > 20) throw new Error('Session too large');
  return session;
}
export function prepareConversation(input) {
  const previous = input.session ? structuredClone(validateConversation(input.session, input.scenario))
    : createChatSession({ customerId: profileIds[input.scenario], today: conversationDate(input.scenario) });
  previous.today = conversationDate(input.scenario);
  const next = respondToChat(previous, input.message);
  const fallback = next.context.repairCount > (previous.context?.repairCount ?? 0);
  const stateChanged = JSON.stringify(previous.draft) !== JSON.stringify(next.draft)
    || JSON.stringify(previous.awaiting) !== JSON.stringify(next.awaiting);
  // Never replace confirmation prompts or an open input flow with model text.
  // Known educational answers retain their curated sources.
  const structured = !fallback && (stateChanged || Boolean(previous.awaiting)
    || next.messages.at(-1).kind === 'education'
    || /\b(draft|remember|cancel|continue|back to|afford|recalculate|calculate|options)\b/i.test(input.message));
  return { previous, next, structured };
}
export async function conversationReply(input, generate) {
  const { previous, next, structured } = prepareConversation(input);
  let source = 'planning';
  const answer = input.scenario === 'engine' ? accountAnswer(input.message) : null;
  if (answer) {
    next.draft = previous.draft; next.awaiting = previous.awaiting; next.context = previous.context;
    next.messages[next.messages.length-1] = {id:next.messages.at(-1).id,role:'assistant',text:presentationText(answer),presentation:answer,suggestions:previous.awaiting?['Continue','Cancel']:answer.suggestions};
    source = 'account';
  } else if (!structured) {
    const generated = await generate({ ...input, draft: previous.draft, pending: previous.awaiting });
    const presentation = typeof generated === 'string' ? {summary:generated,bullets:[],nextQuestion:''} : validatePresentation(generated);
    const reply = presentationText(presentation);
    // LLM output is text only: it has no authority to change the draft or confirm an action.
    next.draft = previous.draft;
    next.awaiting = previous.awaiting;
    next.context = previous.context;
    next.messages[next.messages.length - 1] = {
      id: next.messages.at(-1).id, role: 'assistant', text: reply, presentation,
      suggestions: previous.awaiting ? ['Continue', 'Cancel'] : ['I want to save more', 'I have an expense coming up', 'Show my draft'],
    };
    source = 'gemini';
  }
  // Financial terms stay exact; replace developer-facing phrasing only.
  const message = next.messages.at(-1);
  message.text = message.text
    .replaceAll('the calculation engine’s result', 'an updated forecast')
    .replaceAll('The engine still needs to check the plan.', 'We still need to check how it fits your forecast.')
    .replaceAll('This prototype uses euros.', 'Your plan uses euros.')
    .replaceAll('For this prototype, choose', 'Choose')
    .replaceAll('We still need your financial data to check whether it fits.', 'We’ll need to check it against your forecast before changing your plan.');
  if (!message.presentation) message.presentation = formatPlanning(next);
  next.messages = next.messages.slice(-40);
  next.messages.forEach((m, i) => { m.id = `m${i + 1}`; });
  validateConversation(next, input.scenario);
  return { reply: message.text, source, scenario: input.scenario, session: next,
    presentation: message.presentation, suggestions: message.suggestions ?? [], sources: message.sources ?? [],
    movesMoney: false, planChanged: false, draftOnly: true };
}
