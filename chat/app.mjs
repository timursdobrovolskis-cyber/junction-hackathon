import { createChatSession, demoChatProvider, restoreChatSession, persistChatSession, validateChatSession } from '/src/chat-coach.mjs';

const customerId = 'demo-customer';
let storage;
try { storage = window.localStorage; } catch { /* Private browser storage may be blocked. */ }
let session = restoreChatSession(storage, { customerId });
// Replace this adapter when the server-side conversational API is ready.
const provider = demoChatProvider;
let busy = false;
const el = (id) => document.getElementById(id);
const money = (cents) => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(cents / 100);
function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}
function renderDraft() {
  const draft = el('draft'); draft.replaceChildren();
  const item = (label, value, detail) => {
    const row = node('div', undefined, 'draft-item');
    row.append(node('span', label), node('strong', value));
    if (detail) row.append(node('small', detail));
    draft.append(row);
  };
  const { goal, bufferCents, priorities, expenses } = session.draft;
  if (goal) item('Savings goal', money(goal.amountCents), goal.period === 'monthly' ? 'Each month · Requested target' : 'In total · Requested target');
  if (bufferCents !== null) item('Cash buffer', money(bufferCents), 'Your preference');
  if (priorities.length) item('Things that matter', priorities.map((p) => p.name).join(', '), 'To protect when comparing options');
  for (const expense of expenses) {
    item(expense.label, money(expense.amountCents), `${expense.date} · ${expense.inclusion === 'unsure' ? 'Needs review' : expense.inclusion === 'additional' ? 'Extra cost' : 'Already included'}`);
    const actions = node('div', undefined, 'expense-actions');
    for (const action of ['Edit', 'Remove']) {
      const button = node('button', action, 'quiet'); button.type = 'button'; button.disabled = busy;
      button.setAttribute('aria-label', `${action} ${expense.label} on ${expense.date}`);
      button.addEventListener('click', () => send(`${action} ${expense.id}`)); actions.append(button);
    }
    draft.lastElementChild.append(actions);
  }
  if (!goal && bufferCents === null && !priorities.length && !expenses.length) draft.append(node('p', 'Your goals and priorities will appear here as we talk. Start with whatever is on your mind.', 'draft-empty'));
}
function render() {
  const messages = el('messages');
  // Append only new bubbles so screen readers do not re-announce the transcript.
  if (messages.children.length > session.messages.length) messages.replaceChildren();
  for (const message of session.messages.slice(messages.children.length)) {
    const bubble = node('div', undefined, `message ${message.role}`);
    bubble.append(node('span', message.role === 'user' ? 'You' : 'Coach', 'message-label'), document.createTextNode(message.text));
    if (message.sources?.length) {
      const sources = node('details', undefined, 'sources');
      sources.append(node('summary', 'General guidance · Sources'));
      for (const source of message.sources) {
        const link = node('a', source.title); link.href = source.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; sources.append(link);
      }
      sources.append(node('small', 'UK educational sources; this is not a check of your finances.'));
      bubble.append(sources);
    }
    messages.append(bubble);
  }
  el('suggestions').replaceChildren();
  for (const suggestion of session.messages.at(-1)?.suggestions ?? []) {
    const button = node('button', suggestion, 'chip'); button.type = 'button'; button.disabled = busy;
    button.addEventListener('click', () => send(suggestion)); el('suggestions').append(button);
  }
  el('send').disabled = busy; el('reset').disabled = busy; el('message').readOnly = busy;
  el('messages').setAttribute('aria-busy', String(busy));
  renderDraft(); messages.scrollTo({ top: messages.scrollHeight, behavior: 'instant' });
}
async function send(message) {
  if (busy || !message.trim()) return;
  busy = true; render(); el('status').textContent = 'Coach is replying…';
  try {
    const next = await provider.reply({ session: structuredClone(session), message });
    validateChatSession(next, customerId);
    session = next;
    const saved = persistChatSession(storage, session);
    el('message').value = ''; el('message').style.height = 'auto';
    el('status').textContent = saved ? 'Draft saved in this browser. Affordability hasn’t been checked; no money moved.' : 'Browser storage is unavailable. Keep this tab open to retain your draft.';
  } catch {
    el('message').value = message;
    el('status').textContent = 'Couldn’t get a reply. Your draft is unchanged and your message is ready to retry.';
  } finally { busy = false; render(); el('message').focus(); }
}
el('composer').addEventListener('submit', (event) => { event.preventDefault(); send(el('message').value); });
el('message').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); send(el('message').value); }
});
el('message').addEventListener('input', () => { el('message').style.height = 'auto'; el('message').style.height = `${Math.min(el('message').scrollHeight, 120)}px`; });
el('reset').addEventListener('click', () => el('reset-dialog').showModal());
el('keep-chat').addEventListener('click', () => el('reset-dialog').close());
el('confirm-reset').addEventListener('click', () => {
  session = createChatSession({ customerId });
  const saved = persistChatSession(storage, session);
  el('messages').replaceChildren(); el('message').value = ''; el('reset-dialog').close();
  el('status').textContent = saved ? 'Fresh conversation. No bank connection or money movement.' : 'Fresh conversation for this tab. Browser storage is unavailable.';
  render(); el('message').focus();
});
render();
