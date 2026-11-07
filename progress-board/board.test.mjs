import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
test('canonical board has a parseable inline script',()=>{
  assert.ok(script);
  new Function(script);
});
test('existing board includes shared command intake and all worker panels',()=>{
  for(const id of ['chatWorkers','executorWorkers','commandIntakeRecent','commandIntakeStatus']){
    assert.match(html,new RegExp('id="'+id+'"'));
  }
});
test('escaping helper encodes user-provided text',()=>{
  const prelude=script.slice(0,script.indexOf('function render(d)'));
  const result=runInNewContext(prelude+';esc("<script>")');
  assert.equal(result,'&lt;script&gt;');
});

test('stale snapshot hides misleading live blocked counts and collapses details',()=>{
  const elements=new Map();
  const document={getElementById(id){
    if(!elements.has(id))elements.set(id,{textContent:'',innerHTML:'',hidden:false});
    return elements.get(id);
  }};
  const snapshot={
    generated_at:'2000-01-01T00:00:00Z',completed_total:0,
    orchestrator:{enabled:true,ci_state:'quota_blocked',cadence:'hourly'},
    action_queue:[],fed_actual_operation:null,
    rows:[{owner:'担当A',status:'red',current:'<img src=x onerror=alert(1)>',next:'代替策を検証',evidence:[{text:'証拠',url:'https://github.com/example'}]}],
    apps:[{name:'Seneschal',status:'red',head:'abcdef',summary:'本番は未検証'}],
  };
  const beforeLoader=script.slice(0,script.indexOf('async function loadCommandIntake()'));
  runInNewContext(beforeLoader+';render(snapshot)',{document,snapshot});
  const get=id=>elements.get(id);
  assert.equal(get('mBlocked').textContent,'—');
  assert.match(get('stale').textContent,/現在の停止件数/);
  assert.match(get('apps').innerHTML,/前回記録（要再確認）/);
  assert.match(get('rows').innerHTML,/<details>/);
  assert.match(get('rows').innerHTML,/&lt;img/);
  assert.doesNotMatch(get('rows').innerHTML,/<img/);
  assert.match(get('rows').innerHTML,/https:\/\/github.com\/example/);
});

test('stale or unverified worker receipts do not count as running',()=>{
  const prelude=script.slice(0,script.indexOf('function render(d)'));
  const now=new Date(Date.now()-60_000).toISOString();
  const receipt={signature_verified:true,authenticated:true,pid:12,repo_sha:'a'.repeat(40),
    evidence_url:'https://github.com/example/receipt',heartbeat_at:now};
  const worker={status:'running',executor_verified:true,
    runtime_source:'authenticated_execution_api',runtime_receipt:receipt};
  const verify=w=>runInNewContext(prelude+';hasFreshExecutionProof(worker)',{worker:w});
  assert.equal(verify(worker),true);
  assert.equal(verify({...worker,executor_verified:false}),false);
  assert.equal(verify({...worker,runtime_receipt:{...receipt,heartbeat_at:'2020-01-01T00:00:00Z'}}),false);
  assert.equal(verify({...worker,runtime_source:'manual_json'}),false);
  assert.equal(verify({...worker,runtime_receipt:{...receipt,signature_verified:false}}),false);
});

test('common instruction intake paginates past first ten and fails closed if truncated',async()=>{
  const prelude=script.slice(0,script.indexOf('function render(d)'));
  const pages=[];
  const mockFetch=async url=>{
    pages.push(url);
    return {ok:true,json:async()=>url.includes('page=1')?
      Array.from({length:100},(_,i)=>({id:i})):
      Array.from({length:15},(_,i)=>({id:i+100}))};
  };
  const all=await runInNewContext(prelude+';fetchAllIntakeComments(mockFetch,3)',{mockFetch});
  assert.equal(all.length,115);
  assert.equal(all[114].id,114);
  assert.equal(pages.length,2);
  const full=async()=>({ok:true,json:async()=>Array.from({length:100},(_,i)=>({id:i}))});
  await assert.rejects(runInNewContext(prelude+';fetchAllIntakeComments(full,1)',{full}),/全件取得できない/);
});
