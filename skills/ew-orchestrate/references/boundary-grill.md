# Boundary Grill — Embedded Mini-Review Protocol

## Conflict Types

| ID | Signal | Example |
|----|--------|---------|
| `RSC` | Decision outside command's scope guard | `ew-analyze` outputs task-level details (`ew-plan` scope) |
| `MOD` | Changes cross 2+ module boundaries | Task touches `commands/` and `hooks/` without declaring cross-module |
| `DEC` | Upstream locked decision contradicts code | Locked "use EventEmitter" but code uses `Subject` at `file:line` |

## Trigger

Run boundary grill when ANY of:
- **RSC**: produced decision matches another command's scope guard keywords
- **MOD**: module boundary Wiki entries or code boundaries exist AND changes touch 2+ top-level modules
- **DEC**: upstream Locked decisions AND code search show contradicting patterns

Priority when >3 conflicts: `DEC > RSC > MOD`.

## Protocol

Per conflict (max 3 conflicts × 3 questions = 9 total):
1. State the conflict with `file:line` evidence.
2. Ask 2-3 adversarial questions via a structured user prompt (e.g. `ask_question` in Antigravity, or the host's equivalent) — challenge with code reality.
3. Resolve: `RESOLVED` (evidence-based) / `DEFERRED` (needs escalation) / `ACCEPTED_RISK`.

**Auto mode (`-y`)**: skip questions, resolve via code evidence weighting:
- `RSC` → defer to target scope
- `MOD` → follow existing cross-module pattern (or flag as risk)
- `DEC` → code wins (current code = ground truth)

## Output

Record results as structured fields without corrupting JSON outputs:
- Add `boundary_grill: [{ id, type, conflict, resolution, evidence }]` inside `{run_dir}/outputs/findings.json` (`ew-analyze`) or `{run_dir}/outputs/plan.json` (`ew-plan`). **Never append raw Markdown text into `.json` files.**
- Also include the summary table inside `{run_dir}/report.md`:

```markdown
## Boundary Grill Results

| # | Type | Conflict | Resolution | Evidence |
|---|------|----------|------------|----------|
```

Resolved `DEC` amends Locked decisions; unresolved items are recorded with `status: "deferred"` and `boundary_grill: true`.

## Constraints

- Non-blocking — warnings + resolutions, never hard stops
- Evidence MUST include `file:line` — generic assertions invalid
- Results visible in command output — no silent swallowing
