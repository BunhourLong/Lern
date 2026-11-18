# Task configuration

- Plan and next task: `STATE.md` "Next task"; else the first open, unblocked box of the current milestone in `PLAN.md` (grep the box, never read `PLAN.md` whole). `run-task ui` instead takes the first open, unblocked box in `UI-PLAN.md` (read its §1–2 and that box; follow the `mobile-ui` skill once UI.0 made it; finish with its screenshot check). A box tagged `(high)`/`(medium)`/`(low)` sets its risk; untagged = medium.
- Notes: `PLAN-notes.md`, only the entry for the area being changed.
- Gates: `sh tools/brief.sh sh -c 'pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration'`, plus `npx snyk@1.1307.4 test --all-projects --configuration-matching='^releaseRuntimeClasspath$'` when dependencies change. On a failure read `.superpowers/last-run.log`, don't re-run.
- Focused test: `pnpm --filter <pkg> test -- <path>`; one integration suite: `pnpm --filter @lern/api exec jest --selectProjects integration -- test/<name>`.
- Constraints: `CLAUDE.md` §1 (TDD, ponytail), §3 invariants, §4, §5 and `.claude/rules/`. Workers can't read these private files or the graph: each brief quotes the rules that apply and names the files, line ranges and exact values. Never touch the user's untracked or modified files; stage by explicit path. One task per session.
- Start: another task's changes still staged → ask the user what to do with them first. An undecided question in `STATE.md` or `PLAN.md` §8 the task depends on → ask.
- Size: more than one behaviour or invariant, or past ~400 production lines → propose a split into new `PLAN.md` boxes. Never split a transaction, or a migration from the code that needs it.
- High risk: money, ride state, locking/matching, or a new auth/ownership rule. Low and medium tasks run straight through; a high-risk task runs in two halves:
  1. **Think, no code.** Read the code the task touches until the cause or design is confirmed at `path:line`; settle what the box leaves open with a recommendation; find the races, transaction boundaries, failure cases and migration, and any trap in the obvious approach (a test gate that can't hold, a lock-order break). Save a one-page plan at `.superpowers/plans/<date>-<task>.md`, then end the turn with a `/goal` prompt for the user. The user sending it back is the plan's approval.
  2. **The prompt** carries what the thinking added, never the `PLAN.md` box reworded: the confirmed mechanism, the decision and why, the red test's exact shape (gate, assertions, the failure it must show first), the smallest fix and what must not change, mutation checks, traps. Under ~30 lines, standalone after `/clear`, starts with `delikit run-task <id>`, and is saved as the plan's last section. Its done condition is this file's Close, OR a stop this file requires recorded in `STATE.md` (Paused, BLOCKED, Resuming, a failing gate with no known cause); never rerun, skip or weaken a test to reach done.
  3. Under that `/goal`, the main session writes it with TDD and the matching project skill (`ride-transition`, `typeorm-migration`, `contract-change`, `socket-event`, `nest-module`, `concurrency-test`), then the high-risk reviewer (Worker routing) reviews it.

  Everything else goes to the writer for its risk (Worker routing), brief saved at the same path.
- Checking writer code: read the whole diff against the requirements; for each new guard or branch, revert it by hand and see a test go red, then restore it. Defects go back to the same writer; never fix its code yourself. At most 2 rounds, then `BLOCKED` in `STATE.md`.
- Review: every task except a one-file fix with an obvious test. One fresh-context reviewer (see Worker routing: high-risk tasks go to GPT-6.2 Sol) on the full staged diff (`git diff --cached > .superpowers/plans/<date>-<task>.diff`), correctness only: requirements, edge cases, tests that catch regressions, §3 invariants/races/transaction boundaries, security (IDOR, missing auth guard, unbounded queries; for auth, OTP, sessions, ownership, sockets or money also the matching `security-audit` file). Each finding with `path:line` and the failing input. At most 2 fix rounds.
- Limit: a worker that fails on a Go or ChatGPT Plus usage limit → stage nothing new, record `Paused: <Go|Plus> limit`, the task id, what is finished and the brief path in `STATE.md`, and stop. Never take over its work or switch model, provider or plan. A new session dispatches the brief again.
- Budget: past ~50 tool calls, finish the current green step and stage it; record the rest as `PLAN.md` boxes and "Resuming <id>: ..." in `STATE.md`, then stop.
- Branch (user, 2026-11-18; never ask): one branch per `PLAN.md` milestone and per `UI-PLAN.md` §3 section, picked from the task id before any work. `PLAN.md`: M5 `m5-resilience`, M6 `m6-fares`, M7 `m7-admin`, M8 `m8-stretch`. `UI-PLAN.md`: Foundation `ui-foundation`, Shell and auth `ui-shell-auth`, Driver `ui-driver`, Rider `ui-rider`, After M6.10–M6.13 `ui-history`. A new section gets `ui-<slug of its heading>` / `m<N>-<slug>`, added here.
  1. On the right branch → keep going; if its PR has merged, `git fetch` then `git merge origin/main` (no rebase).
  2. The branch exists → `git switch` to it, `git cherry-pick` the `chore(workflow)` commits that `git cherry -v <it> <branch you left>` marks `+`, oldest first, then step 1.
  3. It doesn't → `git fetch`; cut it from `origin/main` if the previous section's PR has merged, else from that section's branch (stacked: record it in `STATE.md`, its PR targets that branch). Then `git cherry-pick` each `chore(workflow)` commit in `git log origin/main..<branch you left>`, oldest first, so `.claude/run-task.md` stays current.
- Git: stage by explicit path, then commit the task with a conventional message and no AI attribution; never push.
- Close: tick the `PLAN.md` box (at most 2 lines; longer goes in `PLAN-notes.md`, gotchas in `.claude/rules/gotchas-*.md`), rewrite `STATE.md` (under 40 lines, names the next task and its risk), run `graphify update .`; commit; stop after one task with "`/clear`, then `delikit run-task`".

## Temporary routing: Codex-only window (2026-11-18 until the Plus weekly reset, ~2026-11-20)

User decision 2026-11-18: spend the Plus weekly Codex limit (60% left) on quality and save OpenCode Go (25% of the month left). Nothing goes to OpenCode in this window. The table under Worker routing applies again after the reset, when the user says so, or on a Plus limit error (then pause per Limit until the reset).

| Job | Provider and model | Options |
| --- | --- | --- |
| High risk: plan critic, after the think half and before the `/goal` goes to the user | `codex` / `gpt-6-astra` | `reasoningEffort: high` |
| High risk: write | main session | |
| High risk: diff review | `codex` / `gpt-6.2-sol` | `reasoningEffort: high` |
| Medium and low: write | `codex` / `gpt-6.2-sol` | `reasoningEffort: high` |
| Medium and low: diff review | `codex` / `gpt-6.1-sol` | `reasoningEffort: high` |
| Read-only search | `codex` / `gpt-6-luna` | `reasoningEffort: low` |

- The plan critic reads the one-page plan and the `path:line`s it cites (a small input, so Astra's cost per message stays low; it leads the third-party SecureSWE and PatchBench numbers) and returns objections with `path:line`: a missed race, a wrong transaction boundary, a red test that can't fail, a simpler design. It never writes code and never reviews a diff (still one diff reviewer per task). The main session settles each objection in the plan before ending the turn.
- Writer and diff reviewer are always different models. GPT-6 Astra is the plan critic and nothing else; GPT-6.2 Astra is not used (user, 2026-11-18, final).
- **Revert** (at session start on or after 2026-11-20, or when the user says so; ask first if the window seems still wanted): delete this whole section; in `CLAUDE.md` §1 drop the "(except GPT-6 Astra and GPT-6.1 Sol in the Codex-only window …)" clause; in memory `subagents-opencode-go-only.md` drop the "Temporary, 2026-11-18" paragraph and in `MEMORY.md` the "Until ~2026-11-20" sentence; in `STATE.md` drop the "Codex-only window" sentence; commit `chore(workflow): end the Codex-only window`. The Worker routing table below is the old workflow and needs no edit.

## Worker routing

| Job | Provider and model | Options |
| --- | --- | --- |
| Implementation, tests, fixes of medium tasks | `codex` / `gpt-6.2-sol` | `reasoningEffort: high` |
| Implementation, tests, fixes of low tasks | `opencode` / `opencode-go/deepseek-v4.1-flash` | `variant: max` |
| Review of high-risk tasks (main session wrote them) | `codex` / `gpt-6.2-sol` | `reasoningEffort: high` |
| Review of medium and low tasks | `opencode` / `opencode-go/glm-5.3-flash` | `variant: max` |
| Read-only search the graph can't answer (sweep many files, find a file); optional, returns `path:line` | `codex` / `gpt-6-luna` | `reasoningEffort: low` |

Through T3 `delegate_task`, in the main checkout (one writer at a time). Decided 2026-11-18: GPT-6.2 Sol writes medium tasks; high-risk tasks keep the old flow (main session writes) with GPT-6.2 Sol reviewing. Codex runs on the user's ChatGPT Plus plan: only the jobs above, always with the effort set (T3 defaults to `low`), never `gpt-6-astra`, `gpt-6.2-astra` or `gpt-6.1-*`, never as a second reviewer. Still one reviewer per task. A Codex limit on a writer or a review pauses the task like a Go limit; a Luna limit means the main session searches itself. The main session writes high-risk code only; for every other task it plans, checks the diff and runs the gates and mutation checks. Gates run through `tools/brief.sh` with no model. No Claude subagents, no OpenCode free models, no launcher scripts.
