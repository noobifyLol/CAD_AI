# TODO — FeatureScript Compiler-Agent Upgrade (zero-error static gate + strict schema)

## Step 1 — TODO.md scaffolding (done)
- [x] Create TODO.md with ordered implementation plan

## Step 2 — ai.js: implement strict compiler-agent contract + static zero-issue gate
- [ ] Add `validateFeatureScriptStrict(code)` that:
  - runs sanitizer
  - runs `validateFeatureScript()` and `hasFatalFeatureScriptPatterns()`
  - returns `{ strictPass, validationIssues, fatalIssues, appliedSanitizers, fatalBlockReason }`
- [ ] Enforce gating policy: final code is blocked if **fatalIssues > 0 OR validatorIssues > 0** (selection (2-A))
- [ ] Ensure generation/repair/simplification prompts embed `FS_COMPILER_AGENT_CONTRACT` as the canonical instruction
- [ ] Update orchestration metadata to include strict gate status + issue counts

## Step 3 — ai.js: strict candidate schema enforcement
- [ ] Ensure model candidates are parsed as JSON objects with required keys:
  - `featureName`, `featureLabel`, `reasoning`, `code`
- [ ] Reject/repair candidates that don’t conform, before compilation is considered

## Step 4 — learning.js: weak-data quarantine / syntax authority filtering
- [ ] Prevent unconfirmed seed/source and low-confidence rows from being treated as syntax authority
- [ ] Promote only confirmed/validated rows (existing memory types + successful generations) into syntax-supportive context
- [ ] Add `provenance`/warnings indicating which tiers were used/quarantined

## Step 5 — Testing infrastructure
- [ ] Create `scripts/test_featurescript_static_rules.js`
  - no network
  - loads pasted failure fixtures from a new fixtures file
  - runs sanitizer + strict gate
  - asserts gate blocks/accepts as expected
- [ ] Add fixture set:
  - spur gear typed-lambda + bad qSketchRegion
  - restaurant menu: execution in precondition
  - band-aid: missing/incorrect skeleton + function-scoping issues

## Step 6 — Run verification
- [ ] Run `node scripts/test_featurescript_static_rules.js`
- [ ] Run existing smoke tests (only if keys are available): `npm run smoke:generate`

## Step 7 — Docs
- [ ] Update `docs/current_architecture.md` and `docs/multi_key_orchestration.md`
  - document strict gate + weak-data quarantine + strict schema enforcement

