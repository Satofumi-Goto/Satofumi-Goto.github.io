// Pure fail-closed planner. It does not impersonate, start, or resume agents.
// The caller must verify an authenticated agent run and record its evidence.
export function planContinuation({cases, agents, now}) {
  if (!Array.isArray(cases) || !Array.isArray(agents) || !Number.isFinite(now)) throw Error('invalid-input');
  const active = new Map(agents.filter(a => a.id && a.authenticated === true && a.connected === true && Number.isFinite(a.lastRunAt)).map(a => [a.id, a]));
  return cases.map(c => {
    if (!c.case_id || !c.repo || !c.next_action) return {case_id:c.case_id ?? null, decision:'HOLD', reason:'incomplete-checkpoint'};
    if (c.status === 'completed') return {case_id:c.case_id, decision:'DONE'};
    if (c.blocker && c.blocker !== 'agent-stalled') return {case_id:c.case_id, decision:'HOLD', reason:c.blocker};
    const owner = active.get(c.agent_id);
    if (owner && now - owner.lastRunAt <= 7200000) return {case_id:c.case_id, decision:'KEEP', owner:c.agent_id};
    const receiver = [...active.values()].find(a => a.id !== c.agent_id && now - a.lastRunAt <= 7200000 && (a.claimedFiles ?? []).every(f => !(c.changed_files ?? []).includes(f)));
    if (!receiver) return {case_id:c.case_id, decision:'HOLD', reason:'no-verified-receiver'};
    return {case_id:c.case_id, decision:'HANDOFF_PROPOSED', from:c.agent_id ?? null, to:receiver.id, reason:'stalled-owner'};
  });
}
