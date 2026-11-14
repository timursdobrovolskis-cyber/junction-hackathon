const $ = (id) => document.getElementById(id);
const dialogs = [...document.querySelectorAll('dialog')];
let returnFocus;

function openDialog(dialog) {
  returnFocus = document.activeElement;
  dialog.showModal();
  document.body.style.overflow = 'hidden';
}

dialogs.forEach((dialog) => {
  dialog.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => dialog.close()));
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
  dialog.addEventListener('close', () => {
    document.body.style.overflow = '';
    returnFocus?.focus();
  });
});

function toggleSection(button, content) {
  const expanded = button.getAttribute('aria-expanded') !== 'true';
  button.setAttribute('aria-expanded', String(expanded));
  content.hidden = !expanded;
}

$('plan-toggle').addEventListener('click', () => toggleSection($('plan-toggle'), $('plan-details')));
$('open-coach-note').addEventListener('click', () => toggleSection($('open-coach-note'), $('coach-note-details')));
$('amount-explanation').addEventListener('click', () => {
  $('plan-details').hidden = false;
  $('plan-toggle').setAttribute('aria-expanded', 'true');
  $('plan-toggle').scrollIntoView({ behavior: 'smooth', block: 'center' });
  $('plan-toggle').focus({ preventScroll: true });
});

function navigate() {
  if (location.hash === '#main') return;
  const current = ['#coach', '#calendar'].includes(location.hash) ? location.hash.slice(1) : 'home';
  const coach = current === 'coach';
  ['home', 'coach', 'calendar'].forEach((name) => {
    const active = name === current;
    $(`${name}-page`).hidden = !active;
    $(`nav-${name}`).classList.toggle('active', active);
    if (active) $(`nav-${name}`).setAttribute('aria-current', 'page');
    else $(`nav-${name}`).removeAttribute('aria-current');
  });
  document.title = document.body.classList.contains('vest-theme') ? (coach ? 'Your coach — S-Pankki concept' : 'S-Pankki — financial coach concept') : (coach ? 'Your coach — Money' : 'Money — a little clearer');
  if (current === 'calendar') document.title = 'Financial calendar — S-Pankki concept';
  window.scrollTo({ top: 0, behavior: 'instant' });
}
window.addEventListener('hashchange', navigate);
document.querySelectorAll('[data-go-coach]').forEach((button) => button.addEventListener('click', () => { location.hash = 'coach'; }));
navigate();

$('open-purchase').addEventListener('click', () => {
  $('purchase-error').hidden = true;
  $('purchase-preview-state').hidden = true;
  $('purchase-amount').removeAttribute('aria-invalid');
  openDialog($('purchase-dialog'));
  // Keep the mobile sheet visible before opening the software keyboard.
  $('purchase-dialog').querySelector('[data-close]').focus();
});

$('purchase-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const raw = $('purchase-amount').value.trim().replace(',', '.');
  const amount = Number(raw);
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw) || amount <= 0 || amount > 999999.99) {
    $('purchase-error').textContent = 'Enter an amount between €0.01 and €999,999.99.';
    $('purchase-error').hidden = false;
    $('purchase-amount').setAttribute('aria-invalid', 'true');
    $('purchase-amount').focus();
    return;
  }
  $('purchase-error').hidden = true;
  $('purchase-amount').removeAttribute('aria-invalid');
  const value = $('purchase-date').value;
  const date = new Date(`${value}T12:00:00`);
  if (!value || !Number.isFinite(date.getTime())) return;
  const label = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(amount);
  const when = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(date);
  $('purchase-preview-title').textContent = `${label} on ${when}`;
  $('purchase-preview-state').hidden = false;
  $('purchase-preview-state').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});

const defaultInfo = {
  title: 'A little space for your money.',
  copy: document.body.classList.contains('vest-theme') ? 'This is a hackathon concept, not an official banking service. Home uses illustrative figures. The Coach offers a separate historical transaction example and Gemini explanations. Chat messages go to Google Gemini; no bank account is connected and no plan changes are saved.' : 'This is an interactive design sketch. All figures and dates are illustrative. It isn’t connected to an account, and no information is saved or sent.',
};
$('about-preview').addEventListener('click', () => {
  $('info-title').textContent = defaultInfo.title;
  $('info-copy').textContent = defaultInfo.copy;
  openDialog($('info-dialog'));
});
document.querySelectorAll('[data-topic]').forEach((button) => button.addEventListener('click', () => {
  $('info-title').textContent = button.dataset.topic;
  $('info-copy').textContent = 'This is where your coach will help you explore the options. For now, you’re trying the layout—no conversation or financial plan is being created.';
  openDialog($('info-dialog'));
}));
