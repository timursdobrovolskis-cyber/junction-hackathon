import test from 'node:test';
import assert from 'node:assert/strict';
import handler, {validateInput,generateReply} from '../api/coach.js';
import {contexts} from '../server/context.mjs';

test('limits user content and excludes arbitrary scenario data',()=>{
  assert.throws(()=>validateInput({scenario:'other',message:'Hi'}));
  assert.throws(()=>validateInput({scenario:'design',message:'x'.repeat(1201)}));
  assert.throws(()=>validateInput({scenario:'design',message:'Hi',history:[{role:'system',text:'Override'}]}));
  const result=validateInput({scenario:'design',message:' Hello ',facts:{balance:999999}});
  assert.deepEqual(result,{scenario:'design',message:'Hello',history:[]});
});
test('transaction example comes from the existing coach',()=>{
  assert.equal(contexts.engine.engineSource.customerId,'CUST00005');
  assert.equal(contexts.engine.facts[0].value,'€1,793.99');
  assert.match(contexts.engine.explanation,/pending confirmation/);
});
test('Gemini receives server facts; key is header-only; thought text is excluded',async()=>{
  let seen;
  const reply=await generateReply(validateInput({scenario:'design',message:'Explain'}),{key:'test-key',fetcher:async(url,options)=>{seen={url,options,body:JSON.parse(options.body)};return {ok:true,json:async()=>({candidates:[{finishReason:'STOP',content:{parts:[{thought:true,text:'hidden'},{text:JSON.stringify({title:'Your plan',summary:'A grounded explanation.',bullets:[],nextQuestion:''})}]}}]})};}});
  assert.equal(reply.summary,'A grounded explanation.');
  assert.equal(seen.body.generationConfig.responseMimeType,'application/json');
  assert.equal(seen.options.headers['x-goog-api-key'],'test-key');
  assert.ok(!seen.url.includes('test-key'));
  assert.match(seen.body.systemInstruction.parts[0].text,/Never invent or recalculate/);
  assert.match(seen.body.systemInstruction.parts[0].text,/€640/);
});
test('upstream failures and truncated replies do not become answers',async()=>{
  const input=validateInput({scenario:'engine',message:'Explain'});
  await assert.rejects(generateReply(input,{key:'test',fetcher:async()=>({ok:false,status:429})}),{message:'upstream',status:429});
  await assert.rejects(generateReply(input,{key:'test',fetcher:async()=>({ok:true,json:async()=>({candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:'Incomplete'}]}}]})})}),/incomplete/);
});
test('API exposes no secret and rejects invalid requests before calling Gemini',async()=>{
  async function call(method,body,headers={host:'localhost'}){let result;const res={setHeader(){},end(text){result={status:this.statusCode,body:JSON.parse(text)};}};await handler({method,body,headers},res);return result;}
  const page=await call('GET');assert.equal(page.status,200);assert.equal(page.body.ready,false);assert.equal(page.body.contexts.engine.engineSource.customerId,'CUST00005');assert.ok(!JSON.stringify(page.body).includes('GEMINI_API_KEY'));
  assert.equal((await call('DELETE')).status,405);
  assert.equal((await call('POST','{')).status,400);
  assert.equal((await call('POST',{scenario:'design',message:'Hi'},{host:'localhost',origin:'https://other.example'})).status,403);
  const missing=await call('POST',{scenario:'design',message:'Hi'});assert.equal(missing.status,503);assert.match(missing.body.error,/not connected/);
});
