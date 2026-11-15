---
name: task
description: Run one Lern task end to end (brief or plan, TDD, gates, one review, close), or split a milestone's boxes into session-sized tasks.
disable-model-invocation: true
argument-hint: "[M6.3 | M6 | empty for the next task]"
---

Target: $ARGUMENTS

- Empty: read `STATE.md` and take its next task. No next task named: the first open, unblocked box of the current milestone in `PLAN.md`.
- `M6.3`: run that task.
- `M6`: split that milestone (last section), not a task.

One task per session. Never read `PLAN.md` or `PLAN-notes.md` whole; grep for the box or heading, then read that line range.

This is the `delikit` workflow with Lern's routing and rules filled in: one writer per task, the main session checks the result and runs the gates, one fresh-context review.

## Pick the route first
You orchestrate and decide, and you keep your model for the whole task.

**High risk:** moves money, changes ride state, takes locks or does matching, or adds an auth or ownership rule. You write the code. **Low risk:** everything else, including endpoints that reuse an existing owner check. The writer below writes the code. A box's `(high)` or `(low)` tag decides; untagged, classify it. Trivial work (docs, config, a rename, one obvious line) you do yourself.

**Subagents are T3 `delegate_task` on OpenCode Go only.** Call `orchestrator_capabilities` once per session before the first dispatch. Never a Claude subagent (Agent tool), never an OpenCode free model, never a shell launcher.

| Role | `target` |
|---|---|
| Writer | provider `opencode`, model `opencode-go/deepseek-v4.1-flash`, options `variant: max` |
| Reviewer | provider `opencode`, model `opencode-go/glm-5.3-flash`, options `variant: max` |

Dispatch in the main checkout, no worktree (CLAUDE.md §1): one writer at a time, so nothing else edits files. Follow the delegate's `next` instead of polling it; a defect goes back to the same writer as a follow-up with the failing input.

**The Go plan has a weekly cap, and nothing takes over.** A delegate that fails on a usage or rate limit:
- Never write the writer's code or do the reviewer's review yourself, never switch model, provider or plan, never retry in this session.
- Stage nothing new. Write into `STATE.md` under "Next task": `Paused: Go limit`, the task id, what is finished, and the brief path to dispatch again.
- Stop with "Go limit reached. When it has reset: `/clear`, then `/task`".

Run tests and gates through `sh tools/brief.sh <command>`: no model needed, and on a failure read `.superpowers/last-run.log` instead of re-running.

## Briefs
A delegate sees no conversation, no graph and none of the private docs (`CLAUDE.md`, `PLAN.md`, `.claude/rules/`). Every brief stands alone, in this shape:
- **Goal**: the task text and the numbered `## Requirements`.
- **Context**: the files and line ranges to change, the test file, the exact values, and the §3 invariants and rules that apply, quoted.
- **Do**: TDD: write each test first and show it failing for the right reason, then the least code; run `sh tools/brief.sh sh -c 'pnpm lint && pnpm typecheck && pnpm test'` (plus `pnpm test:integration` when SQL, Redis or sockets are touched).
- **Don't**: edit files outside its list; touch `apps/mobile/app/routes/`, `apps/mobile/app/screens/Home/` or other untracked files; commit, stage or push; add a dependency.
- **Done when / report**: changed files, each check with its result, the red output of each new test, and anything it is unsure of. Distilled, `path:line`, no whole logs.

## Run a task
1. **Load.** `STATE.md`, the task's box, the sections it cites, and that area's `PLAN-notes.md` entry only. Find code through `graphify query` before reading source. An undecided question in `STATE.md` or `PLAN.md` §8 that this task depends on: ask, don't guess.
   - `STATE.md` says `Paused: Go limit`: dispatch the recorded brief again. Another limit error: say so and stop.
2. **Clean start.** `git status --short`. Another task's changes still staged: stop and ask the user to commit them, unless `STATE.md` says this task is being resumed. Untracked or modified files you didn't make belong to the user: never edit or stage them, so stage by explicit path, never `git add -A` or `git add .`.
3. **Size check.** More than one behaviour or invariant, or likely past about 400 production lines (tests don't count): stop and propose a split into new boxes. Never split a transaction, or a migration from the code that needs it. Every task must leave tests green and all invariants true.
4. **Restate in 5 bullets:** goal, files, §3 invariants touched and the test proving each, first failing test, out of scope. Add a numbered `## Requirements` list: the writer and reviewer work from it.
   - Low risk: write the brief (above) to `.superpowers/plans/<date>-<task>.md` and carry on.
   - High risk: add a short plan (at most one page: transaction boundaries, races, failure cases, what the migration does). Save it to the same path. Wait for the user's OK.
5. **Write the code.**
   - High risk: TDD per CLAUDE.md §1: see the failing test fail for the right reason, write the least code, refactor. Use the matching skill: `ride-transition`, `typeorm-migration`, `contract-change`, `socket-event`, `nest-module`, `concurrency-test` (any race). A guard or IDOR test that passes first time proves nothing until removing the guard makes it fail. After each green step, `git add` the paths you changed, so stopping loses nothing.
   - Low risk: `delegate_task` to the writer with the brief file's contents. When it reports, read the whole diff (`git diff`, new files included) against the requirements, not against its summary. For each new guard or branch, revert it by hand and see a test go red, then restore it. A defect or a missing red goes back to the same writer as a follow-up naming the file, the line and the failing case; never fix its code yourself. At most 2 follow-up rounds; after that, or if the task turns out to need money, ride-state, locking or auth changes, write it up in `STATE.md` as BLOCKED and stop; the user decides whether it becomes a high-risk task.
6. **Stay in budget.** Past about 50 tool calls, or when the user says context is past 15%: finish the current green step and stage it. If tests are red and the fix isn't quick, never stage or weaken them: leave that work unstaged and record the failing test and your best guess in `STATE.md`. Then write the remaining work into `PLAN.md` as new boxes and into `STATE.md` ("Resuming M6.3: ..."), and stop with "run `/clear`, then `/task`". Don't push on to finish.
7. **Gates, always run by you, never taken from a report.** Scoped tests while iterating. At the end: `sh tools/brief.sh sh -c 'pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration'`, plus Snyk if dependencies changed. Trust exit codes, and report the commands you ran and their result, not "tests pass" alone. A gate that fails on writer code goes back to the writer.
8. **Review.** Skip only for a one-file fix with an obvious test. Stage the task's files, `git diff --cached > .superpowers/plans/<date>-<task>.diff`, then a new `delegate_task` to the reviewer: the requirements, the §3 invariants and rules that apply (quoted), the diff path, and the lenses to cover: requirements met, edge cases, tests that would catch a regression, §3 invariants/races/transaction boundaries, and security (IDOR, missing auth guard, unbounded queries; for auth, OTP, sessions, ownership, sockets or money also the matching `security-audit` file). Correctness only, not style. Each finding with `path:line`, the failing input and the expected result.
   - Reproduce a finding before acting on it. A real one gets a regression test and a fix (your code: you fix it; writer code: the writer fixes it), a wrong one gets one line saying why. After a fix, review the full staged diff once more with a new `delegate_task`. At most 2 fix rounds; after that write it up in `STATE.md` as BLOCKED and stop. Never call a task done without review.
9. **Close, only after the gates and review pass.** Tick the box with at most two lines. Anything longer goes in `PLAN-notes.md` under the task; a gotcha future tasks need goes in the matching `.claude/rules/gotchas-*.md`. Rewrite `STATE.md` (under 40 lines): where things stand, next task and why, its risk tag, pending decisions. Run `graphify update .`. Stage the task's files. Never commit or push.
10. **Stop.** Give what changed, each worker's role and model, the commands and results, and a conventional commit message with no AI attribution. Name the next task: "Commit, then `/clear`, `/task`". Don't start the next task, even if it looks small.

Also stop when something needs the user: an undecided question with nothing else unblocked, a failed fix round, a change you'd want them to see first.

## Split a milestone
1. Check the previous milestone's open boxes and report any left. Read this milestone's boxes and only the sections they cite, plus the code they extend (graph first).
2. Rewrite each box as numbered tasks: `- [ ] **M6.3** (high) ...`, keeping every requirement from the original box. Apply the size rules in step 3 above. Put decisions the tasks depend on first, and mark blocked tasks "Blocked:" with what they wait for.
3. Update `STATE.md`, show the user the list and wait for their OK.
