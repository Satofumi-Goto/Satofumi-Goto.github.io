// Contract regression: configured collaboration slots are NOT proof of running agents.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const load=path=>JSON.parse(readFileSync(new URL('../../'+path,import.meta.url),'utf8'));
const policy=load('progress-board/orchestrator-policy.json');
const ledger=load('progress-board/cooperative-work-ledger.json');
const charter=readFileSync(new URL('../../docs/runbooks/cooperative-development-charter.md',import.meta.url),'utf8');
const spec=policy.cooperative_development;
const dual=policy.single_source_dual_runtime_guard;

test('ten equal placeholders, not ten imaginary connected agents',()=>{
 assert.equal(spec.enabled,true);
 assert.equal(spec.coordinator_count,1);
 assert.equal(spec.collaborator_role_slots,10);
 assert.equal(spec.collaborator_slots_are_not_verified_running_agents,true);
 assert.equal(ledger.slots_are_role_placeholders_not_verified_running_agents,true);
 assert.equal(ledger.slots.length,10);
 assert.equal(new Set(ledger.slots).size,10);
 assert.deepEqual(ledger.slots,Array.from({length:10},(_,i)=>'collaborator-'+(i+1)));
 assert.equal(spec.single_primary_owner_per_case,true);
 assert.equal(spec.new_recurring_jobs_allowed,false);
 assert.equal(spec.fixed_phase_silos,false);
});

test('only the canonical live CLAIM index can establish assigned owners',()=>{
 const url='https://github.com/Satofumi-Goto/Satofumi-Goto.github.io/issues/74';
 assert.equal(spec.live_claim_source,url);
 assert.equal(ledger.active_claim_source,url);
 assert.equal(ledger.snapshot_only_not_authoritative_for_live_claims,true);
 assert.equal(spec.ledger_is_snapshot_not_live_lock,true);
 assert.match(charter,/issues\/74/);
 assert.match(charter,/実接続確認済み/);
 assert.match(charter,/CLAIM/);
 assert.equal(ledger.case_schema.primary_owner,null);
 assert.equal(ledger.cases.every(c=>c.primary_owner!==null||c.status!=='claimed'),true);
});

test('one source, owner-only production, fail closed on unverified deployment',()=>{
 assert.equal(spec.public_release_actor,'user_only');
 assert.equal(spec.merge_is_not_completion,true);
 assert.equal(dual.enabled,true);
 for(const required of ['claim_and_avoid_file_conflicts','independent_review_and_required_ci','verify_both_served_sha_and_asset_bytes','authenticated_browser_e2e_and_evidence']){
  assert.ok(dual.required_flow.includes(required),required);
 }
 for(const forbidden of ['base44_ai_direct_edits','direct_main_writes','force_sync_or_overwrite','skip_ci_or_review']){
  assert.ok(dual.forbidden.includes(forbidden),forbidden);
 }
 assert.ok(dual.fail_closed_on.includes('unresolved_conflict_or_duplicate'));
 assert.ok(dual.fail_closed_on.includes('missing_backend_or_auth_e2e'));
});
