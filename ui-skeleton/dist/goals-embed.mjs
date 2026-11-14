const frame = document.getElementById('goals-planner');
const purchase = document.getElementById('purchase-goal');
const money = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' });

function showGoals() {
  if (location.hash !== '#goals') return;
  const source = 'goals-planner/index.html?scenario=beforeExpense';
  if (frame.getAttribute('src') !== source) frame.setAttribute('src', source);
  purchase.hidden = true;
  try {
    const goal = JSON.parse(localStorage.getItem('s-pankki:coach:v1:CUST00005'))?.draft?.goal;
    if (typeof goal?.label === 'string' && Number.isSafeInteger(goal.amountCents) && goal.amountCents > 0) {
      document.getElementById('purchase-goal-name').textContent = `Save for ${goal.label}`;
      document.getElementById('purchase-goal-amount').textContent = money.format(goal.amountCents / 100);
      purchase.hidden = false;
    }
  } catch { /* Storage is optional. */ }
}

window.addEventListener('hashchange', showGoals);
showGoals();
