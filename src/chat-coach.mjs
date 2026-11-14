// API-free conversation prototype. Amount parsing is input normalization only;
// forecasts, affordability, budgets and recovery amounts belong to Python.
const clone = (value) => structuredClone(value);
const money = (cents) => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(cents / 100);
const starters = ['I want to save €400', 'I have an expense coming up', 'Help me understand my spending'];
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
function periodFrom(text) {
  if (/\b(weekly|week|yearly|annually|year)\b/i.test(text)) return 'unsupported';
  if (/\b(monthly|per month|a month|each month|every month)\b/i.test(text)) return 'monthly';
  if (/\b(one[- ]?off|one[- ]?time|total|just once)\b/i.test(text)) return 'one_time';
  return null;
}
function say(session, text, suggestions = []) {
  session.messages.push({ id: `m${session.messages.length + 1}`, role: 'assistant', text, suggestions });
  return session;
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
    draft: { goal: null, bufferCents: null, priorities: [], expenses: [], status: 'not_calculated' }, messages: [] },
  'Hey, I’m your financial coach. What would you like to work through — saving for something, an upcoming cost, or where your money goes?', starters);
}

function goalPreview(session, amountCents, period) {
  session.awaiting = { kind: 'goal_confirm', goal: { amountCents, currency: 'EUR', period } };
  return say(session, `${money(amountCents)}${period === 'monthly' ? ' each month' : ' in total'} — got it. I’ll treat that as your goal, then check whether it fits when your financial data is connected. Add it to your draft?`, ['Add goal', 'Cancel']);
}
function startGoal(session, text) {
  const amountCents = amountFrom(text);
  if (amountCents === null) {
    session.awaiting = { kind: 'goal_amount' };
    return say(session, 'How much would you like to save in euros? Give me one amount, such as €400.');
  }
  const period = periodFrom(text);
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
    return say(session, `When do you expect to pay for ${expense.label}? Use a future date like YYYY-MM-DD so I don’t guess the wrong day.`);
  }
  if (!expense.inclusion) {
    session.awaiting = { kind: 'expense_inclusion', expense };
    return say(session, 'Is this an extra cost, or is it already covered by your existing plan? This helps avoid counting it twice.', ['Extra cost', 'Already included', 'Not sure']);
  }
  session.awaiting = { kind: 'expense_confirm', expense };
  return say(session, `${expense.label}: ${money(expense.amountCents)}, expected ${expense.date}. ${expense.inclusion === 'unsure' ? 'We’ll need to check whether it’s already covered.' : expense.inclusion === 'additional' ? 'You’ve marked it as an extra cost.' : 'You’ve marked it as already included.'} Add this to your draft?`, ['Add expense', 'Cancel']);
}
function startExpense(session, text) {
  const label = text.match(/\b(car repair|repair|trip|holiday|medical bill|dentist|rent|insurance|tuition|phone|laptop|wedding)\b/i)?.[1] ?? null;
  return expenseStep(session, { label, amountCents: amountFrom(text), date: text.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null, inclusion: null });
}
function protect(session, text) {
  const names = categories.filter(([, regex]) => regex.test(text)).map(([name]) => name);
  if (!names.length) {
    session.awaiting = { kind: 'protect_name' };
    return say(session, 'Which part of your spending matters most to protect?', ['Groceries', 'Gym', 'Family']);
  }
  for (const name of names) {
    const existing = session.draft.priorities.find((p) => p.name === name);
    if (existing) existing.reason = text;
    else session.draft.priorities.push({ name, reason: text, needsCategoryMapping: true });
  }
  session.awaiting = null;
  return say(session, `I’ve noted ${names.join(' and ')} as ${names.length === 1 ? 'a priority' : 'priorities'} in your draft. We’ll keep that in view when comparing options. What else should I know?`, ['Show my draft', 'I have an expense coming up']);
}

/** One deterministic demo turn. Input state is never mutated. No engine calls or forecasts. */
export function respondToChat(previous, message) {
  validateChatSession(previous);
  if (typeof message !== 'string' || !message.trim() || message.length > 2000) throw new Error('Enter a message of 1–2000 characters');
  const session = clone(previous);
  const text = message.trim();
  session.messages.push({ id: `m${session.messages.length + 1}`, role: 'user', text });
  const pending = session.awaiting;

  if (/^(cancel|never mind|nevermind|stop|no)$/i.test(text)) {
    session.awaiting = null;
    return say(session, 'Okay, I’ve dropped that pending change. Your existing draft is unchanged. What would you like to talk about?', starters);
  }
  if (/\b(show|review|summari[sz]e|what.*remember)\b.*\b(draft|plan|remember)\b|^summary$/i.test(text)) {
    return say(session, `${summary(session.draft)}\n\nThis is a draft of your choices. Affordability hasn’t been calculated and no money has moved.${pending ? '\nYour previous question is still open; you can continue or cancel it.' : ''}`, pending ? ['Cancel'] : starters);
  }
  if (/\b(why|what is|what.s|explain)\b.*\bbuffer\b/i.test(text)) {
    return say(session, 'A cash buffer is money you want to leave available for surprises. It’s separate from your savings goal. The right amount depends on your bills and how predictable your income is; I won’t pick it for you.', ['Set my buffer', 'Show my draft']);
  }
  if (/\b(where.*money|spending|history|transactions)\b/i.test(text) && !/\b(protect|cut|keep|reduce|less|save)\b/i.test(text)) {
    return say(session, 'We can look at regular bills, occasional costs, and everyday spending. I don’t have your transaction history connected in this chat yet, so I can’t say where your money went. Which part feels hardest to keep track of?', ['Regular bills', 'Unexpected costs', 'Everyday spending']);
  }
  if (/^regular bills$/i.test(text)) return say(session, 'Regular bills are costs like rent and subscriptions. Once your history is connected, we can check which payments repeat and estimate when they’ll arrive. Is there a bill you already know is coming?', ['I have an expense coming up', 'Show my draft']);
  if (/^everyday spending$/i.test(text)) return say(session, 'It helps to choose what you actually want to change. What would you prefer to keep spending on, even while saving?', ['Protect my groceries', 'Protect my gym', 'Protect family spending']);
  if (/\b(stress(ed|ful)?|worried|overwhelmed|scared|anxious)\b/i.test(text)) return say(session, 'That sounds stressful. We can take this one decision at a time. What’s worrying you most right now: a payment coming up, or having enough left afterwards?', ['I have an expense coming up', 'Set my buffer']);
  if (/\b(can i afford|afford|on track|how much can|calculate|recalculate)\b/i.test(text)) return say(session,
    `I can help you prepare that check, but I need the calculation engine’s result before saying what fits.${session.draft.goal ? ` Your draft goal is ${money(session.draft.goal.amountCents)}${session.draft.goal.period === 'monthly' ? ' per month' : ' in total'}.` : ''} Are there any upcoming costs we should include?`, ['I have an expense coming up', 'Show my draft']);
  if (/\b(reduce|cut back|save less|options|what if|spent less)\b/i.test(text) && !/\b(don.t|do not|never)\b/i.test(text)) return say(session,
    'We can compare saving less with adjusting spending you’re comfortable changing. I’ll need the engine to calculate the amounts before you choose. Which spending would you want protected?', ['Protect my groceries', 'Protect my gym', 'Show my draft']);

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
  if (/\b(protect|don.t cut|do not cut|keep my|important to me)\b|\b(don.t|do not)\b.{0,20}\b(cut|reduce)\b/i.test(text)) return protect(session, text);
  if (/\b(i (want|would like|need) to save|save €?\d|saving goal|savings goal|change my goal)\b/i.test(text)) return startGoal(session, text);
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
    if (!/^(add goal|yes|confirm)$/i.test(text)) return say(session, 'Add this goal to your draft, or cancel it?', ['Add goal', 'Cancel']);
    session.draft.goal = pending.goal; session.awaiting = null;
    return say(session, `Your ${money(pending.goal.amountCents)} ${pending.goal.period === 'monthly' ? 'monthly' : 'total'} goal is in the draft. What’s one thing you wouldn’t want to give up to reach it?`, ['Protect my groceries', 'Protect my gym', 'Nothing in particular']);
  }
  if (pending?.kind === 'protect_name') return protect(session, text);
  if (pending?.kind === 'buffer_amount') {
    const amountCents = text.trim() === '0' || /^€0(?:\.00)?$/.test(text) ? 0 : amountFrom(text);
    if (amountCents === null) return say(session, 'Give me one non-negative euro amount, such as €500.');
    session.awaiting = { kind: 'buffer_confirm', amountCents };
    return say(session, `Use ${money(amountCents)} as your draft cash buffer?`, ['Use this buffer', 'Cancel']);
  }
  if (pending?.kind === 'buffer_confirm') {
    if (!/^(use this buffer|yes|confirm)$/i.test(text)) return say(session, 'Use this buffer in your draft, or cancel?', ['Use this buffer', 'Cancel']);
    session.draft.bufferCents = pending.amountCents; session.awaiting = null;
    return say(session, `Your draft buffer is ${money(pending.amountCents)}. Any upcoming expenses you’d like us to account for?`, ['I have an expense coming up', 'Show my draft']);
  }
  if (pending?.kind?.startsWith('expense_')) {
    const expense = clone(pending.expense);
    if (pending.kind === 'expense_amount') expense.amountCents = amountFrom(text);
    if (pending.kind === 'expense_label') expense.label = text.slice(0, 120);
    if (pending.kind === 'expense_date') expense.date = text.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
    if (pending.kind === 'expense_inclusion') {
      expense.inclusion = /^extra( cost)?$|^additional$/i.test(text) ? 'additional' : /^already included$/i.test(text) ? 'already_included' : /^not sure$|^unsure$/i.test(text) ? 'unsure' : null;
    }
    if (pending.kind === 'expense_confirm') {
      if (!/^(add expense|yes|confirm)$/i.test(text)) return say(session, 'Add this expense to your draft, or cancel?', ['Add expense', 'Cancel']);
      if (expense.date <= session.today) return expenseStep(session, { ...expense, date: null });
      const duplicate = session.draft.expenses.some((e) => e.date === expense.date && e.amountCents === expense.amountCents && e.label.toLowerCase() === expense.label.toLowerCase());
      session.awaiting = null;
      if (duplicate) return say(session, 'That same expense is already in your draft. I haven’t added it again.', ['Show my draft']);
      session.draft.expenses.push({ ...expense, id: `chat-expense-${session.draft.expenses.length + 1}`, status: 'planned' });
      return say(session, `I’ve added ${expense.label} to your draft. Your forecast hasn’t changed: this still needs an engine check. Is there anything you’d like to protect when we compare your options?`, ['Protect my groceries', 'Show my draft']);
    }
    return expenseStep(session, expense);
  }
  if (/^(hi|hello|hey|thanks|thank you)[!. ]*$/i.test(text)) return say(session, 'I’m here. What would help most right now?', starters);
  if (/^nothing in particular$/i.test(text)) return say(session, 'Okay. Are there any upcoming costs that could affect your goal?', ['I have an expense coming up', 'Set my buffer', 'Show my draft']);
  return say(session, 'I haven’t understood that well enough to change your draft. This demo can help with a savings goal, a cash buffer, upcoming costs, or spending you want to protect. Which would you like to work on?', starters);
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
  const kinds = ['currency', 'goal_amount', 'goal_period', 'goal_confirm', 'protect_name', 'buffer_amount', 'buffer_confirm', 'expense_amount', 'expense_label', 'expense_date', 'expense_inclusion', 'expense_confirm'];
  function checkPending(pending, depth = 0) {
    if (pending === null) return;
    if (!pending || depth > 1 || !kinds.includes(pending.kind)) throw new Error('Invalid pending question');
    if (['goal_period', 'buffer_confirm'].includes(pending.kind) && !cents(pending.amountCents)) throw new Error('Invalid pending amount');
    if (pending.kind === 'goal_confirm' && (!pending.goal || !cents(pending.goal.amountCents) || pending.goal.amountCents === 0 || pending.goal.currency !== 'EUR' || !['one_time', 'monthly'].includes(pending.goal.period))) throw new Error('Invalid pending goal');
    if (pending.kind === 'currency') {
      if (typeof pending.original !== 'string') throw new Error('Invalid pending currency');
      checkPending(pending.resume, depth + 1);
    }
    if (pending.kind.startsWith('expense_')) {
      const expense = pending.expense;
      if (!expense || !(expense.amountCents === null || cents(expense.amountCents)) || !(expense.label === null || typeof expense.label === 'string') || !(expense.date === null || typeof expense.date === 'string') || ![null, 'additional', 'already_included', 'unsure'].includes(expense.inclusion)) throw new Error('Invalid pending expense');
      if (pending.kind === 'expense_confirm' && (!expense.label || !expense.amountCents || !validDate(expense.date) || !expense.inclusion)) throw new Error('Incomplete pending expense');
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
