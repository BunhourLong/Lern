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

## Pick the route first
You orchestrate and decide, on Opus. On any other model: stop and say "run `/model opus`, then `/task`".

**High risk:** moves money, changes ride state, takes locks or does matching, or adds an auth or ownership rule. You write the code. **Low risk:** everything else, including endpoints that reuse an existing owner check. `lern-implementer` (Sonnet) writes the code. A box's `(high)` or `(low)` tag decides; untagged, classify it.

Run tests and gates through `sh tools/brief.sh <command>`: no model needed, and on a failure read `.superpowers/last-run.log` instead of re-running.

## Run a task
1. **Load.** `STATE.md`, the task's box, the sections it cites, and that area's `PLAN-notes.md` entry only. Find code through `graphify query` before reading source. An undecided question in `STATE.md` or `PLAN.md` §8 that this task depends on: ask, don't guess.
2. **Clean start.** `git status --short`. Another task's changes still staged: stop and ask the user to commit them, unless `STATE.md` says this task is being resumed. Untracked or modified files you didn't make belong to the user: never edit or stage them, so stage by explicit path, never `git add -A` or `git add .`.
3. **Size check.** More than one behaviour or invariant, or likely past about 400 production lines (tests don't count): stop and propose a split into new boxes. Never split a transaction, or a migration from the code that needs it. Every task must leave tests green and all invariants true.
4. **Restate in 5 bullets:** goal, files, §3 invariants touched and the test proving each, first failing test, out of scope.
   - Low risk: save them to `.superpowers/plans/<date>-<task>.md` and carry on.
   - High risk: add a short plan (at most one page: transaction boundaries, races, failure cases, what the migration does). Save it to the same path. Wait for the user's OK.
5. **Write the code.**
   - High risk: TDD per CLAUDE.md §1: see the failing test fail for the right reason, write the least code, refactor. Use the matching skill: `ride-transition`, `typeorm-migration`, `contract-change`, `socket-event`, `nest-module`, `concurrency-test` (any race). A guard or IDOR test that passes first time proves nothing until removing the guard makes it fail. After each green step, `git add` the paths you changed, so stopping loses nothing.
   - Low risk: dispatch `lern-implementer` with the brief path and a report path (`.superpowers/plans/<date>-<task>.report.md`), and wait. Read its reply and `git diff`, not its transcript. Check the tests can fail and prove the brief, then `git add` the paths. BLOCKED or NEEDS_CONTEXT: answer through `SendMessage`, or take over yourself if the task turned out harder than its tag. If it touched money, ride state, locks or auth, treat the task as high risk from here.
6. **Stay in budget.** Past about 50 tool calls, or when the user says context is past 15%: finish the current green step and stage it. If tests are red and the fix isn't quick, never stage or weaken them: leave that work unstaged and record the failing test and your best guess in `STATE.md`. Then write the remaining work into `PLAN.md` as new boxes and into `STATE.md` ("Resuming M6.3: ..."), and stop with "run `/clear`, then `/task`". Don't push on to finish.
7. **Gates, always run by you, never taken from a report.** Scoped tests while iterating. At the end: `sh tools/brief.sh sh -c 'pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration'`, plus Snyk if dependencies changed. Trust exit codes, and report the commands you ran and their result, not "tests pass" alone.
8. **Review.** Skip only for a one-file fix with an obvious test. Otherwise: `git diff --cached > .superpowers/plans/<date>-<task>.diff`, then dispatch `lern-reviewer` with the box text, your 5 bullets or plan, the gate results and the diff path. Ask for correctness and requirements only, not style. Judge each finding yourself: a real one gets a regression test and a fix (low risk: resume the same `lern-implementer` through `SendMessage` with the finding, don't start a new one), a wrong one gets one line saying why. Re-review only the fix diff. At most 2 fix rounds; after that, or if the reviewer can't run, write it up in `STATE.md` as BLOCKED and stop. Never call a task done without review.
9. **Close, only after the gates and review pass.** Tick the box with at most two lines. Anything longer goes in `PLAN-notes.md` under the task; a gotcha future tasks need goes in the matching `.claude/rules/gotchas-*.md`. Rewrite `STATE.md` (under 40 lines): where things stand, next task and why, its risk tag, pending decisions. Run `graphify update .`. Stage the task's files. Never commit or push.
10. **Stop.** Give what changed, the commands and results, and a conventional commit message with no AI attribution. Name the next task: "Commit, then `/clear`, `/task`". Don't start the next task, even if it looks small.

Also stop when something needs the user: an undecided question with nothing else unblocked, a failed fix round, a change you'd want them to see first.

## Split a milestone
1. Check the previous milestone's open boxes and report any left. Read this milestone's boxes and only the sections they cite, plus the code they extend (graph first).
2. Rewrite each box as numbered tasks: `- [ ] **M6.3** (high) ...`, keeping every requirement from the original box. Apply the size rules in step 3 above. Put decisions the tasks depend on first, and mark blocked tasks "Blocked:" with what they wait for.
3. Update `STATE.md`, show the user the list and wait for their OK.
