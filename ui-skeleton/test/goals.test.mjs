import test from 'node:test';
import assert from 'node:assert/strict';
import goals, { growthIllustration } from '../api/goals.js';
function call(url='/api/goals',method='GET') { const res={setHeader(){},end(text){this.body=JSON.parse(text);}};goals({url,method},res);return res; }
test('teammate goal projections and recovery amounts survive integration',()=>{
  const before=call('/api/goals?scenario=beforeExpense');const after=call();
  assert.equal(before.body.result.projectedSavedCents,27000);
  assert.equal(after.body.result.projectedSavedCents,21000);
  assert.equal(after.body.result.recoveryOption.projectedSavedIfFollowedCents,24000);
  assert.equal(after.body.goal.savedCents,15000);
  assert.equal(after.body.movesMoney,false);
});
test('zero and negative returns remain distinct from guaranteed contributions',()=>{
  const flat=growthIllustration(2000,10,0);assert.equal(flat.projectedCents,240000);
  const loss=growthIllustration(2000,10,-0.03);assert.ok(loss.projectedCents<loss.contributedCents);
  assert.equal(growthIllustration(0,10,0.06).projectedCents,0);
});
test('invalid goal inputs and mutation methods are rejected',()=>{
  for(const query of ['scenario=missing','monthly=-1','monthly=1.1','monthly=Infinity','years=1','years=2.5','rate=0.11'])assert.equal(call('/api/goals?'+query).statusCode,400,query);
  assert.equal(call('/api/goals','POST').statusCode,405);
});
