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
  return /\b(?:how much (?:money )?(?:did|have) i (?:spend|spent|pay|paid)|what (?:did|have) i (?:spend|spent|pay|paid)|(?:show|list|what|which|summari[sz]e|tell me).*(?:biggest|largest|transactions|payments|spending|spent|expenses|income|earnings|salary|refund(?:s|ed)?)|(?:historical|recorded|actual|annual|yearly|total) spending|spending (?:on|at|in|for|last)|how much.*(?:spent|spending|earn|earned|income|refund(?:s|ed)?))\b/i.test(text);
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
  let category=null,categoryList=null;
  if(categoryText && !validDate(categoryText)){
    const parts=categoryText.replace(/\b(combined|together)\b/gi,'').trim().split(/\s+(?:and|&)\s+|,\s*/);
    categoryList=[...new Set(parts.map(part=>categories.find(c=>normalize(c)===normalize(part))??aliases[normalize(part)]))];
    if(categoryList.some(c=>!c) || categoryList.length>8)return {clarify:`Which recorded categories do you mean by “${categoryText.slice(0,60)}”?`};
    category=categoryList.length===1?categoryList[0]:null;
  }
  if(!category && !categoryList){
    const labels=[...categories.map(name=>[name.toLowerCase(),name]),...Object.entries(aliases)];
    const inferred=[...new Set(labels.filter(([label])=>new RegExp('\\b'+label+'\\s+(?:spending|expenses|payments|refunds)\\b','i').test(text)).map(([,name])=>name))];
    if(inferred.length>1)return {clarify:'Which single spending category should I look up?'};
    category=inferred[0]??null;
  }
  if(!category && !categoryList && /\bsalary\b/i.test(text) && !/\bother income\b/i.test(text))category='Salary';
  const merchant=text.match(/\b(?:at|from)\s+(.+?)(?=\s+(?:in|during|last month|this month|last year|this year|between|on|for)\b|$)/i)?.[1]?.trim();
  // "from DATE to DATE" is a range, not a merchant.
  return {period,label,relative,today,measure:/\b(income|earnings|earned|earn|salary)\b/i.test(text)?'income':/\brefund(?:s|ed)?\b/i.test(text)?'refunds':'spending',category,categories:categoryList,merchant:merchant&& !/^\d{4}-/.test(merchant)?merchant:null,limit};
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
    && t.date>=start && t.date<=end && (query.measure==='income'?['salary','other_income'].includes(t.type):isBudgetSpending(t)) && (query.categories?.length?query.categories.includes(t.category):!query.category || t.category===query.category));
  let matching=rows;
  if(query.measure==='income'){
    const incomeRows=rows.filter(t=>t.amountCents>0).sort((a,b)=>b.amountCents-a.amountCents || a.id.localeCompare(b.id));
    if(query.merchant)return {status:'merchant_unavailable'};
    return {status:partial?'partial':'complete',start,end,incomeCents:incomeRows.reduce((n,t)=>n+t.amountCents,0),rows:incomeRows};
  }
  if(query.merchant){
    const needle=normalize(query.merchant), byId=/^mrc[ -]/i.test(query.merchant);
    // Sponsor IDs have no published merchant-name mapping. Never infer a brand from a category.
    const field=byId?'merchantId':'merchantName';
    if(!byId && !ledger.transactions.some(t=>typeof t.merchantName==='string' && t.merchantName.trim()))return {status:'merchant_unavailable'};
    matching=rows.filter(t=>typeof t[field]==='string' && normalize(t[field])===needle);
    if(rows.some(t=>!t[field]))return {status:'merchant_partial',knownCents:matching.filter(t=>t.amountCents<0).reduce((n,t)=>n-t.amountCents,0),refundsCents:matching.filter(t=>t.amountCents>0).reduce((n,t)=>n+t.amountCents,0),rows:matching,partial,start,end};
  }
  const debits=matching.filter(t=>t.amountCents<0).sort((a,b)=>a.amountCents-b.amountCents || a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const totalCents=debits.reduce((n,t)=>n-t.amountCents,0);
  const refundsCents=matching.filter(t=>t.amountCents>0).reduce((n,t)=>n+t.amountCents,0);
  const selected=query.limit?debits.slice(0,query.limit):debits;
  const refunds=matching.filter(t=>t.amountCents>0).sort((a,b)=>b.amountCents-a.amountCents || a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const refundRows=query.limit?refunds.slice(0,query.limit):refunds;
  return {status:partial?'partial':'complete',start,end,totalCents,refundsCents,count:debits.length,
    selectedTotalCents:selected.reduce((n,t)=>n-t.amountCents,0),rows:selected,refundRows,selectedRefundsCents:refundRows.reduce((n,t)=>n+t.amountCents,0)};
}

function restoreQuery(value,customerId,today,ledger) {
  if(!value || value.customerId!==customerId || value.today!==today || !validDate(value.period?.start) || !validDate(value.period?.end) || value.period.start>value.period.end
    || !(value.category===null || ledger.transactions.some(t=>t.category===value.category))
    || !(value.merchant===null || typeof value.merchant==='string' && value.merchant.length<=100)
    || !(value.categories==null || Array.isArray(value.categories) && value.categories.length<=8 && value.categories.every(c=>ledger.transactions.some(t=>t.category===c)))
    || ![undefined,'spending','refunds','income'].includes(value.measure)
    || !(value.limit===null || Number.isInteger(value.limit)&&value.limit>=1&&value.limit<=10))return null;
  const {period,category,merchant,limit}=value;
  const year=period.start.slice(0,4),month=period.start.slice(0,7);
  const label=period.start===year+'-01-01' && period.end===year+'-12-31'?year
    :period.start===month+'-01' && period.end===monthPeriod(month).end?monthLabel(month):`${period.start} to ${period.end}`;
  return {period,category,categories:value.categories??null,merchant,limit,label,today,measure:value.measure??'spending',relative:value.relative===true};
}
export function historyAnswer(message, {customerId,today,previousQuestion,previousHistory,ledger=activity,plan=accountPlan}={}) {
  let query=parseHistoryQuestion(message,today,ledger);
  const restored=restoreQuery(previousHistory,customerId,today,ledger);
  const respond=(summary,nextQuestion='',evidence=[],bullets=[])=>({...presentation(summary,nextQuestion,evidence,bullets),
    ...(query?.period && customerId===plan.customerId?{historyQuery:{customerId,today,period:query.period,category:query.category,categories:query.categories??null,merchant:query.merchant,limit:query.limit,relative:query.relative,measure:query.measure??'spending'}}:{})});
  // Resolve a narrow clarification without treating chat history as transaction data.
  const followUp=message.trim().replace(/^(?:what about|and|in|for)\s+/i,'').replace(/[?.!]+$/,'');
  if(restored && /^refunds?$/i.test(followUp))query={...restored,measure:'refunds',limit:null};
  if(!query && restored){
    const aliases={grocery:'Groceries',groceries:'Groceries',rent:'Housing',transport:'Transportation'};
    const category=[...new Set(ledger.transactions.map(t=>t.category))].find(c=>normalize(c)===normalize(followUp))??aliases[normalize(followUp)];
    if(category){
      const incomeCategory=ledger.transactions.some(t=>t.category===category && ['salary','other_income'].includes(t.type));
      const measure=incomeCategory?'income':restored.measure==='income'?'spending':restored.measure;
      query={...restored,category,categories:null,merchant:null,measure};
    }
  }
  if(!query && (previousQuestion || restored) && /^(?:\d{4}(?:-\d{2}(?:-\d{2})?)?(?: to \d{4}-\d{2}-\d{2})?|(?:january|february|march|april|may|june|july|august|september|october|november|december)(?: \d{4})?|last month|this month|last year|this year)$/i.test(followUp)) {
    const prior=restored ?? parseHistoryQuestion(previousQuestion??'',today,ledger);
    if(prior?.period){
      const updated=parseHistoryQuestion('How much did I spend in '+followUp,today,ledger);
      if(updated?.period)query={...prior,...updated,category:prior.category,categories:prior.categories??null,merchant:prior.merchant,limit:prior.limit,measure:prior.measure??'spending'};
    } else if(prior?.clarify)query=parseHistoryQuestion(previousQuestion+' in '+followUp,today,ledger);
  }
  if(!query && (previousQuestion || restored)) {
    const prior=restored ?? parseHistoryQuestion(previousQuestion??'',today,ledger);
    const category=[...new Set(ledger.transactions.map(t=>t.category))].find(c=>normalize(c)===normalize(message));
    const merchantId=/^MRC-[A-Z]+-\d+$/i.test(message.trim())?message.trim():null;
    if(prior?.period && prior.merchant && (category || merchantId))query={...prior,merchant:merchantId,category:category??null,categories:null};
  }
  if(!query)return null;
  if((message.match(/\bCUST\d+\b/gi)??[]).some(id=>id.toUpperCase()!==customerId))return respond('I can only look up transactions for the selected demo customer.');
  if(customerId!==plan.customerId)return respond('Historical transactions aren’t connected for this selected demo profile.');
  if(query.clarify)return respond('I can look up recorded spending.',query.clarify);
  const result=queryHistory(query,{ledger,plan,customerId});
  const scope=query.merchant?` at ${query.merchant}`:query.categories?.length>1?` on ${query.categories.map(c=>c.toLowerCase()).join(' and ')}`:query.category?` on ${query.category.toLowerCase()}`:'';
  if(result.status==='unavailable')return respond('I couldn’t verify the transaction history for this account.');
  if(result.status==='missing')return respond(`No recorded history covers ${query.label}. Available history runs from ${result.coverage.start} to ${result.coverage.end}; forecast amounts aren’t actual spending.`);
  if(result.status==='merchant_unavailable')return respond(`I can’t identify ${query.merchant} in ${query.label}: this ledger has anonymous merchant IDs, without store names.`, 'Do you have its merchant ID, or should I look up a spending category?');
  if(query.measure==='income'){
    if(result.status==='partial' && !result.rows.length)return respond(`No income appears in the available history (${result.start} to ${result.end}); the full-period total is unknown.`);
    return respond(`${money(result.incomeCents)} in recorded ${query.category==='Salary'?'salary':'income'} in ${query.label}${result.status==='partial'?' (partial history)':''}.`, '',
      result.rows.slice(0,12).map(t=>({id:t.id,label:`${t.date} · ${t.category}`,value:money(t.amountCents)})),
      [result.status==='partial'?`Available dates: ${result.start} to ${result.end}; this is not a full-period total.`:query.category==='Salary'?'Includes salary credits only; excludes refunds and investment transfers.':'Includes salary and other income; excludes refunds and investment transfers.']);
  }
  if(query.measure==='refunds'){
    const rows=(result.refundRows??result.rows??[]).filter(t=>t.amountCents>0);
    const evidence=rows.slice(0,12).map(t=>({id:t.id,label:`${t.date} · ${t.merchantName??t.merchantId??t.category}`,value:money(t.amountCents)}));
    if(result.status==='merchant_partial')return respond(`Merchant details are incomplete; ${money(result.refundsCents)} in refunds is identifiable${scope} in ${query.label}.`, '', evidence,
      result.partial?[`Available dates: ${result.start} to ${result.end}; this is not a full-period total.`]:[]);
    if(result.status==='partial' && !rows.length)return respond(`No matching refunds appear in the available history (${result.start} to ${result.end}); the full-period refund total is unknown.`);
    if(query.limit)return respond(`${money(result.selectedRefundsCents)} across the ${rows.length} largest recorded refunds${scope} in ${query.label}. ${rows.map(t=>`${money(t.amountCents)} on ${t.date}`).join('; ')}`, '', evidence,
      result.status==='partial'?[`Available dates: ${result.start} to ${result.end}; this is not a full-period total.`]:[]);
    return respond(`${money(result.refundsCents)} in recorded refunds${scope} in ${query.label}${result.status==='partial'?' (partial history)':''}.`, '', evidence,
      [result.status==='partial'?`Available dates: ${result.start} to ${result.end}; this is not a full-period total.`:'Refunds are separate from gross spending.']);
  }
  if(result.status==='merchant_partial')return respond(result.knownCents>0?`${money(result.knownCents)} is identifiable${scope} in ${query.label}, but missing merchant details mean this isn’t a complete merchant total.`:`I can’t confirm a total${scope} in ${query.label}: some transactions have no merchant details.`, '',
    result.rows.filter(t=>t.amountCents<0).slice(0,12).map(t=>({id:t.id,label:`${t.date} · ${t.merchantName??t.merchantId??t.category}`,value:money(-t.amountCents)})),
    result.partial?[`Partial date coverage: ${result.start} to ${result.end}.`]:[]);
  if(result.status==='partial' && result.count===0)return respond(`No matching spending appears in the available history (${result.start} to ${result.end}). Coverage is partial, so the total for ${query.label} is unknown.`);
  const evidence=result.rows.slice(0,12).map(t=>({id:t.id,label:`${t.date} · ${t.merchantName??t.merchantId??t.category}`,value:money(-t.amountCents)}));
  const note=result.status==='partial'?`Partial history only: ${result.start} to ${result.end}; this is not a full-period total.`:query.relative?`Relative dates use the demo date, ${today}.`:'';
  if(query.limit){
    const items=result.rows.map(t=>`${money(-t.amountCents)} ${t.merchantName??t.category} (${t.date})`).join('; ');
    return respond(`${money(result.selectedTotalCents)} across the ${result.rows.length} largest spending payments${scope} in ${query.label}.${items?' '+items+'.':''}`, '', evidence,
      [note || 'Spending excludes income, transfers and investments.']);
  }
  return respond(`${money(result.totalCents)} recorded spending${scope} in ${query.label}${result.status==='partial'?' (partial history)':''}.`, '', evidence,
    [note,result.refundsCents?`${money(result.refundsCents)} in refunds is shown separately, not deducted.`:''].filter(Boolean));
}
