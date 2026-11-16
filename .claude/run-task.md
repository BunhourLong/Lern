# Task configuration

- Plan and next task: `STATE.md` "Next task"; else the first open, unblocked box of the current milestone in `PLAN.md` (grep the box, never read `PLAN.md` whole). A box tagged `(high)`/`(low)` sets its risk.
- Notes: `PLAN-notes.md`, only the entry for the area being changed.
- Gates: `sh tools/brief.sh sh -c 'pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration'`, plus `npx snyk@1.1307.4 test --all-projects --configuration-matching='^releaseRuntimeClasspath$'` when dependencies change. On a failure read `.superpowers/last-run.log`, don't re-run.
- Focused test: `pnpm --filter <pkg> test -- <path>`; one integration suite: `pnpm --filter @lern/api exec jest --selectProjects integration -- test/<name>`.
- Constraints: `CLAUDE.md` §1 (TDD, ponytail), §3 invariants, §4, §5 and `.claude/rules/`. Workers can't read these private files or the graph: each brief quotes the rules that apply and names the files, line ranges and exact values. Never touch the user's untracked or modified files; stage by explicit path. One task per session.
- Start: another task's changes still staged → ask the user what to do with them first. An undecided question in `STATE.md` or `PLAN.md` §8 the task depends on → ask.
- Size: more than one behaviour or invariant, or past ~400 production lines → propose a split into new `PLAN.md` boxes. Never split a transaction, or a migration from the code that needs it.
- High risk: money, ride state, locking/matching, or a new auth/ownership rule. Low and medium tasks run straight through; a high-risk task runs in two halves:
  1. **Think, no code.** Read the code the task touches until the cause or design is confirmed at `path:line`; settle what the box leaves open with a recommendation; find the races, transaction boundaries, failure cases and migration, and any trap in the obvious approach (a test gate that can't hold, a lock-order break). Save a one-page plan at `.superpowers/plans/<date>-<task>.md`, then end the turn with a `/goal` prompt for the user. The user sending it back is the plan's approval.
  2. **The prompt** carries what the thinking added, never the `PLAN.md` box reworded: the confirmed mechanism, the decision and why, the red test's exact shape (gate, assertions, the failure it must show first), the smallest fix and what must not change, mutation checks, traps. Under ~30 lines, standalone after `/clear`, starts with `delikit run-task <id>`, and is saved as the plan's last section. Its done condition is this file's Close, OR a stop this file requires recorded in `STATE.md` (Paused, BLOCKED, Resuming, a failing gate with no known cause); never rerun, skip or weaken a test to reach done.
  3. Under that `/goal`, the main session writes it with TDD and the matching project skill (`ride-transition`, `typeorm-migration`, `contract-change`, `socket-event`, `nest-module`, `concurrency-test`).

  Everything else goes to the writer, brief saved at the same path.
- Checking writer code: read the whole diff against the requirements; for each new guard or branch, revert it by hand and see a test go red, then restore it. Defects go back to the same writer; never fix its code yourself. At most 2 rounds, then `BLOCKED` in `STATE.md`.
- Review: every task except a one-file fix with an obvious test. One fresh-context reviewer (see Worker routing: high-risk tasks go to Sol) on the full staged diff (`git diff --cached > .superpowers/plans/<date>-<task>.diff`), correctness only: requirements, edge cases, tests that catch regressions, §3 invariants/races/transaction boundaries, security (IDOR, missing auth guard, unbounded queries; for auth, OTP, sessions, ownership, sockets or money also the matching `security-audit` file). Each finding with `path:line` and the failing input. At most 2 fix rounds.
- Limit: a worker that fails on a Go usage limit → stage nothing new, record `Paused: Go limit`, the task id, what is finished and the brief path in `STATE.md`, and stop. Never take over its work or switch model, provider or plan. A new session dispatches the brief again.
- Budget: past ~50 tool calls, finish the current green step and stage it; record the rest as `PLAN.md` boxes and "Resuming <id>: ..." in `STATE.md`, then stop.
- Git: stage by explicit path, then commit the task with a conventional message and no AI attribution; never push.
- Close: tick the `PLAN.md` box (at most 2 lines; longer goes in `PLAN-notes.md`, gotchas in `.claude/rules/gotchas-*.md`), rewrite `STATE.md` (under 40 lines, names the next task and its risk), run `graphify update .`; commit; stop after one task with "`/clear`, then `delikit run-task`".

## Worker routing

| Job | Provider and model | Options |
| --- | --- | --- |
| Implementation, tests, fixes | `opencode` / `opencode-go/deepseek-v4.1-flash` | `variant: max` |
| Review of writer tasks | `opencode` / `opencode-go/glm-5.3-flash` | `variant: max` |
| Review of high-risk tasks (main session wrote them) | `codex` / `gpt-6.1-sol` | `reasoningEffort: high` |
| Read-only search the graph can't answer (sweep many files, find a file); optional, returns `path:line` | `codex` / `gpt-6-luna` | `reasoningEffort: low` |

Through T3 `delegate_task`, in the main checkout (one writer at a time). Codex runs on the user's ChatGPT Plus plan (decided 2026-11-16): only the two jobs above, always with the effort set (T3 defaults Sol to `low`), never `gpt-6-astra`, never as a writer or a second reviewer. Still one reviewer per task. A Codex limit on a high-risk review pauses the task like a Go limit; a Luna limit means the main session searches itself. No Claude subagents, no OpenCode free models, no launcher scripts.
