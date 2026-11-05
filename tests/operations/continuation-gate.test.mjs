import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {planContinuation} from '../../scripts/operations/continuation-gate.mjs';
const now=Date.parse('2026-11-05T15:00:00Z');
const item={case_id:'repo#89',repo:'repo',next_action:'inspect',status:'implementing',changed_files:['a.js'],agent_id:'old'};
test('stalled owner proposes only verified nonconflicting receiver',()=>{
  assert.equal(planContinuation({cases:[item],agents:[{id:'old',authenticated:true,connected:true,lastRunAt:now-99999999},{id:'new',authenticated:true,connected:true,lastRunAt:now,claimedFiles:['b.js']}],now})[0].decision,'HANDOFF_PROPOSED');
});
test('no verified receiver remains HOLD',()=>{
  assert.equal(planContinuation({cases:[item],agents:[{id:'new',authenticated:false,connected:true,lastRunAt:now}],now})[0].decision,'HOLD');
});
test('healthy owner is retained',()=>{
  assert.equal(planContinuation({cases:[item],agents:[{id:'old',authenticated:true,connected:true,lastRunAt:now}],now})[0].decision,'KEEP');
});
test('external CI blocker is not bypassed',()=>{
  assert.equal(planContinuation({cases:[{...item,blocker:'ci-quota'}],agents:[],now})[0].decision,'HOLD');
});
test('conflicting file claim cannot receive handoff',()=>{
  assert.equal(planContinuation({cases:[item],agents:[{id:'new',authenticated:true,connected:true,lastRunAt:now,claimedFiles:['a.js']}],now})[0].decision,'HOLD');
});

test('future-dated heartbeat cannot masquerade as active',()=>{
  assert.equal(planContinuation({cases:[item],agents:[{id:'old',authenticated:true,connected:true,lastRunAt:now+60000}],now})[0].decision,'HOLD');
});
test('stale receiver cannot accept a handoff',()=>{
  assert.equal(planContinuation({cases:[item],agents:[{id:'new',authenticated:true,connected:true,lastRunAt:now-7200001,claimedFiles:[]}],now})[0].decision,'HOLD');
});
