// API-free conversation prototype. Amount parsing is input normalization only;
// forecasts, affordability, budgets and recovery amounts belong to Python.
import { findCoachingTopic, coachingTopicFollowUp, coachingSources, isTrustedCoachingSource } from './chat-knowledge.mjs';
const clone = (value) => structuredClone(value);
const money = (cents) => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(cents / 100);
const starters = ['I want to save €400', 'I have an expense coming up', 'Help me understand my spending'];
const yes = (text) => /^(yes|yes please|yep|yeah|okay|ok|sure|confirm|sounds good|do it)[.!]?$/i.test(text);
const prioritySignal = (text) => /\b(protect|keep my|important to me)\b|\b(don't|do not|wouldn't|won't)\b.{0,30}\b(cut|reduce|give up)\b/i.test(text);
const categories = [
  ['groceries', /\b(groceries|food shopping)\b/i], ['housing', /\b(rent|housing)\b/i],
  ['transport', /\b(transport|commut(e|ing))\b/i], ['health', /\b(health|medicine|medication)\b/i],
  ['gym', /\b(gym|fitness)\b/i], ['eating out', /\b(restaurants?|eating out)\b/i],
  ['family', /\b(family|childcare)\b/i],
];

function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
function amountFrom(text) {
  const withoutDate = text.replace(/\d{4}-\d{2}-\d{2}/g, '');
  const matches = [...withoutDate.matchAll(/(?:€\s*)?(-?\d+(?:[.,]\d+)?)(?:\s*(?:euros?|eur))?/gi)];
  if (matches.length !== 1) return null;
  const raw = matches[0][1];
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(raw)) return null;
  const [whole, fraction = ''] = raw.replace(',', '.').split('.');
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}
function dateFrom(text, today) {
  const explicit = text.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  if (explicit) return explicit;
  const base = new Date(`${today}T12:00:00Z`);
  let days;
  if (/\bday after tomorrow\b/i.test(text)) days = 2;
  else if (/\btomorrow\b/i.test(text)) days = 1;
  else {
    const day = text.match(/\b(?:next |this |on )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i)?.[1]?.toLowerCase();
    if (day) days = (['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].indexOf(day) - base.getUTCDay() + 7) % 7 || 7;
  }
  if (days === undefined) return null;
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}
function periodFrom(text) {
  if (/\b(weekly|week|yearly|annually|year)\b/i.test(text)) return 'unsupported';
  if (/\b(monthly|per month|a month|each month|every month)\b/i.test(text)) return 'monthly';
  if (/\b(one[- ]?off|one[- ]?time|total|just once)\b/i.test(text)) return 'one_time';
  return null;
}
function say(session, text, suggestions = [], metadata = {}) {
  session.messages.push({ id: `m${session.messages.length + 1}`, role: 'assistant', text, suggestions, ...clone(metadata) });
  return session;
}
function rememberPriorities(session, text) {
  const names = categories.filter(([, regex]) => regex.test(text)).map(([name]) => name);
  for (const name of names) {
    const existing = session.draft.priorities.find((p) => p.name === name);
    if (existing) existing.reason = text;
    else session.draft.priorities.push({ name, reason: text, needsCategoryMapping: true });
  }
  return names;
}
function resumePrompt(session) {
  const pending = session.awaiting;
  if (!pending) return { text: session.draft.goal
    ? `Your ${money(session.draft.goal.amountCents)} ${session.draft.goal.period === 'monthly' ? 'monthly' : 'total'} goal is still in the draft. What would you like to work on next?`
    : 'What would you like to work on next?', suggestions: ['Show my draft', 'I have an expense coming up', 'Set my buffer'] };
  const prompts = {
    goal_amount: ['What amount would you like to save in euros?', []],
    goal_period: [`Is ${money(pending.amountCents ?? 0)} a total goal or a monthly amount?`, ['In total', 'Each month']],
    goal_confirm: ['Add the proposed goal to your draft?', ['Add goal', 'Cancel']],
    buffer_amount: ['What cash buffer would you like in euros?', []],
    buffer_confirm: ['Use the proposed buffer in your draft?', ['Use this buffer', 'Cancel']],
    protect_name: ['Which spending would you like to protect?', ['Groceries', 'Gym', 'Family']],
    expense_amount: ['How much will the expense cost in euros?', []],
    expense_label: ['What is the expense for?', []],
    expense_date: ['When do you expect to pay? You can say tomorrow, a weekday, or YYYY-MM-DD.', []],
    expense_inclusion: ['Is this cost extra, already included, or are you unsure?', ['Extra cost', 'Already included', 'Not sure']],
    expense_confirm: ['Add or update the proposed expense in your draft?', [pending.expense?.id ? 'Update expense' : 'Add expense', 'Cancel']],
    expense_remove: ['Remove this expense from your draft?', ['Remove expense', 'Cancel']],
    currency: ['Did you mean the amount in euros?', ['Yes, euros', 'Cancel']],
  };
  const [text, suggestions] = prompts[pending.kind];
  return { text, suggestions };
}
function knowledgeReply(session, topic) {
  // An educational detour never overwrites a financial confirmation in progress.
  session.context.topic = topic.id ?? null;
  session.context.action = !session.awaiting && /^(would you like|shall we)/i.test(topic.question) ? topic.suggestions[0] : null;
  const question = session.awaiting ? resumePrompt(session) : { text: topic.question, suggestions: topic.suggestions };
  return say(session, `${topic.answer ?? topic.text}\n\n${question.text}`, question.suggestions,
    { kind: 'education', sources: [coachingSources[topic.source]] });
}
function correction(session, text) {
  if (!/^(no[, ]|actually\b|i meant\b|make (it|that)\b|change (it|that)\b)/i.test(text)) return null;
  const amountCents = amountFrom(text);
  const pending = session.awaiting;
  if (/\d/.test(text) && amountCents === null && !dateFrom(text, session.today)) {
    const prompt = resumePrompt(session);
    return say(session, `I couldn’t identify one valid euro amount in that correction. Nothing has changed.\n\n${prompt.text}`, prompt.suggestions);
  }
  if (pending?.kind.startsWith('goal_') || ((!pending || pending.kind === 'protect_name') && session.context.lastEditable === 'goal')) {
    const amount = amountCents ?? pending?.goal?.amountCents ?? pending?.amountCents ?? session.draft.goal?.amountCents;
    const period = periodFrom(text) ?? pending?.goal?.period ?? session.draft.goal?.period;
    if (!amount) return startGoal(session, text);
    if (!period || period === 'unsupported') {
      session.awaiting = { kind: 'goal_period', amountCents: amount };
      return say(session, `Okay, ${money(amount)}. Is that in total or each month?`, ['In total', 'Each month']);
    }
    return goalPreview(session, amount, period);
  }
  if ((pending?.kind.startsWith('buffer_') || (!pending && session.context.lastEditable === 'buffer')) && amountCents !== null) {
    session.awaiting = { kind: 'buffer_confirm', amountCents };
    return say(session, `Use ${money(amountCents)} instead as your draft buffer?`, ['Use this buffer', 'Cancel']);
  }
  if (pending?.kind.startsWith('expense_') && pending.expense) {
    const expense = clone(pending.expense);
    if (amountCents !== null) expense.amountCents = amountCents;
    const date = dateFrom(text, session.today);
    if (date) expense.date = date;
    if (amountCents !== null || date) return expenseStep(session, expense);
  }
  return null;
}
function manageExpense(session, text) {
  const removing = /^(remove|delete|forget)\b/i.test(text);
  const editing = /^(change|update|edit)\b/i.test(text);
  if (!removing && !editing) return null;
  if (/\b(goal|buffer|priorit(y|ies))\b/i.test(text)) return null;
  const idMatches = session.draft.expenses.filter((expense) => text.toLowerCase().split(/\s+/).includes(expense.id.toLowerCase()));
  const matches = idMatches.length ? idMatches : session.draft.expenses.filter((expense) => text.toLowerCase().includes(expense.label.toLowerCase()));
  if (matches.length !== 1) {
    if (!session.draft.expenses.length) return say(session, 'There are no expenses in your draft to change yet.', ['I have an expense coming up']);
    return say(session, 'Which expense do you mean? Use its ID so I change the right one.\n' + session.draft.expenses.map((e) => `${e.id}: ${e.label}, ${money(e.amountCents)}, ${e.date}`).join('\n'),
      session.draft.expenses.slice(0, 3).map((e) => `${removing ? 'Remove' : 'Edit'} ${e.id}`));
  }
  const expense = clone(matches[0]);
  if (removing) {
    session.awaiting = { kind: 'expense_remove', expenseId: expense.id };
    return say(session, `Remove ${expense.label} (${money(expense.amountCents)}, ${expense.date}) from your draft?`, ['Remove expense', 'Cancel']);
  }
  const withoutId = text.replace(expense.id, '');
  const amount = amountFrom(withoutId); const date = dateFrom(withoutId, session.today);
  if (amount !== null) expense.amountCents = amount;
  if (date) expense.date = date;
  if (amount === null && !date) {
    session.awaiting = { kind: 'expense_amount', expense };
    return say(session, `What should ${expense.label} cost instead, in euros?`);
  }
  return expenseStep(session, expense);
}
function summary(draft) {
  const rows = [];
  if (draft.goal) rows.push(`Savings goal: ${money(draft.goal.amountCents)}${draft.goal.period === 'monthly' ? ' per month' : ' in total'}.`);
  if (draft.bufferCents !== null) rows.push(`Cash buffer: ${money(draft.bufferCents)}.`);
  if (draft.priorities.length) rows.push(`Protect: ${draft.priorities.map((p) => p.name).join(', ')}.`);
  for (const expense of draft.expenses) rows.push(`${expense.label}: ${money(expense.amountCents)} on ${expense.date} (${expense.inclusion.replace('_', ' ')}).`);
  return rows.length ? rows.join('\n') : 'We haven’t added anything to your draft yet.';
}

export function createChatSession({ customerId, today = new Date().toISOString().slice(0, 10) }) {
  if (typeof customerId !== 'string' || !customerId.trim() || !validDate(today)) throw new Error('A customer and valid date are required');
  return say({ version: 1, mode: 'demo', customerId, today, awaiting: null,
    context: { topic: null, repairCount: 0, lastEditable: null },
    draft: { goal: null, bufferCents: null, priorities: [], expenses: [], status: 'not_calculated' }, messages: [] },
  'Hey, I’m your financial coach. What would you like to work through — saving for something, an upcoming cost, or where your money goes?', starters);
}

function goalPreview(session, amountCents, period) {
  session.awaiting = { kind: 'goal_confirm', goal: { amountCents, currency: 'EUR', period } };
  const priorities = session.draft.priorities.length ? ` You also want to protect ${session.draft.priorities.map((p) => p.name).join(' and ')}.` : '';
  return say(session, `${money(amountCents)}${period === 'monthly' ? ' each month' : ' in total'} is your requested target.${priorities} We still need your financial data to check whether it fits. Add it to your draft?`, ['Add goal', 'Cancel']);
}
function startGoal(session, text) {
  const amountCents = amountFrom(text);
  if (amountCents === null) {
    session.awaiting = { kind: 'goal_amount' };
    return say(session, 'How much would you like to save in euros? Give me one amount, such as €400.');
  }
  const period = periodFrom(text) ?? (/\b(change|update)\b/i.test(text) ? session.draft.goal?.period : null);
  if (!period || period === 'unsupported') {
    session.awaiting = { kind: 'goal_period', amountCents };
    return say(session, `Is ${money(amountCents)} your total goal, or what you’d like to save each month?`, ['In total', 'Each month']);
  }
  return goalPreview(session, amountCents, period);
}
function expenseStep(session, expense) {
  if (!expense.amountCents) {
    session.awaiting = { kind: 'expense_amount', expense };
    return say(session, 'How much will it cost in euros?');
  }
  if (!expense.label) {
    session.awaiting = { kind: 'expense_label', expense };
    return say(session, `What is the ${money(expense.amountCents)} for?`, ['Car repair', 'Trip', 'Medical bill']);
  }
  if (!expense.date || !validDate(expense.date) || expense.date <= session.today) {
    session.awaiting = { kind: 'expense_date', expense };
    return say(session, `When do you expect to pay for ${expense.label}? You can say tomorrow, a weekday, or YYYY-MM-DD. I’ll show the exact date before you confirm.`);
  }
  if (!expense.inclusion) {
    session.awaiting = { kind: 'expense_inclusion', expense };
    return say(session, 'Is this an extra cost, or is it already covered by your existing plan? This helps avoid counting it twice.', ['Extra cost', 'Already included', 'Not sure']);
  }
  session.awaiting = { kind: 'expense_confirm', expense };
  return say(session, `${expense.label}: ${money(expense.amountCents)}, expected ${expense.date}. ${expense.inclusion === 'unsure' ? 'We’ll need to check whether it’s already covered.' : expense.inclusion === 'additional' ? 'You’ve marked it as an extra cost.' : 'You’ve marked it as already included.'} ${expense.id ? 'Update this expense in' : 'Add this to'} your draft?`, [expense.id ? 'Update expense' : 'Add expense', 'Cancel']);
}
function startExpense(session, text) {
  const label = text.match(/\b(car repair|repair|trip|holiday|medical bill|dentist|rent|insurance|tuition|phone|laptop|wedding)\b/i)?.[1] ?? null;
  return expenseStep(session, { label, amountCents: amountFrom(text), date: dateFrom(text, session.today), inclusion: null });
}
function protect(session, text) {
  const names = rememberPriorities(session, text);
  if (!names.length) {
    session.awaiting = { kind: 'protect_name' };
    return say(session, 'Which part of your spending matters most to protect?', ['Groceries', 'Gym', 'Family']);
  }
  session.awaiting = null;
  return say(session, `I’ve noted ${names.join(' and ')} as ${names.length === 1 ? 'a priority' : 'priorities'} in your draft. We’ll keep that in view when comparing options. What else should I know?`, ['Show my draft', 'I have an expense coming up']);
}

/** One deterministic demo turn. Input state is never mutated. No engine calls or forecasts. */
export function respondToChat(previous, message) {
  validateChatSession(previous);
  if (typeof message !== 'string' || !message.trim() || message.length > 2000) throw new Error('Enter a message of 1–2000 characters');
  const session = clone(previous);
  session.context ??= { topic: null, repairCount: 0, lastEditable: null };
  const offeredAction = session.context.action;
  session.context.action = null;
  const text = message.trim().replace(/[’‘]/g, "'");
  session.messages.push({ id: `m${session.messages.length + 1}`, role: 'user', text: message.trim() });
  const pending = session.awaiting;

  if (/^(cancel|never mind|nevermind|stop|no|not now)$/i.test(text)) {
    session.awaiting = null;
    session.context.topic = null;
    session.context.action = null;
    return say(session, 'Okay, I’ve dropped that pending change. Your existing draft is unchanged. What would you like to talk about?', starters);
  }
  if (/^(continue|back to my plan|back to that|where were we)[?.!]?$/i.test(text)) {
    session.context.topic = null;
    session.context.action = null;
    const prompt = resumePrompt(session);
    return say(session, prompt.text, prompt.suggestions);
  }
  if (/\b(why (are you asking|do you (ask|need))|why this question)\b/i.test(text)) {
    const why = pending?.kind.startsWith('goal_') ? 'A monthly contribution and a total goal need different plans. I’m checking your intention before recording it.'
      : pending?.kind === 'expense_inclusion' ? 'A cost may already be in your existing plan. Checking its inclusion helps prevent counting the same expense twice.'
        : pending?.kind.startsWith('expense_') ? 'An expense’s amount and payment date affect which period needs money available. I’m collecting your estimate, not predicting it.'
          : pending?.kind.startsWith('buffer_') ? 'Your buffer is money you want to leave available. That preference affects which savings plans you would accept.'
            : 'I ask about choices or missing information that could change the plan, rather than choosing priorities for you.';
    const prompt = resumePrompt(session);
    return say(session, `${why}\n\n${prompt.text}`, prompt.suggestions);
  }
  if (/\b(you (don't|do not) understand|not what i meant|that.s wrong|you.re repeating|this is useless)\b/i.test(text)) {
    const prompt = resumePrompt(session);
    return say(session, `I missed what you meant. Your saved draft is unchanged. You can correct an amount with “actually, €300”, or cancel this question.\n\n${prompt.text}`, [...prompt.suggestions, 'Cancel'].slice(0, 4));
  }
  if (/\b(show|review|summari[sz]e|what.*remember)\b.*\b(draft|plan|remember)\b|^summary$/i.test(text)) {
    return say(session, `${summary(session.draft)}\n\nThis is a draft of your choices. Affordability hasn’t been calculated and no money has moved.${pending ? '\nYour previous question is still open; you can continue or cancel it.' : ''}`, pending ? ['Cancel'] : starters);
  }
  if (/\b(why|what is|what.s|explain)\b.*\bbuffer\b/i.test(text)) {
    return say(session, 'A cash buffer is money you want to leave available for surprises. It’s separate from your savings goal. The right amount depends on your bills and how predictable your income is; I won’t pick it for you.', ['Set my buffer', 'Show my draft']);
  }
  if (/^everyday spending$/i.test(text)) {
    session.awaiting ??= { kind: 'protect_name' };
    const prompt = resumePrompt(session);
    return say(session, `Choose spending you would be comfortable changing while keeping what matters to you.\n\n${prompt.text}`, prompt.suggestions);
  }
  if (!pending && yes(text) && offeredAction) {
    const action = offeredAction;
    const replay = clone(session); replay.messages.pop();
    const next = respondToChat(replay, action);
    next.messages[next.messages.length - 2].text = message.trim();
    return next;
  }
  const topicFollowUp = previous.messages.at(-1)?.kind === 'education' ? coachingTopicFollowUp(session.context.topic, text) : null;
  if (topicFollowUp) return knowledgeReply(session, topicFollowUp);
  const topic = findCoachingTopic(text);
  const goalIntent = /\b(i (want|would like|need) to save|i'd like to save|save €?\d|saving goal|savings goal|change my goal|update my goal|put(ting)? aside|set aside)\b/i.test(text)
    && !/\b(don't|do not|can't|cannot)\b.{0,15}\b(save|put|set)\b/i.test(text);
  if (topic && !goalIntent && !prioritySignal(text) && (!pending || pending.kind !== 'expense_label' || /^(what|how|why|should)\b/i.test(text))) return knowledgeReply(session, topic);
  if (/\b(where.*money|spending|history|transactions)\b/i.test(text) && !/\b(protect|cut|keep|reduce|less|save|give up)\b/i.test(text)) {
    return say(session, 'We can look at regular bills, occasional costs, and everyday spending. I don’t have your transaction history connected in this chat yet, so I can’t say where your money went. Which part feels hardest to keep track of?', ['Regular bills', 'Unexpected costs', 'Everyday spending']);
  }
  if (/^regular bills$/i.test(text)) return say(session, 'Regular bills are costs like rent and subscriptions. Once your history is connected, we can check which payments repeat and estimate when they’ll arrive. Is there a bill you already know is coming?', ['I have an expense coming up', 'Show my draft']);
  if (/\b(stress(ed|ful)?|worried|overwhelmed|scared|anxious)\b/i.test(text)) return say(session, 'That sounds stressful. We can take this one decision at a time. What’s worrying you most right now: a payment coming up, or having enough left afterwards?', ['I have an expense coming up', 'Set my buffer']);
  if (/\b(can i afford|afford|on track|how much can|calculate|recalculate)\b/i.test(text)) return say(session,
    `I can help you prepare that check, but I need the calculation engine’s result before saying what fits.${session.draft.goal ? ` Your draft goal is ${money(session.draft.goal.amountCents)}${session.draft.goal.period === 'monthly' ? ' per month' : ' in total'}.` : ''} Are there any upcoming costs we should include?`, ['I have an expense coming up', 'Show my draft']);
  if (/\b(reduce|cut back|save less|options|what if|spent less)\b/i.test(text) && !/\b(don.t|do not|never)\b/i.test(text)) return say(session,
    session.draft.priorities.length ? `Your priorities include ${session.draft.priorities.map((p) => p.name).join(' and ')}. We can compare a lower savings target with changes elsewhere, while keeping those priorities visible. The amounts still need calculating. Would you prefer to review your target or add a known cost?`
      : 'We can compare saving less with adjusting spending you’re comfortable changing. The amounts still need calculating before you choose. Which spending would you want protected?',
    session.draft.priorities.length ? ['Change my goal', 'I have an expense coming up'] : ['Protect my groceries', 'Protect my gym', 'Show my draft']);

  if (/[$£]|\b(usd|dollars?|gbp|pounds?)\b/i.test(text)) {
    session.awaiting = { kind: 'currency', original: text, resume: pending?.kind === 'currency' ? pending.resume : pending };
    return say(session, 'This prototype uses euros. Did you mean that amount in EUR? I won’t convert currencies or assume they have the same value.', ['Yes, euros', 'Cancel']);
  }
  if (pending?.kind === 'currency') {
    if (!/^(yes,?\s*)?(euros?|eur)$/i.test(text)) return say(session, 'Please confirm euros, or cancel and enter a euro amount.', ['Yes, euros', 'Cancel']);
    const original = pending.original.replace(/[$£]/g, '€').replace(/\b(usd|dollars?|gbp|pounds?)\b/gi, 'EUR');
    session.awaiting = pending.resume;
    // Reprocess only the confirmed input, without adding a second user bubble.
    const replay = clone(session);
    replay.messages.pop();
    const next = respondToChat(replay, original);
    next.messages[next.messages.length - 2].text = text;
    return next;
  }
  const corrected = correction(session, text);
  if (corrected) return corrected;
  if (pending?.kind === 'expense_remove' && (/^remove expense$/i.test(text) || yes(text))) {
    session.draft.expenses = session.draft.expenses.filter((e) => e.id !== pending.expenseId);
    session.awaiting = null;
    return say(session, 'Removed from your local draft. Your calculated plan has not changed.', ['Show my draft', 'I have an expense coming up']);
  }
  const managed = pending?.kind === 'expense_confirm' && /^update expense$/i.test(text) ? null : manageExpense(session, text);
  if (managed) return managed;
  if (goalIntent) {
    if (prioritySignal(text)) rememberPriorities(session, text);
    session.context.repairCount = 0;
    return startGoal(session, text);
  }
  if (prioritySignal(text)) return protect(session, text);
  if (/\b(expense|cost coming|repair|unexpected costs|have to pay|need to pay|will cost)\b/i.test(text) && !pending?.kind?.startsWith('expense_')) return startExpense(session, text);
  if (/\b(set|change|keep|leave)\b.*\bbuffer\b/i.test(text)) {
    const amountCents = amountFrom(text);
    session.awaiting = amountCents === null ? { kind: 'buffer_amount' } : { kind: 'buffer_confirm', amountCents };
    return say(session, amountCents === null ? 'How much would you like to keep as an available cash buffer, in euros?' : `Use ${money(amountCents)} as your draft cash buffer? The engine still needs to check the plan.`, amountCents === null ? [] : ['Use this buffer', 'Cancel']);
  }
  if (pending?.kind === 'goal_amount') return startGoal(session, text);
  if (pending?.kind === 'goal_period') {
    const period = periodFrom(text);
    return !period || period === 'unsupported' ? say(session, 'For this prototype, choose a total goal or a monthly amount.', ['In total', 'Each month']) : goalPreview(session, pending.amountCents, period);
  }
  if (pending?.kind === 'goal_confirm') {
    if (!/^add goal$/i.test(text) && !yes(text)) return say(session, 'Add this goal to your draft, or cancel it?', ['Add goal', 'Cancel']);
    session.draft.goal = pending.goal; session.awaiting = null;
    session.context.lastEditable = 'goal';
    if (session.draft.priorities.length) return say(session, `Your goal is in the draft. I’ve also noted what you want to protect: ${session.draft.priorities.map((p) => p.name).join(' and ')}. Any upcoming cost we should account for?`, ['I have an expense coming up', 'Set my buffer', 'Show my draft']);
    session.awaiting = { kind: 'protect_name' };
    return say(session, `Your ${money(pending.goal.amountCents)} ${pending.goal.period === 'monthly' ? 'monthly' : 'total'} goal is in the draft. What’s one thing you wouldn’t want to give up to reach it?`, ['Protect my groceries', 'Protect my gym', 'Nothing in particular']);
  }
  if (pending?.kind === 'protect_name') {
    if (/^(nothing in particular|skip)$/i.test(text)) { session.awaiting = null; return say(session, 'Okay. Any upcoming costs we should account for?', ['I have an expense coming up', 'Set my buffer', 'Show my draft']); }
    return protect(session, text);
  }
  if (pending?.kind === 'buffer_amount') {
    const amountCents = text.trim() === '0' || /^€0(?:\.00)?$/.test(text) ? 0 : amountFrom(text);
    if (amountCents === null) return say(session, 'Give me one non-negative euro amount, such as €500.');
    session.awaiting = { kind: 'buffer_confirm', amountCents };
    return say(session, `Use ${money(amountCents)} as your draft cash buffer?`, ['Use this buffer', 'Cancel']);
  }
  if (pending?.kind === 'buffer_confirm') {
    if (!/^use this buffer$/i.test(text) && !yes(text)) return say(session, 'Use this buffer in your draft, or cancel?', ['Use this buffer', 'Cancel']);
    session.draft.bufferCents = pending.amountCents; session.awaiting = null;
    session.context.lastEditable = 'buffer';
    return say(session, `Your draft buffer is ${money(pending.amountCents)}. Any upcoming expenses you’d like us to account for?`, ['I have an expense coming up', 'Show my draft']);
  }
  if (pending?.kind === 'expense_remove') return say(session, 'Remove the selected expense, or keep it?', ['Remove expense', 'Cancel']);
  if (pending?.kind?.startsWith('expense_')) {
    const expense = clone(pending.expense);
    if (pending.kind === 'expense_amount') expense.amountCents = amountFrom(text);
    if (pending.kind === 'expense_label') expense.label = text.slice(0, 120);
    if (pending.kind === 'expense_date') expense.date = dateFrom(text, session.today);
    if (pending.kind === 'expense_inclusion') {
      expense.inclusion = /^(extra( cost)?|additional|it.s extra|not included)$/i.test(text) ? 'additional' : /^(already included|it.s already included|already covered)$/i.test(text) ? 'already_included' : /^(not sure|unsure|i don.t know)$/i.test(text) ? 'unsure' : null;
    }
    if (pending.kind === 'expense_confirm') {
      if (!/^(add expense|update expense)$/i.test(text) && !yes(text)) return say(session, 'Confirm this expense in your draft, or cancel?', [expense.id ? 'Update expense' : 'Add expense', 'Cancel']);
      if (expense.date <= session.today) return expenseStep(session, { ...expense, date: null });
      const duplicate = session.draft.expenses.some((e) => e.id !== expense.id && e.date === expense.date && e.amountCents === expense.amountCents && e.label.toLowerCase() === expense.label.toLowerCase());
      session.awaiting = null;
      if (duplicate) return say(session, 'That same expense is already in your draft. I haven’t added it again.', ['Show my draft']);
      if (expense.id) session.draft.expenses = session.draft.expenses.map((e) => e.id === expense.id ? expense : e);
      else {
        const sequence = Math.max(session.nextExpenseSequence ?? 1, Math.max(0, ...session.draft.expenses.map((e) => Number(e.id.replace('chat-expense-', '')) || 0)) + 1);
        session.draft.expenses.push({ ...expense, id: `chat-expense-${sequence}`, status: 'planned' });
        session.nextExpenseSequence = sequence + 1;
      }
      if (session.draft.priorities.length) return say(session, `${expense.id ? 'Updated' : 'Added'} ${expense.label} in your draft. Your forecast hasn’t changed. We’ll keep ${session.draft.priorities.map((p) => p.name).join(' and ')} in view when comparing choices. What would you like to review next?`, ['Show my draft', 'What are my options?']);
      session.awaiting = { kind: 'protect_name' };
      return say(session, `I’ve ${expense.id ? 'updated' : 'added'} ${expense.label} in your draft. Your forecast hasn’t changed: affordability still needs checking. Is there anything you’d like to protect when we compare your options?`, ['Protect my groceries', 'Nothing in particular', 'Show my draft']);
    }
    return expenseStep(session, expense);
  }
  if (/^(hi|hello|hey|thanks|thank you)[!. ]*$/i.test(text)) return say(session, 'I’m here. What would help most right now?', starters);
  if (/^nothing in particular$/i.test(text)) return say(session, 'Okay. Are there any upcoming costs that could affect your goal?', ['I have an expense coming up', 'Set my buffer', 'Show my draft']);
  session.context.repairCount += 1;
  return say(session, session.context.repairCount > 1
    ? 'I’m still missing your meaning, so I haven’t changed anything. Try “save €400 each month”, “a €200 repair tomorrow”, or ask about emergency savings. Which is closest?'
    : 'I’m not sure whether you want to change your plan or ask a money question. You can do either. Which would help?',
    session.context.repairCount > 1 ? starters : ['Show my draft', 'How do I start saving?', 'I have an expense coming up']);
}

/** Reject broken/cross-customer browser snapshots instead of displaying mixed state. */
export function validateChatSession(session, customerId = session?.customerId) {
  const cents = (n) => Number.isSafeInteger(n) && n >= 0;
  if (!session || session.version !== 1 || session.mode !== 'demo' || session.customerId !== customerId
    || typeof customerId !== 'string' || !customerId.trim() || !validDate(session.today)
    || session.draft?.status !== 'not_calculated' || !Array.isArray(session.messages) || session.messages.length > 1000
    || !session.messages.every((m) => ['user', 'assistant'].includes(m.role) && typeof m.id === 'string'
      && typeof m.text === 'string' && (!m.suggestions || (Array.isArray(m.suggestions) && m.suggestions.every((s) => typeof s === 'string'))))
    || !(session.draft.bufferCents === null || cents(session.draft.bufferCents))
    || !(session.draft.goal === null || (cents(session.draft.goal.amountCents) && session.draft.goal.amountCents > 0 && session.draft.goal.currency === 'EUR' && ['monthly', 'one_time'].includes(session.draft.goal.period)))
    || !Array.isArray(session.draft.priorities) || !session.draft.priorities.every((p) => typeof p.name === 'string' && typeof p.reason === 'string')
    || !Array.isArray(session.draft.expenses) || !session.draft.expenses.every((e) => typeof e.id === 'string' && typeof e.label === 'string' && cents(e.amountCents) && e.amountCents > 0 && validDate(e.date) && ['additional', 'already_included', 'unsure'].includes(e.inclusion) && e.status === 'planned')) throw new Error('Invalid chat session');
  if (session.messages.some((m) => m.sources !== undefined && (!Array.isArray(m.sources) || !m.sources.every(isTrustedCoachingSource)))) throw new Error('Invalid coaching source');
  if (new Set(session.draft.expenses.map((e) => e.id)).size !== session.draft.expenses.length) throw new Error('Duplicate expense IDs');
  if (session.context !== undefined && (!session.context || !(session.context.topic === null || typeof session.context.topic === 'string') || !Number.isSafeInteger(session.context.repairCount) || session.context.repairCount < 0 || ![null, 'goal', 'buffer'].includes(session.context.lastEditable))) throw new Error('Invalid conversation context');
  if (session.context?.action != null && !['Set my buffer', 'I have an expense coming up'].includes(session.context.action)) throw new Error('Invalid suggested action');
  if (session.nextExpenseSequence !== undefined && (!Number.isSafeInteger(session.nextExpenseSequence) || session.nextExpenseSequence < 1)) throw new Error('Invalid expense sequence');
  const kinds = ['currency', 'goal_amount', 'goal_period', 'goal_confirm', 'protect_name', 'buffer_amount', 'buffer_confirm', 'expense_amount', 'expense_label', 'expense_date', 'expense_inclusion', 'expense_confirm', 'expense_remove'];
  function checkPending(pending, depth = 0) {
    if (pending === null) return;
    if (!pending || depth > 1 || !kinds.includes(pending.kind)) throw new Error('Invalid pending question');
    if (['goal_period', 'buffer_confirm'].includes(pending.kind) && !cents(pending.amountCents)) throw new Error('Invalid pending amount');
    if (pending.kind === 'goal_confirm' && (!pending.goal || !cents(pending.goal.amountCents) || pending.goal.amountCents === 0 || pending.goal.currency !== 'EUR' || !['one_time', 'monthly'].includes(pending.goal.period))) throw new Error('Invalid pending goal');
    if (pending.kind === 'currency') {
      if (typeof pending.original !== 'string') throw new Error('Invalid pending currency');
      checkPending(pending.resume, depth + 1);
    }
    if (pending.kind === 'expense_remove' && !session.draft.expenses.some((e) => e.id === pending.expenseId)) throw new Error('Unknown expense to remove');
    if (pending.kind.startsWith('expense_') && pending.kind !== 'expense_remove') {
      const expense = pending.expense;
      if (!expense || !(expense.amountCents === null || cents(expense.amountCents)) || !(expense.label === null || typeof expense.label === 'string') || !(expense.date === null || typeof expense.date === 'string') || ![null, 'additional', 'already_included', 'unsure'].includes(expense.inclusion)) throw new Error('Invalid pending expense');
      if (pending.kind === 'expense_confirm' && (!expense.label || !expense.amountCents || !validDate(expense.date) || !expense.inclusion)) throw new Error('Incomplete pending expense');
      if (expense.id !== undefined && (!session.draft.expenses.some((e) => e.id === expense.id) || expense.status !== 'planned')) throw new Error('Unknown expense to edit');
    }
  }
  checkPending(session.awaiting);
  return session;
}

export const demoChatProvider = { async reply({ session, message }) { return respondToChat(session, message); } };

/** Keep browser persistence customer-scoped. Storage may be unavailable/private/full. */
export function chatStorageKey(customerId) { return `before:chat:v1:${encodeURIComponent(customerId)}`; }
export function restoreChatSession(storage, options) {
  try {
    const raw = storage?.getItem(chatStorageKey(options.customerId));
    if (raw) {
      const session = validateChatSession(JSON.parse(raw), options.customerId);
      session.today = options.today ?? new Date().toISOString().slice(0, 10);
      return validateChatSession(session, options.customerId);
    }
  } catch { /* Broken storage must not stop the conversation. */ }
  return createChatSession(options);
}
export function persistChatSession(storage, session) {
  validateChatSession(session);
  try { if (!storage) return false; storage.setItem(chatStorageKey(session.customerId), JSON.stringify(session)); return true; } catch { return false; }
}
