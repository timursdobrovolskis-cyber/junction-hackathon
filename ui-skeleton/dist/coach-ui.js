(() => {
  const el = id => document.getElementById(id);
  const profileIds = { design: 'home-sample', engine: 'CUST00005' };
  const sourceText = { design: 'Until 28 November · expected payday', engine: 'Another profile · 1–30 October' };
  const money = cents => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(cents / 100);
  let contexts, scenario = 'design', session, turns = [], busy = false, ready = false, generation = 0, controller;
  const storageKey = () => `s-pankki:coach:v1:${profileIds[scenario]}`;
  function persist() {
    try { if (session) localStorage.setItem(storageKey(), JSON.stringify(session)); return true; }
    catch { return false; }
  }
  function restore() {
    try {
      const s = JSON.parse(localStorage.getItem(storageKey()));
      if (s?.version === 1 && s.customerId === profileIds[scenario] && s.mode === 'demo'
          && Array.isArray(s.messages) && s.messages.length <= 40
          && s.messages.every(m => ['user', 'assistant'].includes(m.role) && typeof m.text === 'string')
          && s.draft?.status === 'not_calculated' && Array.isArray(s.draft.expenses) && Array.isArray(s.draft.priorities)) return s;
    } catch { /* Start clean when storage is absent or invalid. */ }
    return undefined;
  }
  function setBusy(value) {
    busy = value;
    el('chat-send').disabled = value || !ready;
    el('chat-input').disabled = value || !ready;
    document.querySelectorAll('[data-prompt]').forEach(b => b.disabled = value || !ready);
    el('chat-log').setAttribute('aria-busy', String(value));
    el('clear-chat').disabled = value;
    el('clear-draft').disabled = value;
  }
  function addMessage(role, text, sources = []) {
    const article = document.createElement('article'); article.className = `message message-${role}`;
    const label = document.createElement('span'); label.className = 'message-label'; label.textContent = role === 'user' ? 'You' : 'Your coach';
    const p = document.createElement('p'); p.textContent = text; article.append(label, p);
    if (sources.length) {
      const details = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = 'Guidance sources'; details.append(summary);
      for (const source of sources) {
        // Only display the provider's approved educational domain, including on restore.
        try { const url = new URL(source.url); if (url.protocol !== 'https:' || url.hostname !== 'www.moneyhelper.org.uk') continue;
          const link = document.createElement('a'); link.href = url.href; link.textContent = source.title; link.target = '_blank'; link.rel = 'noopener noreferrer'; details.append(link);
        } catch { /* Invalid persisted links are not rendered. */ }
      }
      article.append(details);
    }
    el('chat-log').append(article); el('chat-log').scrollTop = el('chat-log').scrollHeight; return article;
  }
  function renderPrompts() {
    const defaults = ['Explain my plan', 'I want to save more', 'I have an expense coming up'];
    const prompts = session?.messages.at(-1)?.suggestions ?? defaults;
    el('coach-prompts').replaceChildren();
    for (const text of prompts.slice(0, 4)) {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.prompt = text; button.textContent = text;
      button.disabled = busy || !ready; button.addEventListener('click', () => { el('chat-input').value = text; submit(text); });
      el('coach-prompts').append(button);
    }
  }
  function renderDraft() {
    const draft = session?.draft; const list = el('draft-items'); list.replaceChildren();
    const row = (label, value) => { const div = document.createElement('div'); const dt = document.createElement('dt'); dt.textContent = label; const dd = document.createElement('dd'); dd.textContent = value; div.append(dt, dd); list.append(div); };
    if (draft?.goal) row('Savings goal', `${money(draft.goal.amountCents)} ${draft.goal.period === 'monthly' ? 'each month' : 'in total'}`);
    if (draft?.bufferCents != null) row('Cash buffer', money(draft.bufferCents));
    if (draft?.priorities?.length) row('Keep in mind', draft.priorities.map(p => p.name).join(', '));
    for (const cost of draft?.expenses ?? []) row(cost.label, `${money(cost.amountCents)} · ${cost.date} · ${cost.inclusion === 'additional' ? 'extra cost' : cost.inclusion === 'already_included' ? 'already included' : 'needs review'}`);
    el('coach-draft').hidden = list.children.length === 0;
    el('draft-count').textContent = String(list.children.length);
  }
  function clearMessages() {
    generation++; controller?.abort(); turns = []; el('chat-log').replaceChildren(); el('chat-input').value = '';
    el('chat-error').hidden = true; el('chat-retry').hidden = true;
    if (session) { session.messages = []; persist(); }
    setBusy(false); renderPrompts();
    el('chat-status').textContent = 'Conversation cleared. Your draft is kept.';
  }
  function showScenario(next) {
    generation++; controller?.abort(); scenario = next; session = restore(); turns = [];
    el('chat-log').replaceChildren(); el('chat-input').value = ''; el('chat-error').hidden = true; el('chat-retry').hidden = true;
    const c = contexts?.[scenario]; if (!c) return;
    document.querySelectorAll('[data-scenario]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.scenario === scenario)));
    el('coach-source').textContent = sourceText[scenario]; el('coach-summary-title').textContent = c.title; el('coach-explanation').textContent = c.explanation;
    el('coach-facts').replaceChildren();
    for (const f of c.facts) { const d = document.createElement('div'); const label = document.createElement('span'); label.textContent = f.label; const value = document.createElement('strong'); value.textContent = f.value; d.append(label, value); el('coach-facts').append(d); }
    el('coach-details').replaceChildren();
    for (const text of [c.source, ...c.details]) { const p = document.createElement('p'); p.textContent = text; el('coach-details').append(p); }
    el('chat-input').placeholder = scenario === 'engine' ? 'Ask about this October plan…' : 'What’s on your mind?';
    for (const message of session?.messages ?? []) addMessage(message.role, message.text, message.sources);
    turns = (session?.messages ?? []).map(m => ({ role: m.role, text: m.text.slice(0, 2400) }));
    setBusy(false); renderDraft(); renderPrompts();
    el('chat-status').textContent = session ? 'Conversation restored on this device' : ready ? 'Ready to talk' : 'Chat is not connected yet.';
  }
  async function submit(message) {
    if (busy || !ready || !message.trim()) return;
    const requestGeneration = generation; const user = addMessage('user', message);
    const pending = addMessage('assistant', 'Thinking through your question…'); pending.classList.add('message-pending');
    el('chat-error').hidden = true; el('chat-retry').hidden = true; el('chat-status').textContent = 'Your coach is replying…'; setBusy(true);
    const requestController = new AbortController(); controller = requestController;
    const timeout = setTimeout(() => requestController.abort(), 30000);
    try {
      const response = await fetch('/api/coach', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario, message, history: turns.slice(-8), ...(session ? { session } : {}) }), signal: requestController.signal });
      const data = await response.json(); if (requestGeneration !== generation) return;
      if (!response.ok || typeof data.reply !== 'string') throw new Error(data.error || 'The coach couldn’t reply. Try again.');
      if (!data.session || data.session.customerId !== profileIds[scenario]) throw new Error('The reply did not match this profile. Please try again.');
      pending.remove(); addMessage('assistant', data.reply, data.sources);
      session = data.session; turns = session.messages.map(m => ({ role: m.role, text: m.text.slice(0, 2400) }));
      const stored = persist(); el('chat-input').value = ''; renderDraft();
      el('chat-status').textContent = stored ? (data.source === 'planning' ? 'Draft kept on this device · forecast unchanged' : 'Your coach has replied') : 'Keep this tab open—device storage is unavailable.';
    } catch (error) {
      if (requestGeneration !== generation) return;
      pending.remove(); user.remove(); el('chat-input').value = message;
      el('chat-error').textContent = error.name === 'AbortError' ? 'The reply took too long. Please try again.' : error.message;
      el('chat-error').hidden = false; el('chat-retry').hidden = false; el('chat-status').textContent = 'Your draft is unchanged';
    } finally { clearTimeout(timeout); if (requestGeneration === generation) { setBusy(false); renderPrompts(); el('chat-input').focus({ preventScroll: true }); } }
  }
  el('chat-form').addEventListener('submit', event => { event.preventDefault(); submit(el('chat-input').value.trim()); });
  el('chat-input').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); el('chat-form').requestSubmit(); } });
  el('chat-retry').addEventListener('click', () => submit(el('chat-input').value.trim()));
  el('clear-chat').addEventListener('click', clearMessages);
  el('clear-draft').addEventListener('click', () => el('draft-reset-dialog').showModal());
  el('confirm-draft-reset').addEventListener('click', () => {
    try { localStorage.removeItem(storageKey()); } catch { /* In-memory reset still works. */ }
    session = undefined; clearMessages(); renderDraft(); el('draft-reset-dialog').close(); el('chat-status').textContent = 'Draft and conversation cleared.';
  });
  document.querySelectorAll('[data-scenario]').forEach(button => button.addEventListener('click', () => showScenario(button.dataset.scenario)));
  async function load() {
    setBusy(true);
    try { const response = await fetch('/api/coach'); if (!response.ok) throw new Error(); const data = await response.json();
      if (!data.contexts?.design || !data.contexts?.engine) throw new Error(); contexts = data.contexts; ready = data.ready; showScenario(scenario);
    } catch { ready = false; el('coach-source').textContent = 'Your plan couldn’t load.'; el('chat-status').textContent = 'Please reload to reconnect.'; setBusy(false); }
  }
  load();
})();
