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
