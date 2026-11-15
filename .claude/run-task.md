# Task configuration

- Plan and next task: `STATE.md` "Next task"; else the first open, unblocked box of the current milestone in `PLAN.md` (grep the box, never read `PLAN.md` whole). A box tagged `(high)`/`(low)` sets its risk.
- Notes: `PLAN-notes.md`, only the entry for the area being changed.
- Gates: `sh tools/brief.sh sh -c 'pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration'`, plus `npx snyk@1.1307.4 test --all-projects --configuration-matching='^releaseRuntimeClasspath$'` when dependencies change. On a failure read `.superpowers/last-run.log`, don't re-run.
- Focused test: `pnpm --filter <pkg> test -- <path>`; one integration suite: `pnpm --filter @lern/api exec jest --selectProjects integration -- test/<name>`.
- Constraints: `CLAUDE.md` §1 (TDD, ponytail), §3 invariants, §4, §5 and `.claude/rules/`. Workers can't read these private files or the graph: each brief quotes the rules that apply and names the files, line ranges and exact values. Never touch the user's untracked or modified files; stage by explicit path. One task per session.
- Start: another task's changes still staged → ask the user to commit them first. An undecided question in `STATE.md` or `PLAN.md` §8 the task depends on → ask.
- Size: more than one behaviour or invariant, or past ~400 production lines → propose a split into new `PLAN.md` boxes. Never split a transaction, or a migration from the code that needs it.
- High risk: money, ride state, locking/matching, or a new auth/ownership rule. The main session writes it with TDD and the matching project skill (`ride-transition`, `typeorm-migration`, `contract-change`, `socket-event`, `nest-module`, `concurrency-test`), after the user approves a one-page plan (transaction boundaries, races, failure cases, migration) saved in `.superpowers/plans/<date>-<task>.md`. Everything else goes to the writer, brief saved at the same path.
- Checking writer code: read the whole diff against the requirements; for each new guard or branch, revert it by hand and see a test go red, then restore it. Defects go back to the same writer; never fix its code yourself. At most 2 rounds, then `BLOCKED` in `STATE.md`.
- Review: every task except a one-file fix with an obvious test. One fresh-context reviewer on the full staged diff (`git diff --cached > .superpowers/plans/<date>-<task>.diff`), correctness only: requirements, edge cases, tests that catch regressions, §3 invariants/races/transaction boundaries, security (IDOR, missing auth guard, unbounded queries; for auth, OTP, sessions, ownership, sockets or money also the matching `security-audit` file). Each finding with `path:line` and the failing input. At most 2 fix rounds.
- Limit: a worker that fails on a Go usage limit → stage nothing new, record `Paused: Go limit`, the task id, what is finished and the brief path in `STATE.md`, and stop. Never take over its work or switch model, provider or plan. A new session dispatches the brief again.
- Budget: past ~50 tool calls, finish the current green step and stage it; record the rest as `PLAN.md` boxes and "Resuming <id>: ..." in `STATE.md`, then stop.
- Git: stage by explicit path; never commit or push. Suggest a conventional commit message with no AI attribution.
- Close: tick the `PLAN.md` box (at most 2 lines; longer goes in `PLAN-notes.md`, gotchas in `.claude/rules/gotchas-*.md`), rewrite `STATE.md` (under 40 lines, names the next task and its risk), run `graphify update .`; stop after one task with "commit, then `/clear` and `delikit run-task`".

## Worker routing

| Job | Provider and model | Options |
| --- | --- | --- |
| Implementation, tests, fixes | `opencode` / `opencode-go/deepseek-v4.1-flash` | `variant: max` |
| Review | `opencode` / `opencode-go/glm-5.3-flash` | `variant: max` |

OpenCode Go only, through T3 `delegate_task`, in the main checkout (one writer at a time). No Claude subagents, no OpenCode free models, no launcher scripts.
