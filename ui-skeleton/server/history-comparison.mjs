import {activity} from './budget.mjs';
import {accountPlan} from './account.mjs';
import {parseHistoryQuestion,queryHistory} from './transaction-history.mjs';
const months=['january','february','march','april','may','june','july','august','september','october','november','december'];
const money=n=>new Intl.NumberFormat('en-IE',{style:'currency',currency:'EUR'}).format(n/100);
export function historyComparisonAnswer(message,{customerId,today,ledger=activity,plan=accountPlan}={}){
 if(!/\b(compare|versus|vs|difference)\b/i.test(message) || /\b(forecast|could|can i|save|savings|draft|next)\b/i.test(message))return null;
 const reply=(summary,bullets=[],nextQuestion='',evidence=[])=>({title:'',summary,bullets,nextQuestion,evidence});
 if(customerId!==plan.customerId)return reply('Historical comparisons aren’t connected for this selected profile.');
 if((message.match(/\bCUST\d+\b/gi)??[]).some(id=>id.toUpperCase()!==customerId))return reply('I can only compare the selected customer’s transactions.');
 const named=[...message.matchAll(/\b(january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+(\d{4}))?\b/gi)];
 let periods=[],filter=message;
 if(named.length){
  const sharedYear=named.findLast(m=>m[2])?.[2]??today.slice(0,4);
  periods=named.map(m=>`${m[2]??sharedYear}-${String(months.indexOf(m[1].toLowerCase())+1).padStart(2,'0')}`);
  for(const m of named)filter=filter.replace(m[0],'');
 }else{
  const iso=[...message.matchAll(/\b\d{4}-(?:0[1-9]|1[0-2])\b/g)];
  const tokens=iso.length?iso:[...message.matchAll(/\b(?:19|20)\d{2}\b/g)];periods=tokens.map(m=>m[0]);for(const t of tokens)filter=filter.replace(t[0],'');
 }
 if(periods.length!==2 || periods[0]===periods[1])return reply('I can compare recorded spending, income or refunds.',[],'Which two different months or years should I compare?');
 filter=filter.replace(/\b(compare|versus|vs|difference|between|and|in)\b/gi,' ').replace(/\s+/g,' ').trim();
 const explicitCategories=message.match(/\bon\s+(.+?)(?=\s+(?:in|between|during)\b|$)/i)?.[1];
 const measure=/\b(income|earnings|salary)\b/i.test(message)?'income':/\brefunds?\b/i.test(message)?'refunds':'spending';
 if(explicitCategories)filter=`${measure} on ${explicitCategories}`;
 else if(!/\b(at|from)\b/i.test(filter)){
   const known=[...new Set(ledger.transactions.map(t=>t.category))].map(c=>[c,c]);
   known.push(['grocery','Groceries'],['rent','Housing'],['transport','Transportation']);
   const selected=[...new Set(known.filter(([label])=>new RegExp('\\b'+label+'\\b','i').test(filter)).map(([,c])=>c))];
   if(selected.length)filter=`${measure} on ${selected.join(' and ')}`;
 }
 const queries=periods.map(period=>parseHistoryQuestion(`Show ${filter||'spending'} in ${period}`,today,ledger));
 if(queries.some(q=>!q || q.clarify))return reply('I need a clearer comparison.',[],'Which category or merchant should I use for both periods?');
 const results=queries.map(q=>queryHistory(q,{customerId,ledger,plan}));
 const selectedMeasure=queries[0].measure,field=selectedMeasure==='income'?'incomeCents':selectedMeasure==='refunds'?'refundsCents':'totalCents';
 if(results.some(r=>!['complete','partial'].includes(r.status)))return reply('I can’t make a reliable comparison: one period or merchant is missing verified coverage.',[], '', []);
 const scope=queries[0].categories?.length?` on ${queries[0].categories.join(' and ').toLowerCase()}`:queries[0].category?` on ${queries[0].category.toLowerCase()}`:queries[0].merchant?` at ${queries[0].merchant}`:'';
 const summary=results.map((r,i)=>`${money(r[field])} recorded ${measure}${scope} in ${queries[i].label}${r.status==='partial'?` (partial: ${r.start} to ${r.end})`:''}`).join('; ')+'.';
 const complete=results.every(r=>r.status==='complete');const delta=complete?results[1][field]-results[0][field]:null;
 const bullets=[complete?(delta===0?'The recorded totals are equal.':`${queries[1].label} was ${money(Math.abs(delta))} ${delta>0?'higher':'lower'} than ${queries[0].label}.`):'Coverage is partial, so a full-period change cannot be calculated.'];
 const evidence=results.flatMap((r,i)=>(measure==='refunds'?r.refundRows:r.rows).slice(0,6).map(t=>({id:t.id,label:`${queries[i].label} · ${t.date} · ${t.category}`,value:money(Math.abs(t.amountCents))})));
 return reply(summary,bullets,'',evidence);
}
