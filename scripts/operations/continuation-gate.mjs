// Pure fail-closed planner. It neither verifies runtime identity nor executes agent handoff.
// The caller MUST validate authenticated execution receipts and the canonical live CLAIM index.
export function planContinuation({ cases, agents, now }) {
  if (!Array.isArray(cases) || !Array.isArray(agents) || !Number.isFinite(now)) throw Error('invalid-input');
  const validFiles = value => Array.isArray(value) && value.every(f => typeof f === 'string' && f.length > 0 && f.trim() === f && !f.includes('\0'));
  // Legacy bare paths conservatively reserve the name across repositories.
  // New repo-qualified claims avoid false collisions between separate repos.
  const validClaimedFiles = value => Array.isArray(value) && value.every(f =>
    typeof f === 'string' ? validFiles([f]) :
    f && typeof f === 'object' && !Array.isArray(f) &&
    typeof f.repo === 'string' && f.repo.trim() === f.repo && f.repo.length > 0 &&
    validFiles([f.path]));
  const conflictsWith = (claim, repo, file) => typeof claim === 'string'
    ? claim === file : claim.repo === repo && claim.path === file;
  const counts = new Map();
  for (const a of agents) if (typeof a?.id === 'string' && a.id) counts.set(a.id, (counts.get(a.id) || 0) + 1);
  const duplicates = new Set([...counts].filter(([, count]) => count > 1).map(([id]) => id));
  const fresh = agents.filter(a => typeof a?.id === 'string' && a.id && a.authenticated === true && a.connected === true && Number.isFinite(a.lastRunAt) && a.lastRunAt <= now && now - a.lastRunAt <= 7200000);
  const unique = fresh.filter(a => !duplicates.has(a.id));
  // Reserve all verified live owners first, regardless of case ordering.
  const activeByPath = new Map();
  for (const [index, entry] of cases.entries()) {
    if (!entry || typeof entry.repo !== 'string' || !entry.repo || !validFiles(entry.changed_files)) continue;
    if (!unique.some(agent => agent.id === entry.agent_id)) continue;
    for (const file of entry.changed_files) {
      const key = entry.repo + '\0' + file;
      const owners = activeByPath.get(key) || new Set();
      owners.add(index);
      activeByPath.set(key, owners);
    }
  }
  const reserved = new Set();
  return cases.map(c => {
    const caseId = c?.case_id ?? null;
    if (!c || typeof c.case_id !== 'string' || !c.case_id || typeof c.repo !== 'string' || !c.repo || typeof c.next_action !== 'string' || !c.next_action) return {case_id:caseId,decision:'HOLD',reason:'incomplete-checkpoint'};
    if (c.status === 'completed' || c.status === 'done') return {case_id:caseId,decision:'HOLD',reason:'completion-evidence-unverified'};
    if (c.blocker && c.blocker !== 'agent-stalled') return {case_id:caseId,decision:'HOLD',reason:c.blocker};
    if (!validFiles(c.changed_files)) return {case_id:caseId,decision:'HOLD',reason:'ownership-unverified'};
    if (duplicates.has(c.agent_id)) return {case_id:caseId,decision:'HOLD',reason:'ambiguous-agent-identity'};
    const owner = unique.find(a => a.id === c.agent_id);
    const keys = c.changed_files.map(f => c.repo + '\0' + f);
    if (keys.some(key => (activeByPath.get(key)?.size || 0) > 1)) return {case_id:caseId,decision:'HOLD',reason:'ambiguous-active-owner'};
    if (owner) return {case_id:caseId,decision:'KEEP',owner:c.agent_id};
    if (keys.some(key => activeByPath.has(key))) return {case_id:caseId,decision:'HOLD',reason:'active-owner-conflict'};
    if (keys.some(key => reserved.has(key))) return {case_id:caseId,decision:'HOLD',reason:'overlapping-proposed-claim'};
    const alternatives = unique.filter(a => a.id !== c.agent_id);
    const eligible = alternatives.filter(a => validClaimedFiles(a.claimedFiles));
    const claimed = eligible.flatMap(a => a.claimedFiles);
    if (c.changed_files.some(f => claimed.some(claim => conflictsWith(claim,c.repo,f)))) return {case_id:caseId,decision:'HOLD',reason:'handoff-claim-collision'};
    const receiver = eligible.find(a => c.changed_files.every(f =>
      a.claimedFiles.every(claim => !conflictsWith(claim,c.repo,f))));
    if (!receiver) return {case_id:caseId,decision:'HOLD',reason:duplicates.size?'ambiguous-agent-identity':alternatives.length?'ownership-unverified':'no-verified-receiver'};
    keys.forEach(key => reserved.add(key));
    return {case_id:caseId,decision:'HANDOFF_PROPOSED',from:c.agent_id ?? null,to:receiver.id,reason:'stalled-owner'};
  });
}
