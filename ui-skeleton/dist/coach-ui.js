(() => {
  const el = id => document.getElementById(id);
  const profileIds = { design: 'home-sample', engine: 'CUST00005' };
  const sourceText = { design: 'Layout sample', engine: 'History through 30 Sep · plan for October' };
  const money = cents => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(cents / 100);
  let contexts, scenario = 'engine', session, turns = [], busy = false, ready = false, generation = 0, controller;
  const storageKey = () => `s-pankki:coach:v1:${profileIds[scenario]}`;
  function persist() {
    try {
      if (session) localStorage.setItem(storageKey(), JSON.stringify({ ...session, messages: [], awaiting: null, context: { topic: null, repairCount: 0, lastEditable: null } }));
      return true;
    }
    catch { return false; }
  }
  function restore() {
    try {
      const s = JSON.parse(localStorage.getItem(storageKey()));
      if (s?.version === 1 && s.customerId === profileIds[scenario] && s.mode === 'demo'
          && s.draft?.status === 'not_calculated' && Array.isArray(s.draft.expenses) && Array.isArray(s.draft.priorities)) {
        return { ...s, messages: [], awaiting: null, context: { topic: null, repairCount: 0, lastEditable: null } };
      }
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
  function addMessage(role, text, sources = [], presentation) {
    const article = document.createElement('article'); article.className = `message message-${role}`;
    const label = document.createElement('span'); label.className = 'message-label'; label.textContent = role === 'user' ? 'You' : 'Your coach';
    article.append(label);
    const node = (tag, text, cls) => { const n=document.createElement(tag); n.textContent=text; if(cls)n.className=cls; return n; };
    if (role === 'assistant' && presentation && typeof presentation.summary === 'string') {
      if(presentation.title&&!presentation.summary)article.append(node('h3',presentation.title,'reply-title'));
      article.append(node('p',presentation.summary,'reply-summary'));
      if(Array.isArray(presentation.metrics)&&presentation.metrics.length){const grid=node('div','','reply-metrics');for(const m of presentation.metrics.slice(0,3)){const cell=node('div','');cell.append(node('span',m.label),node('strong',m.value));grid.append(cell);}article.append(grid);}
      if(Array.isArray(presentation.bullets)&&presentation.bullets.length){const [first,...rest]=presentation.bullets.slice(0,3);article.append(node('p',first,'reply-point'));if(rest.length){const more=node('details','','reply-more');more.append(node('summary','More'));const list=node('ul','','reply-points');for(const t of rest)list.append(node('li',t));more.append(list);article.append(more);}}
      if(presentation.nextQuestion)article.append(node('p',presentation.nextQuestion,'reply-question'));
      if(Array.isArray(presentation.evidence)&&presentation.evidence.length){const details=node('details','','reply-evidence');details.append(node('summary','View the basis'));for(const e of presentation.evidence.slice(0,12)){const row=node('div','','reply-evidence-row');row.append(node('span',e.label),node('strong',e.value));if(e.id)row.append(node('small',e.id));details.append(row);}article.append(details);}
    } else article.append(node('p',text));

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
    el('chat-log').append(article); return article;
  }
  let latestReply;
  const scroll = el('coach-scroll');
  function revealMessage(article) {
    if (!article || el('coach-page').hidden) return;
    scroll.scrollTop += article.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 12;
    el('coach-new-reply').hidden = true;
  }
  function isVisible(article) {
    const a = article.getBoundingClientRect(), viewport = scroll.getBoundingClientRect();
    return !el('coach-page').hidden && a.bottom > viewport.top && a.top < viewport.bottom;
  }
  el('coach-new-reply').addEventListener('click', () => revealMessage(latestReply));
  scroll.addEventListener('scroll', () => {
    if (latestReply && isVisible(latestReply)) el('coach-new-reply').hidden = true;
  }, { passive: true });
  // Follow the visible viewport when a mobile keyboard changes its height.
  function sizeCoach() {
    document.documentElement.style.setProperty('--coach-viewport', `${window.visualViewport?.height ?? window.innerHeight}px`);
  }
  window.visualViewport?.addEventListener('resize', sizeCoach);
  window.addEventListener('resize', sizeCoach);
  sizeCoach();
  function renderPrompts() {
    const defaults = [];
    const prompts = session?.messages.at(-1)?.suggestions ?? defaults;
    const hasConversation=Boolean(session?.messages.some(m=>m.role==='user'));
    el('coach-starters').hidden = hasConversation;
    el('coach-more-ideas').hidden=!hasConversation;
    el('coach-more-ideas').setAttribute('aria-expanded','false');
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
    generation++; controller?.abort(); latestReply = undefined; el('coach-new-reply').hidden = true; scroll.scrollTop = 0; turns = []; el('chat-log').replaceChildren(); el('chat-input').value = '';
    el('chat-error').hidden = true; el('chat-retry').hidden = true;
    if (session) {
      session.messages = [];
      session.awaiting = null;
      session.context = { topic: null, repairCount: 0, lastEditable: null };
      persist();
    }
    setBusy(false); renderPrompts();
    el('chat-status').textContent = 'Conversation cleared. Your draft is kept.';
  }
  function showScenario(next) {
    generation++; controller?.abort(); scenario = next; session = restore(); turns = [];
    el('chat-log').replaceChildren(); el('chat-input').value = ''; el('chat-error').hidden = true; el('chat-retry').hidden = true;
    const c = contexts?.[scenario]; if (!c) return;
    document.querySelectorAll('[data-scenario]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.scenario === scenario)));
    el('coach-source').textContent = sourceText[scenario]; el('coach-summary-title').textContent = c.title;
    if(c.account){el('coach-account-label').textContent=c.account.label;el('coach-account-balance').textContent=c.account.balance;} el('coach-explanation').textContent = c.explanation;
    el('coach-facts').replaceChildren();
    for (const f of c.facts) { const d = document.createElement('div'); const label = document.createElement('span'); label.textContent = f.label; const value = document.createElement('strong'); value.textContent = f.value; d.append(label, value); el('coach-facts').append(d); }
    el('coach-details').replaceChildren();
    for (const text of [c.source, ...c.details]) { const p = document.createElement('p'); p.textContent = text; el('coach-details').append(p); }
    el('chat-input').placeholder = scenario === 'engine' ? 'Ask about this October plan…' : 'What’s on your mind?';
    for (const message of session?.messages ?? []) addMessage(message.role, message.text, message.sources, message.presentation);
    turns = (session?.messages ?? []).map(m => ({ role: m.role, text: m.text.slice(0, 2400) }));
    setBusy(false); renderDraft(); renderPrompts();
    el('chat-status').textContent = ready ? 'Ready to talk' : 'Chat is not connected yet.';
  }
  async function submit(message) {
    if (busy || !ready || !message.trim()) return;
    el('chat-input').blur();
    el('coach-new-reply').hidden = true;
    const requestGeneration = generation; const user = addMessage('user', message);
    const pending = addMessage('assistant', 'Thinking through your question…'); pending.classList.add('message-pending'); const dots=document.createElement('span'); dots.className='typing-dots'; dots.setAttribute('aria-hidden','true'); dots.append(document.createElement('i'),document.createElement('i'),document.createElement('i')); pending.append(dots);
    el('chat-error').hidden = true; el('chat-retry').hidden = true; el('chat-status').textContent = 'Your coach is replying…'; setBusy(true);
    revealMessage(pending);
    let replyToReveal;
    const requestController = new AbortController(); controller = requestController;
    const timeout = setTimeout(() => requestController.abort(), 30000);
    try {
      const response = await fetch('/api/coach', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario, message, history: turns.slice(-8), ...(session ? { session } : {}) }), signal: requestController.signal });
      const data = await response.json(); if (requestGeneration !== generation) return;
      if (!response.ok || typeof data.reply !== 'string') throw new Error(data.error || 'The coach couldn’t reply. Try again.');
      if (!data.session || data.session.customerId !== profileIds[scenario]) throw new Error('The reply did not match this profile. Please try again.');
      const followReply = isVisible(pending);
      pending.remove(); latestReply = addMessage('assistant', data.reply, data.sources, data.presentation);
      if (followReply) replyToReveal = latestReply;
      else el('coach-new-reply').hidden = false;
      session = data.session; turns = session.messages.map(m => ({ role: m.role, text: m.text.slice(0, 2400) }));
      const stored = persist(); el('chat-input').value = ''; renderDraft();
      el('chat-status').textContent = stored ? (data.source === 'planning' ? 'Draft kept on this device · forecast unchanged' : 'Your coach has replied') : 'Keep this tab open—device storage is unavailable.';
    } catch (error) {
      if (requestGeneration !== generation) return;
      pending.remove(); user.remove(); el('chat-input').value = message;
      el('chat-error').textContent = error.name === 'AbortError' ? 'The reply took too long. Please try again.' : error.message;
      el('chat-error').hidden = false; el('chat-retry').hidden = false; el('chat-status').textContent = 'Your draft is unchanged';
    } finally { clearTimeout(timeout); if (requestGeneration === generation) { setBusy(false); renderPrompts(); if (replyToReveal) revealMessage(replyToReveal); } }
  }
  el('chat-form').addEventListener('submit', event => { event.preventDefault(); submit(el('chat-input').value.trim()); });
  el('chat-input').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); el('chat-form').requestSubmit(); } });
  el('chat-retry').addEventListener('click', () => submit(el('chat-input').value.trim()));
  el('clear-chat').addEventListener('click', clearMessages);
  el('coach-more-ideas').addEventListener('click',()=>{el('coach-starters').hidden=!el('coach-starters').hidden;el('coach-more-ideas').setAttribute('aria-expanded',String(!el('coach-starters').hidden));if(!el('coach-starters').hidden)el('coach-starters').scrollIntoView({block:'center',behavior:'smooth'});});
  el('clear-draft').addEventListener('click', () => el('draft-reset-dialog').showModal());
  el('confirm-draft-reset').addEventListener('click', () => {
    try { localStorage.removeItem(storageKey()); } catch { /* In-memory reset still works. */ }
    session = undefined; clearMessages(); renderDraft(); el('draft-reset-dialog').close(); el('chat-status').textContent = 'Draft and conversation cleared.';
  });
  document.querySelectorAll('[data-scenario]').forEach(button => button.addEventListener('click', () => showScenario(button.dataset.scenario)));
  function connectHome(account) {
    const billCents=account.payments.filter(p=>p.direction==='outflow'&&['Housing','Utilities'].includes(p.category)).reduce((sum,p)=>sum+p.expectedTotalCents,0);
    const values=document.querySelectorAll('.set-aside strong');values[0].textContent=money(billCents);values[1].textContent=money(account.savingsTargetCents);
    const rows=el('account-plan-rows');rows.replaceChildren();
    for(const [label,value] of [['Category spending plan',money(account.spendingPlanCents)],['Savings target',money(account.savingsTargetCents)],['Cash buffer',money(account.bufferCents)],['Forecast period','1–30 October']]){const row=document.createElement('div');const dt=document.createElement('dt');dt.textContent=label;const dd=document.createElement('dd');dd.textContent=value;row.append(dt,dd);rows.append(row);}
  }
  const starters=[
    ['Can I afford it?','Check a purchase against your month','I want to buy a phone for €300','i-check','featured'],
    ['Save more','What your plan allows','I want to save more','i-goal'],
    ['Upcoming bills','What’s due next','Show upcoming bills','i-calendar'],
    ['Spending plan','Your category limits','Show my spending plan','i-home'],
    ['Plan a cost','Add an upcoming expense','I have an expense coming up','i-arrow'],
  ];
  const svgNS='http://www.w3.org/2000/svg';
  for(const [title,detail,prompt,icon,variant] of starters){const button=document.createElement('button');button.type='button';button.dataset.prompt=prompt;button.className='coach-starter'+(variant?' coach-starter-'+variant:'');const mark=document.createElement('span');mark.className='starter-icon';mark.setAttribute('aria-hidden','true');const svg=document.createElementNS(svgNS,'svg');svg.setAttribute('class','icon small');const use=document.createElementNS(svgNS,'use');use.setAttribute('href','#'+icon);svg.append(use);mark.append(svg);const strong=document.createElement('strong');strong.textContent=title;const small=document.createElement('span');small.textContent=detail;button.append(mark,strong,small);button.addEventListener('click',()=>{el('chat-input').value=prompt;submit(prompt);});el('coach-starters').append(button);}
  async function load() {
    setBusy(true);
    try { const response = await fetch('/api/coach', { cache: 'no-store' }); if (!response.ok) throw new Error(); const data = await response.json();
      if (!data.contexts?.design || !data.contexts?.engine) throw new Error(); contexts = data.contexts; ready = data.ready || data.planningReady; connectHome(data.account); showScenario(scenario);
    } catch { ready = false; el('coach-source').textContent = 'Your plan couldn’t load.'; el('chat-status').textContent = 'Please reload to reconnect.'; setBusy(false); }
  }
  load();
})();
