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

test('completed label alone cannot mark verified DONE',()=>{
  assert.deepEqual(planContinuation({cases:[{...item,status:'completed'}],agents:[],now})[0],{case_id:item.case_id,decision:'HOLD',reason:'completion-evidence-unverified'});
});
test('missing receiver file ownership is HOLD',()=>{
  assert.equal(planContinuation({cases:[item],agents:[{id:'new',authenticated:true,connected:true,lastRunAt:now}],now})[0].reason,'ownership-unverified');
});
test('missing source changed_files is HOLD',()=>{
  assert.equal(planContinuation({cases:[{...item,changed_files:undefined}],agents:[{id:'new',authenticated:true,connected:true,lastRunAt:now,claimedFiles:[]}],now})[0].reason,'ownership-unverified');
});
test('duplicate authenticated agent ID does not silently overwrite claims',()=>{
  const agents=[{id:'new',authenticated:true,connected:true,lastRunAt:now,claimedFiles:['a.js']},{id:'new',authenticated:true,connected:true,lastRunAt:now,claimedFiles:[]}];
  assert.equal(planContinuation({cases:[item],agents,now})[0].reason,'ambiguous-agent-identity');
});
test('one batch does not propose simultaneous handoff of the same repo file',()=>{
  const agents=[{id:'new',authenticated:true,connected:true,lastRunAt:now,claimedFiles:[]}];
  const result=planContinuation({cases:[item,{...item,case_id:'repo#90'}],agents,now});
  assert.equal(result[0].decision,'HANDOFF_PROPOSED');
  assert.equal(result[1].reason,'overlapping-proposed-claim');
});
test('invalid receiver claimedFiles type fails closed without exception',()=>{
  const agents=[{id:'new',authenticated:true,connected:true,lastRunAt:now,claimedFiles:'unknown'}];
  assert.equal(planContinuation({cases:[item],agents,now})[0].reason,'ownership-unverified');
});
test('invalid source file list does not interrupt other valid cases',()=>{
  const agents=[{id:'new',authenticated:true,connected:true,lastRunAt:now,claimedFiles:[]}];
  const results=planContinuation({cases:[{...item,changed_files:'unknown'},{...item,case_id:'repo#91'}],agents,now});
  assert.equal(results[0].reason,'ownership-unverified');
  assert.equal(results[1].decision,'HANDOFF_PROPOSED');
});
