import { activity, monthPeriod, validateLedger, isBudgetSpending } from './budget.mjs';
import { accountPlan } from './account.mjs';

const money = cents => new Intl.NumberFormat('en-IE', {style:'currency', currency:'EUR'}).format(cents / 100);
const monthNames = ['january','february','march','april','may','june','july','august','september','october','november','december'];
const monthLabel = month => new Date(month+'-01T12:00:00Z').toLocaleDateString('en-GB', {month:'long',year:'numeric',timeZone:'UTC'});
const normalize = text => text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const validDate = date => /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date)) && new Date(date+'T12:00:00Z').toISOString().slice(0,10)===date;
const historicalIntent = text => {
  // Read requests about observed spending must not fall through to a forecast answer.
  if (/\b(plan|budget|limits|target|savings|upcoming|forecast|scheduled|proposed|can i afford|should i|could i afford|will i|next month|next year)\b/i.test(text)) return false;
  return /\b(?:how much (?:money )?(?:did|have) i (?:spend|spent|pay|paid)|what (?:did|have) i (?:spend|spent|pay|paid)|(?:show|list|what|which|summari[sz]e|tell me).*(?:biggest|largest|transactions|payments|spending|spent|expenses)|(?:historical|recorded|actual|annual|yearly|total) spending|spending (?:on|at|in|for|last)|how much.*(?:spent|spending))\b/i.test(text);
};
const presentation = (summary, nextQuestion='', evidence=[], bullets=[]) => ({title:'',summary,bullets,nextQuestion,evidence});

// Parse a bounded read query. No user-supplied financial amounts or customer IDs are used.
export function parseHistoryQuestion(message, today, ledger=activity) {
  if (!historicalIntent(message)) return null;
  const text=message.trim().replace(/[?.!]+$/,'');
  let period, label, relative=false;
  const dates=text.match(/\b\d{4}-\d{2}-\d{2}\b/g)??[];
  const named=[...text.matchAll(/\b(january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+(\d{4}))?\b/gi)];
  if (/\b(compare|versus|vs|difference|average)\b/i.test(text)) return {clarify:'Which single month, year or date range should I total first?'};
  if(dates.length) {
    if(dates.length>2 || dates.some(d=>!validDate(d)))return {clarify:'Which valid date range should I use (YYYY-MM-DD to YYYY-MM-DD)?'};
    period={start:dates[0],end:dates.at(-1)};label=dates.length===1?dates[0]:`${period.start} to ${period.end}`;
    if(period.start>period.end)return {clarify:'What is the start and end date, in that order?'};
  } else if(named.length===1) {
    const month=`${named[0][2]??today.slice(0,4)}-${String(monthNames.indexOf(named[0][1].toLowerCase())+1).padStart(2,'0')}`;
    period=monthPeriod(month);label=monthLabel(month);
  } else if(named.length>1)return {clarify:'Which single month or ISO date range should I use?'};
  else if(/\b(last|this) month\b/i.test(text)) {
    const [y,m]=today.split('-').map(Number), last=/\blast month\b/i.test(text);
    const month=new Date(Date.UTC(y,m-1-(last?1:0),1)).toISOString().slice(0,7);
    period=monthPeriod(month);label=monthLabel(month);relative=true;
  } else {
    const month=text.match(/\b\d{4}-(?:0[1-9]|1[0-2])\b/)?.[0];
    if(month){period=monthPeriod(month);label=monthLabel(month);}
    else {
      const years=text.match(/\b(?:19|20)\d{2}\b/g)??[];
      const relativeYear=text.match(/\b(last|this) year\b/i)?.[1]?.toLowerCase();
      if(years.length>1)return {clarify:'Which single year or ISO date range should I total?'};
      const year=years[0] ?? (relativeYear?String(Number(today.slice(0,4))-(relativeYear==='last'?1:0)):null);
      if(year){period={start:year+'-01-01',end:year+'-12-31'};label=year;relative=!!relativeYear;}
    }
  }
  if(!period)return {clarify:'Which month, year or date range should I look up?'};
  const topMatch=text.match(/\b(?:top\s+)?(\d+|one|two|three|four|five|ten)?\s*(?:biggest|largest)\b/i);
  const numbers={one:1,two:2,three:3,four:4,five:5,ten:10};
  const limit=topMatch?Math.min(10,Math.max(1,numbers[topMatch[1]?.toLowerCase()]??Number(topMatch[1]??3))):null;
  const categories=[...new Set(ledger.transactions.map(t=>t.category))];
  const aliases={grocery:'Groceries',groceries:'Groceries',rent:'Housing',transport:'Transportation'};
  const categoryText=text.match(/\bon\s+(.+?)(?=\s+(?:at|from|in|during|for|last month|this month|last year|this year|between)\b|$)/i)?.[1];
  let category=null;
  if(categoryText && !validDate(categoryText)){category=categories.find(c=>normalize(c)===normalize(categoryText))??aliases[normalize(categoryText)];if(!category)return {clarify:`Which spending category do you mean by “${categoryText.slice(0,60)}”?`};}
  const merchant=text.match(/\b(?:at|from)\s+(.+?)(?=\s+(?:in|during|last month|this month|last year|this year|between|on|for)\b|$)/i)?.[1]?.trim();
  // "from DATE to DATE" is a range, not a merchant.
  return {period,label,relative,today,category,merchant:merchant&& !/^\d{4}-/.test(merchant)?merchant:null,limit};
}

export function queryHistory(query, {ledger=activity, plan=accountPlan, customerId=accountPlan.customerId}={}) {
  if(customerId!==plan.customerId || ledger.customerId!==customerId)return {status:'unavailable'};
  try { validateLedger(plan,ledger); } catch { return {status:'unavailable'}; }
  const {period}=query;
  const start=period.start>ledger.coverage.start?period.start:ledger.coverage.start;
  const end=[period.end,ledger.coverage.end,query.today].sort()[0];
  if(start>end)return {status:'missing',coverage:ledger.coverage};
  const partial=start!==period.start || end!==period.end;
  const rows=ledger.transactions.filter(t=>t.customerId===customerId && plan.forecast.accounts.some(a=>a.accountId===t.accountId)
    && t.date>=start && t.date<=end && isBudgetSpending(t) && (!query.category || t.category===query.category));
  let matching=rows;
  if(query.merchant){
    const needle=normalize(query.merchant), byId=/^mrc[ -]/i.test(query.merchant);
    // Sponsor IDs have no published merchant-name mapping. Never infer a brand from a category.
    const field=byId?'merchantId':'merchantName';
    if(!byId && !ledger.transactions.some(t=>typeof t.merchantName==='string' && t.merchantName.trim()))return {status:'merchant_unavailable'};
    matching=rows.filter(t=>typeof t[field]==='string' && normalize(t[field])===needle);
    if(rows.some(t=>!t[field]))return {status:'merchant_partial',knownCents:matching.filter(t=>t.amountCents<0).reduce((n,t)=>n-t.amountCents,0),rows:matching,partial,start,end};
  }
  const debits=matching.filter(t=>t.amountCents<0).sort((a,b)=>a.amountCents-b.amountCents || a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const totalCents=debits.reduce((n,t)=>n-t.amountCents,0);
  const refundsCents=matching.filter(t=>t.amountCents>0).reduce((n,t)=>n+t.amountCents,0);
  const selected=query.limit?debits.slice(0,query.limit):debits;
  return {status:partial?'partial':'complete',start,end,totalCents,refundsCents,count:debits.length,
    selectedTotalCents:selected.reduce((n,t)=>n-t.amountCents,0),rows:selected};
}

export function historyAnswer(message, {customerId,today,previousQuestion,ledger=activity,plan=accountPlan}={}) {
  let query=parseHistoryQuestion(message,today,ledger);
  // Resolve a narrow clarification without treating chat history as transaction data.
  const followUp=message.trim().replace(/^(?:what about|and|in|for)\s+/i,'').replace(/[?.!]+$/,'');
  if(!query && previousQuestion && /^(?:\d{4}(?:-\d{2}(?:-\d{2})?)?(?: to \d{4}-\d{2}-\d{2})?|(?:january|february|march|april|may|june|july|august|september|october|november|december)(?: \d{4})?|last month|this month|last year|this year)$/i.test(followUp)) {
    const prior=parseHistoryQuestion(previousQuestion,today,ledger);
    if(prior?.period){
      const updated=parseHistoryQuestion('How much did I spend in '+followUp,today,ledger);
      if(updated?.period)query={...prior,...updated,category:prior.category,merchant:prior.merchant,limit:prior.limit};
    } else if(prior?.clarify)query=parseHistoryQuestion(previousQuestion+' in '+followUp,today,ledger);
  }
  if(!query && previousQuestion) {
    const prior=parseHistoryQuestion(previousQuestion,today,ledger);
    const category=[...new Set(ledger.transactions.map(t=>t.category))].find(c=>normalize(c)===normalize(message));
    const merchantId=/^MRC-[A-Z]+-\d+$/i.test(message.trim())?message.trim():null;
    if(prior?.period && prior.merchant && (category || merchantId))query={...prior,merchant:merchantId,category:category??null};
  }
  if(!query)return null;
  if((message.match(/\bCUST\d+\b/gi)??[]).some(id=>id.toUpperCase()!==customerId))return presentation('I can only look up transactions for the selected demo customer.');
  if(customerId!==plan.customerId)return presentation('Historical transactions aren’t connected for this selected demo profile.');
  if(query.clarify)return presentation('I can look up recorded spending.',query.clarify);
  const result=queryHistory(query,{ledger,plan,customerId});
  const scope=query.merchant?` at ${query.merchant}`:query.category?` on ${query.category.toLowerCase()}`:'';
  if(result.status==='unavailable')return presentation('I couldn’t verify the transaction history for this account.');
  if(result.status==='missing')return presentation(`No recorded history covers ${query.label}. Available history runs from ${result.coverage.start} to ${result.coverage.end}; forecast amounts aren’t actual spending.`);
  if(result.status==='merchant_unavailable')return presentation(`I can’t identify ${query.merchant} in ${query.label}: this ledger has anonymous merchant IDs, without store names.`, 'Do you have its merchant ID, or should I look up a spending category?');
  if(result.status==='merchant_partial')return presentation(result.knownCents>0?`${money(result.knownCents)} is identifiable${scope} in ${query.label}, but missing merchant details mean this isn’t a complete merchant total.`:`I can’t confirm a total${scope} in ${query.label}: some transactions have no merchant details.`, '',
    result.rows.filter(t=>t.amountCents<0).slice(0,12).map(t=>({id:t.id,label:`${t.date} · ${t.merchantName??t.merchantId??t.category}`,value:money(-t.amountCents)})),
    result.partial?[`Partial date coverage: ${result.start} to ${result.end}.`]:[]);
  if(result.status==='partial' && result.count===0)return presentation(`No matching spending appears in the available history (${result.start} to ${result.end}). Coverage is partial, so the total for ${query.label} is unknown.`);
  const evidence=result.rows.slice(0,12).map(t=>({id:t.id,label:`${t.date} · ${t.merchantName??t.merchantId??t.category}`,value:money(-t.amountCents)}));
  const note=result.status==='partial'?`Partial history only: ${result.start} to ${result.end}; this is not a full-period total.`:query.relative?`Relative dates use the demo date, ${today}.`:'';
  if(query.limit){
    const items=result.rows.map(t=>`${money(-t.amountCents)} ${t.merchantName??t.category} (${t.date})`).join('; ');
    return presentation(`${money(result.selectedTotalCents)} across the ${result.rows.length} largest spending payments${scope} in ${query.label}.${items?' '+items+'.':''}`, '', evidence,
      [note || 'Spending excludes income, transfers and investments.']);
  }
  return presentation(`${money(result.totalCents)} recorded spending${scope} in ${query.label}${result.status==='partial'?' (partial history)':''}.`, '', evidence,
    [note,result.refundsCents?`${money(result.refundsCents)} in refunds is shown separately, not deducted.`:''].filter(Boolean));
}
