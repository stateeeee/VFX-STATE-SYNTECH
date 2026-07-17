# 07 — SESSION PROTOCOL

How every Claude work session on this repo must run. The operator (the
founder, a director — not a programmer) drives sessions with short prompts
from `08-PROMPTS.md`; this protocol carries the rest.

## Session start (always, in order)

1. Read `CLAUDE.md` (auto-loaded) and `docs/workflow/STATE.md`.
2. Identify the current phase from STATE.md. Read that phase's section in
   `05-ROADMAP.md` plus the spec sections it references.
3. Post a short plan message: which phase, what will be built, how it will be
   verified. Then start — do not wait for approval unless something below
   requires asking.
4. If STATE.md is missing or contradicts the repo (e.g. phase marked done but
   code absent), STOP and reconcile: inspect the repo, correct STATE.md,
   report the discrepancy before building.

## During the session

- **Scope**: the current phase only. Bugs found outside scope → fix if
  trivial and risk-free, otherwise log under "Open items" in STATE.md.
- **Ask the operator** (AskUserQuestion) only for: product decisions the spec
  doesn't cover, anything that would alter the specs, destructive/irreversible
  actions, or accepting a parity deviation on a 1:1 port. Everything else:
  decide per the specs and record the decision in STATE.md.
- **Ground truth order**: 03/04 specs > current code > this protocol's
  defaults. The effect HTMLs always win on effect look/behavior.
- Respect the hard rules in CLAUDE.md (tokens, ModuleIds, no HTML rewrites,
  no surprise dependencies).
- Long ports (Phases 4–8) may take a whole session for one effect — that is
  expected. Never mark a port done without the parity run.

## Session end (always, in order)

1. Run verification per `06-VERIFICATION.md` (static gates + the phase's
   acceptance criteria + regression sweep).
2. Update `docs/workflow/STATE.md`:
   - flip the phase checkbox states,
   - append a log entry (date, what was done, how verified, deviations),
   - set **"Next step"** to a single concrete instruction the next session can
     execute blind.
3. Commit (clear message, scoped to the work) and push to the session branch.
   Retry pushes on network failure (2s/4s/8s/16s backoff).
4. Final reply to the operator: what changed, what was verified, what is next
   — in plain language (Italian is welcome for the operator), no jargon dumps.

## Branch & merge policy

- Claude Code sessions work on their own `claude/...` branch and push there.
- The operator merges to `main` between sessions (or asks the session to
  prepare a PR — only when explicitly asked).
- A new session must start from up-to-date `main` content; if the workflow
  docs are missing on the session branch, fetch/merge `origin/main` first.

## Failure honesty

If verification fails or a feature is half-done at session end: say so
plainly in both the reply and STATE.md ("Phase N: attempted, blocked by X").
Never mark unverified work as done — the next session depends on STATE.md
being true.
