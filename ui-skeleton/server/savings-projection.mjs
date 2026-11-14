import { accountPlan } from './account.mjs';
import { calculateGoalPlan } from './goals/coach.mjs';

const money=n=>new Intl.NumberFormat('en-IE',{style:'currency',currency:'EUR'}).format(n/100);
const dateLabel=d=>new Date(d+'T12:00:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'});
const validDate=d=>typeof d==='string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(Date.parse(d)) && new Date(d+'T12:00:00Z').toISOString().slice(0,10)===d;
const months=['january','february','march','april','may','june','july','august','september','october','november','december'];
const reply=(summary,nextQuestion='')=>({title:'',summary,bullets:[],nextQuestion});
function targetDate(text,today) {
  const duration=text.match(/\b(?:next|over|for|in)\s+(?:the\s+)?(\d+)\s+(months?|years?)\b/i);
  if(duration){const count=Number(duration[1])*(/^year/i.test(duration[2])?12:1);if(count<1||count>120)return 'invalid';const [y,m]=today.split('-').map(Number);return new Date(Date.UTC(y,m+count,0)).toISOString().slice(0,10);}
  const iso=text.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];if(iso)return iso;
  const month=text.toLowerCase().match(/\b(?:(\d{1,2})(?:st|nd|rd|th)?\s+)?(january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+(\d{1,2})(?:st|nd|rd|th)?,?)?\s+(20\d{2})\b/);
  if(month){
    const year=month[4],m=months.indexOf(month[2])+1,day=month[1]??month[3];
    return day?`${year}-${String(m).padStart(2,'0')}-${String(day).padStart(2,'0')}`:new Date(Date.UTC(Number(year),m,0)).toISOString().slice(0,10);
  }
  const relative=text.match(/\b(next|this) year\b/i)?.[1]?.toLowerCase();
  const year=text.match(/\b20\d{2}\b/)?.[0]??(relative?String(Number(today.slice(0,4))+(relative==='next'?1:0)):null);
  return year?year+(/\b(start|beginning)\b/i.test(text)?'-01-01':'-12-31'):null;
}
const futureIntent=text=>/\b(save|savings|set aside)\b/i.test(text) && (/\b(by|until|till|through|end of|project|projection|forecast|future|next)\b/i.test(text) || /\b(over|for|in)\s+(?:the\s+)?\d+\s+(months?|years?)\b/i.test(text));
function cents(text) {
  if(!/^\d+(?:[.,]\d{1,2})?$/.test(text))return null;
  const [whole,fraction='']=text.replace(',','.').split('.');const value=Number(whole)*100+Number(fraction.padEnd(2,'0'));
  return Number.isSafeInteger(value)&&value>=0&&value<=1000000?value:null;
}
// Build contribution dates, then reuse the existing server-side Goals calculator.
// This is a contribution illustration, not an extension of the 30-day cash forecast.
export function projectContributions({customerId,asOf,endDate,monthlyCents}) {
  if(customerId!==accountPlan.customerId || !validDate(asOf) || !validDate(endDate) || endDate<=asOf
    || !Number.isSafeInteger(monthlyCents) || monthlyCents<0 || monthlyCents>1000000)throw Error('Invalid projection');
  const [year,month]=asOf.split('-').map(Number),periods=[];
  for(let offset=0;offset<=120;offset++){
    const date=new Date(Date.UTC(year,month+offset+1,0)).toISOString().slice(0,10);
    if(date>endDate)break;
    if(offset===120)throw Error('Projection exceeds ten years');
    periods.push({month:date.slice(0,7),date,availableToSaveCents:monthlyCents,plannedDeliveryCents:0});
  }
  if(!periods.length)throw Error('No future contribution dates');
  const calculated=calculateGoalPlan({goal:{savedCents:0,targetCents:0},periods,deliveryHistory:[],newExpenses:[]});
  return {customerId,asOf,endDate,monthlyCents,months:periods.length,firstContributionDate:periods[0].date,lastContributionDate:periods.at(-1).date,
    contributedCents:calculated.projectedSavedCents,kind:'contribution_illustration',affordabilityCalculated:false,includesExistingSavings:false,interestIncluded:false};
}
export function savingsProjectionAnswer(message,{customerId,today,draft,previousProjection}={}) {
  const previous=previousProjection?.customerId===customerId && previousProjection.asOf===today ? previousProjection:null;
  const amountOnly=message.trim().match(/^(?:what about |make it |change it to |actually,? |and |use |try |at )?(?:€\s*)?(\d+(?:[.,]\d+)?)(?:\s*(?:euros?|eur))?(?:\s*(?:a month|per month|monthly))?[?.!]?$/i);
  const dateOnly=previous && /^(?:what about |and |by |until |till )?(?:the )?(?:end of )?(?:20\d{2}(?:-\d{2}-\d{2})?|(?:(?:\d{1,2})(?:st|nd|rd|th)? )?(?:january|february|march|april|may|june|july|august|september|october|november|december)(?: \d{1,2}(?:st|nd|rd|th)?,?)? 20\d{2}|next year|this year|(?:over |for |in )?(?:the )?next \d+ (?:months?|years?))[?.!]?$/i.test(message.trim());
  const incomeShock=/\b(lose my job|lost my job|laid off|no income|income (?:stops|falls|drops)|salary (?:falls|drops)|pay cut)\b/i.test(message);
  if(!futureIntent(message) && !(previous && (amountOnly||dateOnly||incomeShock)))return null;
  if(customerId!==accountPlan.customerId)return reply('A savings projection is not connected for this demo profile.');
  const pending=(summary,question,endDate=null)=>({...reply(summary,question),projection:{customerId,asOf:today,endDate,
    monthlyCents:previous?.monthlyCents??(draft?.goal?.period==='monthly'?draft.goal.amountCents:accountPlan.budget.savingsTargetCents)}});
  const endDate=dateOnly?targetDate(message,today):futureIntent(message)?targetDate(message,today):previous?.endDate;
  if(!endDate)return pending('I can illustrate future savings from a monthly contribution.','What target date should I use?');
  if(!validDate(endDate)||endDate<=today)return reply('Choose a date after this demo’s 30 September 2026 starting point.','What future date should I use?');
  if(incomeShock)
    return pending('Losing income could change what you can save; the current target may no longer fit.', 'How much could you still set aside monthly after essential costs?',endDate);
  if(/[$£]|\b(usd|dollars?|gbp|pounds?|weekly|yearly|annually|per year|per week)\b/i.test(message))return pending('This illustration uses monthly contributions in euros.','How much would you set aside each month in euros?',endDate);
  const amounts=[...message.matchAll(/€\s*(-?\d+(?:[.,]\d+)?)|(-?\d+(?:[.,]\d+)?)\s*(?:euros?|eur|a month|per month|monthly)\b/gi)];
  if(amounts.length && !(previous&&amountOnly&&!dateOnly) && (!/\b(monthly|per month|a month|each month)\b|\/month/i.test(message) || /\b(pay|cost|expense|rent|bill)\b/i.test(message)))
    return pending('A target or expense amount is different from a monthly savings contribution.','How much would you set aside each month?',endDate);
  const explicit=previous&&amountOnly&&!dateOnly?cents(amountOnly[1]):amounts.length===1?cents(amounts[0][1]??amounts[0][2]):undefined;
  if(amounts.length>1||explicit===null||/-\s*€/.test(message))return pending('Choose one monthly contribution between €0 and €10,000.','What monthly amount should I use?',endDate);
  const monthlyDraft=draft?.goal?.period==='monthly'?draft.goal.amountCents:null;
  const monthlyCents=explicit??(dateOnly?previous.monthlyCents:null)??monthlyDraft??accountPlan.budget.savingsTargetCents;
  let result;
  try{result=projectContributions({customerId,asOf:today,endDate,monthlyCents});}
  catch{return reply('I can illustrate month-end contributions starting October 2026, for up to ten years.','Which end date and monthly amount should I use?');}
  const p=reply(`${money(result.contributedCents)} in new savings by ${dateLabel(endDate)}, if you set aside ${money(monthlyCents)} monthly for ${result.months} months, starting October 2026.`,explicit===undefined&&!previous?'What monthly amount would you like to use?':'');
  p.bullets=['This is a contribution illustration, not verified affordability. It excludes existing savings, interest and withdrawals; future income and costs could change what you can save.'];
  p.projection=result;
  return p;
}
