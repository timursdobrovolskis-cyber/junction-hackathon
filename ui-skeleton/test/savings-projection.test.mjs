import test from 'node:test';
import assert from 'node:assert/strict';
import {projectContributions,savingsProjectionAnswer} from '../server/savings-projection.mjs';
import {conversationReply} from '../server/conversation.mjs';
const base={customerId:'CUST00005',asOf:'2026-09-30',endDate:'2027-12-31',monthlyCents:10000};
const blocked=()=>{throw Error('Contribution illustrations do not need Gemini');};
const turn=(message,session,scenario='engine')=>conversationReply({scenario,message,session,history:[]},blocked);
test('longer-term savings reuses goal calculator with explicit contribution assumptions',()=>{
 const p=projectContributions(base);assert.equal(p.contributedCents,150000);assert.equal(p.months,15);
 assert.equal(p.firstContributionDate,'2026-10-31');assert.equal(p.lastContributionDate,'2027-12-31');
 assert.equal(p.affordabilityCalculated,false);assert.equal(p.includesExistingSavings,false);assert.equal(p.interestIncluded,false);
});
test('exact reported future question answers numerically and repeated amount/date changes stay read-only',async()=>{
 let r=await turn('how much could i save till the end of 2027?');assert.equal(r.source,'projection');assert.match(r.reply,/€1,500.00.*31 December 2027/);
 assert.match(r.reply,/not verified affordability/);assert.doesNotMatch(r.reply,/historical lookups|unknown|only covers October/);
 const draft=structuredClone(r.session.draft);
 for(const [message,total] of [['€200',300000],['€300',450000],['What about 2028?',810000]]){
  r=await turn(message,r.session);assert.equal(r.presentation.projection.contributedCents,total);assert.deepEqual(r.session.draft,draft);
  assert.equal(r.planChanged,false);assert.equal(r.movesMoney,false);
 }
});
test('explicit contribution overrides the target without saving a goal',async()=>{
 const r=await turn('How much could I save at €250 monthly until 2027-12-31?');assert.equal(r.presentation.projection.contributedCents,375000);
 assert.equal(r.session.draft.goal,null);assert.equal(r.session.awaiting,null);
});
test('month-end scheduling handles deadlines, leap years, zero and the ten-year bound',()=>{
 assert.equal(projectContributions({...base,endDate:'2027-12-15'}).months,14);
 assert.equal(projectContributions({...base,asOf:'2027-12-31',endDate:'2028-02-29'}).months,2);
 assert.equal(projectContributions({...base,monthlyCents:0}).contributedCents,0);
 assert.equal(projectContributions({...base,endDate:'2036-09-30'}).months,120);
 for(const change of [{customerId:'CUST00003'},{endDate:'2026-10-01'},{endDate:'2027-02-30'},{endDate:'2036-10-31'},{monthlyCents:-1},{monthlyCents:1000001},{monthlyCents:NaN}])assert.throws(()=>projectContributions({...base,...change}));
});
test('a confirmed monthly draft is a contribution assumption; an unconfirmed proposal is not applied',async()=>{
 let r=await turn('I want to save €400 monthly');const awaiting=r.session.awaiting;
 let read=await turn('How much could I save by the end of 2027?',r.session);assert.equal(read.presentation.projection.monthlyCents,10000);assert.deepEqual(read.session.awaiting,awaiting);
 r=await turn('Add goal',r.session);read=await turn('How much could I save by the end of 2027?',r.session);
 assert.equal(read.presentation.projection.monthlyCents,40000);assert.deepEqual(read.session.draft,r.session.draft);
});
test('missing dates can be clarified; invalid amounts, currencies and different profiles stay separate',async()=>{
 let r=await turn('Can you project my future savings?');assert.match(r.presentation.nextQuestion,/target date/);
 r=await turn('2027',r.session);assert.equal(r.presentation.projection.contributedCents,150000);
 r=await turn('How much could I save at $200 monthly by 2027?');assert.match(r.reply,/monthly contributions in euros/);
 r=await turn('€200',r.session);assert.equal(r.presentation.projection.contributedCents,300000);
 for(const amount of ['€-200','-€200','€200.999','€10001']){
  const r=await turn(`How much could I save at ${amount} monthly by 2027?`);assert.match(r.reply,/between €0 and €10,000/);
 }
 const foreign=await turn('How much could I save by 2027?',undefined,'design');assert.match(foreign.reply,/not connected/);assert.doesNotMatch(foreign.reply,/1,500/);
});
test('ordinary goals and historical spending are not treated as projections',async()=>{
 assert.equal(savingsProjectionAnswer('I want to save €400 monthly',{customerId:base.customerId,today:base.asOf}),null);
 const r=await turn('How much did I spend in 2025?');assert.equal(r.source,'history');
});

test('a future target or cost is never multiplied as a monthly contribution',async()=>{
 for(const message of ['Could I save €400 by the end of 2027?','How much could I save by 2027 if I pay €400 rent monthly?']) {
  const r=await turn(message);assert.match(r.presentation.nextQuestion,/each month/);assert.equal(r.presentation.projection.contributedCents,undefined);
  const clarified=await turn('€100',r.session);assert.equal(clarified.presentation.projection.contributedCents,150000);
 }
});
