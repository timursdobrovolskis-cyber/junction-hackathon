import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyEdits, amountInCents, validateEdits, readEdits, writeEdits, editsKey, calendarWithEdits, reminderEvents, deletedEvents} from '../dist/calendar-edits.mjs';
import {calendarExamples} from '../server/calendar-data.mjs';
const reminder = overrides => ({id:'one', title:'Gym',date:'2026-11-30',amountCents:2999,kind:'subscription',cadence:'monthly',...overrides});
const store = () => {const values = new Map();return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)}};
test('money entry preserves exact cents and rejects unsupported or unsafe values',()=>{
  for(const [input,result] of [['15.99',1599],['15,99',1599],['400',40000],['0.01',1],[' 20.5 ',2050]]) assert.equal(amountInCents(input),result);
  for(const bad of ['','0','-10','1e3','15.999','1,000.00','Infinity','9999999999'])assert.throws(()=>amountInCents(bad));
});
test('monthly and annual personal reminders handle month ends and leap years without drift',()=>{
 const edits=emptyEdits('test');edits.items=[reminder({date:'2028-01-31'})];
 assert.deepEqual(reminderEvents(edits,'2028-01-01','2028-04-30').map(e=>e.date),['2028-01-31','2028-02-29','2028-03-31','2028-04-30']);
 edits.items=[reminder({date:'2028-02-29',cadence:'yearly'})];
 assert.deepEqual(reminderEvents(edits,'2028-01-01','2032-12-31').map(e=>e.date),['2028-02-29','2029-02-28','2030-02-28','2031-02-28','2032-02-29']);
 edits.items=[reminder({cadence:'once'})];assert.equal(reminderEvents(edits,'2026-11-01','2028-10-31').length,1);
});
test('saved edits survive reopening and remain isolated by customer',()=>{
 const storage=store(),edits=emptyEdits('RISK-DEMO');edits.items.push(reminder());writeEdits(storage,edits);
 assert.deepEqual(readEdits(storage,'RISK-DEMO'),edits);assert.deepEqual(readEdits(storage,'CUST00003'),emptyEdits('CUST00003'));
 storage.setItem(editsKey('CUST00003'),JSON.stringify(edits));assert.throws(()=>readEdits(storage,'CUST00003'));
 assert.throws(()=>writeEdits({setItem(){throw new Error('Quota exceeded')}},edits));
});
test('deleting and restoring dates or a series never mutates engine evidence, totals or forecasts',()=>{
 const data=structuredClone(calendarExamples.risk),original=structuredClone(data),edits=emptyEdits(data.customerId);edits.items=[reminder()];
 const all=calendarWithEdits(data,edits),manual=all.find(e=>e.localId==='one');assert.ok(manual);
 edits.removed=[data.events[0].id,manual.id];
 assert.equal(calendarWithEdits(data,edits).length,all.length-2);assert.equal(deletedEvents(data,edits).length,2);
 edits.removedSeries=['one'];assert.equal(calendarWithEdits(data,edits).some(e=>e.localId==='one'),false);
 assert.equal(deletedEvents(data,edits).filter(e=>e.series).length,1);
 edits.removedSeries=[];edits.removed=[];assert.deepEqual(calendarWithEdits(data,edits),all);assert.deepEqual(data,original);
 assert.throws(()=>calendarWithEdits(data,emptyEdits('CUST00003')));
});
test('invalid persisted edits and duplicate identifiers are rejected',()=>{
 const mutations=[v=>v.items.push(reminder({date:'2026-02-30'})),v=>v.items.push(reminder({amountCents:1.5})),v=>v.items.push(reminder({cadence:'daily'})),v=>v.items.push(reminder({title:'  '})),v=>v.items.push(reminder(),reminder()),v=>v.removed.push('id','id'),v=>v.removedSeries.push('unknown')];
 for(const mutate of mutations){const edits=emptyEdits('RISK-DEMO');mutate(edits);assert.throws(()=>validateEdits(edits,'RISK-DEMO'));}
});
