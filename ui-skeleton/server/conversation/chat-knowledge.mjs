// Original, bounded educational replies informed by the public sources below.
// These are general concepts, never evidence about a customer's own finances.
export const coachingSources = Object.freeze({
  irregular: { title: 'MoneyHelper: budgeting with irregular income', url: 'https://www.moneyhelper.org.uk/en/everyday-money/budgeting/how-to-budget-for-an-irregular-income' },
  emergency: { title: 'MoneyHelper: emergency savings', url: 'https://www.moneyhelper.org.uk/en/savings/types-of-savings/emergency-savings-how-much-is-enough' },
  saving: { title: 'MoneyHelper: getting into the savings habit', url: 'https://www.moneyhelper.org.uk/en/savings/how-to-save/getting-into-the-savings-habit' },
  budgeting: { title: 'MoneyHelper: managing your money', url: 'https://www.moneyhelper.org.uk/en/everyday-money/budgeting/beginners-guide-to-managing-your-money' },
});
Object.values(coachingSources).forEach((source) => Object.freeze(source));

const topics = [
  { id: 'irregular_income', match: /\b(irregular|variable|unpredictable|freelance|self.employed)\b.*\b(income|pay|work)|\b(income|pay|salary|earnings)\b.*\b(varies|changes|different|irregular|unpredictable)|^irregular income$/i,
    answer: 'When income varies, a strong month can make a fixed savings target look easier than it is. A cautious starting point is to plan essentials around a lower-income month, then review extra savings when more income actually arrives.',
    question: 'Is the uncertainty mainly how much you earn, when you get paid, or both?', suggestions: ['The amount varies', 'Payday changes', 'Both'], source: 'irregular' },
  { id: 'debt', match: /\b(debt|credit card|overdraft|loan repayment|borrow(ing)?)\b/i,
    answer: 'Saving and repaying debt can compete for the same money. Start by keeping essential bills and required payments in view. Expensive borrowing can cost more than savings earn, but the right next step depends on the rates, overdue payments, and cash you need available.',
    question: 'Are any essential bills or required payments already overdue?', suggestions: ['A payment is overdue', 'No overdue payments', 'Back to my plan'], source: 'saving' },
  { id: 'emergency', match: /\b(emergency (fund|savings|money)|rainy.day|safety net)\b/i,
    answer: 'Emergency savings are money kept accessible for surprises or an income gap. A predictable annual bill is different: you can plan for it as an upcoming expense. A useful starting target depends on your essential costs and income stability; I haven’t calculated a personal amount for you.',
    question: 'Are you preparing for an unexpected cost, or a bill you already know about?', suggestions: ['An unexpected cost', 'A bill I know about'], source: 'emergency' },
  { id: 'getting_started', match: /\b(how (do|can|should) i (start )?sav(e|ing)|start saving|saving tips|savings habit|can.t save|cannot save|never (manage to )?save)\b/i,
    answer: 'A useful first step is to pick something you want the money to do for you, then check what is left after essentials and known costs. A smaller repeatable step can be easier to maintain than an ambitious target that needs undoing.',
    question: 'What tends to get in the way: unexpected costs, changing income, or everyday spending?', suggestions: ['Unexpected costs', 'Irregular income', 'Everyday spending'], source: 'saving' },
  { id: 'budget', match: /\b(what (is|s) a budget|how (do|can) i budget|budgeting|budget basics|50.?30.?20)\b/i,
    answer: 'A budget is a plan for money coming in and going out. Separate regular essentials, occasional obligations, and spending you can choose to change. Percentage rules are starting ideas, not proof that a plan fits your circumstances.',
    question: 'Which part would you like to work through first?', suggestions: ['Regular bills', 'Unexpected costs', 'Everyday spending'], source: 'budgeting' },
];

export function findCoachingTopic(text) {
  const topic = topics.find((entry) => entry.match.test(text));
  if (!topic) return null;
  return topic;
}

export function coachingTopicFollowUp(topic, text) {
  if (topic === 'irregular_income' && /^(the amount varies|payday changes|both)$/i.test(text)) return {
    text: /^the amount/i.test(text)
      ? 'Then a target that assumes every month is a good one may be hard to keep. We can record your preferred buffer first, and check a savings target against lower-income periods when your history is connected.'
      : /^payday/i.test(text)
        ? 'Then timing matters as well as the total income. Listing bills due before your expected pay helps us see what needs covering first. Payment dates will still be estimates.'
        : 'Then both the amount and timing need room for uncertainty. We can start with costs you know about and the cash you want available, without treating expected income as guaranteed.',
    question: /^payday/i.test(text) ? 'Is there a cost you know is coming before payday?' : 'Would you like to choose a cash buffer first?',
    suggestions: /^payday/i.test(text) ? ['I have an expense coming up', 'Show my draft'] : ['Set my buffer', 'Show my draft'], source: 'irregular',
  };
  if (topic === 'debt' && /^(a payment is overdue|no overdue payments)$/i.test(text)) return {
    text: /^a payment/i.test(text)
      ? 'An overdue payment deserves attention before making a new savings commitment. Contacting the provider early or a qualified local debt adviser can help you understand your options. I can help you list the payment, but cannot negotiate or decide a legal payment order.'
      : 'Then the next comparison is borrowing costs, required payments, and the cash you need for essentials. I won’t recommend a repayment amount without those figures.',
    question: 'Would you like to record an upcoming payment?', suggestions: ['I have an expense coming up', 'Back to my plan'], source: 'budgeting',
  };
  if (topic === 'emergency' && /^(an unexpected cost|a bill i know about)$/i.test(text)) return {
    text: /^a bill/i.test(text) ? 'A known bill belongs in your planned expenses, with its expected date and amount.' : 'For a surprise you cannot date or price yet, an accessible cash buffer is a useful preference to discuss. It does not guarantee every emergency is covered.',
    question: /^a bill/i.test(text) ? 'Shall we add the expected cost?' : 'Would you like to choose your buffer?',
    suggestions: /^a bill/i.test(text) ? ['I have an expense coming up', 'Back to my plan'] : ['Set my buffer', 'Back to my plan'], source: 'emergency',
  };
  return null;
}

export function isTrustedCoachingSource(source) {
  return Boolean(source && Object.values(coachingSources).some((entry) => entry.url === source.url && entry.title === source.title));
}
