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
