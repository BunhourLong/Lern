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
You orchestrate and decide, and you keep your model for the whole task.

**High risk:** moves money, changes ride state, takes locks or does matching, or adds an auth or ownership rule. You write the code. **Low risk:** everything else, including endpoints that reuse an existing owner check. The Go implementer writes the code. A box's `(high)` or `(low)` tag decides; untagged, classify it.

**Subagents are OpenCode Go only.** `node tools/glm/glm.mjs` runs them in a sandboxed worktree: DeepSeek V4.1 Flash implements, GLM-5.3-Flash reviews. Never dispatch a Claude subagent (Agent tool) for task work, and never an OpenCode free model. Run it in the background and read only its summary and `evidence.md`, never its logs.

**The Go plan has a weekly cap, and nothing takes over.** One implementer turn on M5.11 used 7.4M input tokens. On `Status: LIMIT`:
- Never write the implementer's code or do the reviewer's review yourself, never switch model or plan, never retry in this session.
- Stage nothing new. Write into `STATE.md` under "Next task": `Paused: Go limit`, the task id, what is finished, and the exact command that resumes it (below).
- Stop with "Go limit reached. When it has reset: `/clear`, then `/task`".

Resume commands: a full run continues with `node tools/glm/glm.mjs --task <id> --brief <file> --resume` (its worktree and run dir are kept); a `--patch` review is simply run again with the same command.

Run tests and gates through `sh tools/brief.sh <command>`: no model needed, and on a failure read `.superpowers/last-run.log` instead of re-running.

## Run a task
1. **Load.** `STATE.md`, the task's box, the sections it cites, and that area's `PLAN-notes.md` entry only. Find code through `graphify query` before reading source. An undecided question in `STATE.md` or `PLAN.md` §8 that this task depends on: ask, don't guess.
   - `STATE.md` says `Paused: Go limit`: run `node tools/glm/glm.mjs --check` before anything else. `Go plan: LIMIT`: say so and stop; there is nothing else to do on this task. `UNKNOWN`: report its message and stop. `OK`: run the resume command from `STATE.md` and carry on from that step.
2. **Clean start.** `git status --short`. Another task's changes still staged: stop and ask the user to commit them, unless `STATE.md` says this task is being resumed. Untracked or modified files you didn't make belong to the user: never edit or stage them, so stage by explicit path, never `git add -A` or `git add .`.
3. **Size check.** More than one behaviour or invariant, or likely past about 400 production lines (tests don't count): stop and propose a split into new boxes. Never split a transaction, or a migration from the code that needs it. Every task must leave tests green and all invariants true.
4. **Restate in 5 bullets:** goal, files, §3 invariants touched and the test proving each, first failing test, out of scope. Add a numbered `## Requirements` list: the Go reviewers and the evidence pack work from it.
   - Low risk: save them to `.superpowers/plans/<date>-<task>.md` and carry on. This file is the implementer's whole brief, and it has no graph: name the files and line ranges to change, the test file, and the exact values to use.
   - High risk: add a short plan (at most one page: transaction boundaries, races, failure cases, what the migration does). Save it to the same path. Wait for the user's OK.
5. **Write the code.**
   - High risk: TDD per CLAUDE.md §1: see the failing test fail for the right reason, write the least code, refactor. Use the matching skill: `ride-transition`, `typeorm-migration`, `contract-change`, `socket-event`, `nest-module`, `concurrency-test` (any race). A guard or IDOR test that passes first time proves nothing until removing the guard makes it fail. After each green step, `git add` the paths you changed, so stopping loses nothing.
   - Low risk: `node tools/glm/glm.mjs --task <id> --brief <file>`, in the background. It implements, runs the gates, reviews with five lenses, verifies the findings, runs mutation checks and fixes, then prints a summary:
     - `DONE`: read the summary and `evidence.md`. `DONE_UNMUTATED` is the same, except no test was shown to fail, so run the mutations yourself before accepting.
     - `BLOCKED`: read the reason. A question or an unclear brief: write the answer to a file and run `--resume --feedback <file>`. To start over instead, look at `.worktrees/glm-<id>` and `.superpowers/glm/<id>`, then remove both.
     - `LIMIT`: pause the task (above).
     - A defect you find in its diff or evidence goes back the same way: `--resume --feedback <file>`, naming the file, the line and the failing case. Never fix it yourself.
     - At most 2 feedback rounds. After that, or if the task turns out to need money, ride-state, locking or auth changes: write it up in `STATE.md` as BLOCKED and stop; the user decides whether it becomes a high-risk task.
     - Accepted: `git apply --index <patch from the summary>` in the main checkout, then step 7.
6. **Stay in budget.** Past about 50 tool calls, or when the user says context is past 15%: finish the current green step and stage it. If tests are red and the fix isn't quick, never stage or weaken them: leave that work unstaged and record the failing test and your best guess in `STATE.md`. Then write the remaining work into `PLAN.md` as new boxes and into `STATE.md` ("Resuming M6.3: ..."), and stop with "run `/clear`, then `/task`". Don't push on to finish.
7. **Gates, always run by you, never taken from a report.** Scoped tests while iterating. At the end: `sh tools/brief.sh sh -c 'pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration'`, plus Snyk if dependencies changed. Trust exit codes, and report the commands you ran and their result, not "tests pass" alone. A gate that fails on Go-written code goes back through `--resume --feedback`.
8. **Review.** Skip only for a one-file fix with an obvious test. Ask for correctness and requirements only, not style.
   - Low risk: the run in step 5 already reviewed the diff with a second model, so don't pay for it twice. Judge what its summary lists: open findings, minor ones, and those "dropped because the quote did not match" (they may be real).
   - High risk: `git diff --cached > .superpowers/plans/<date>-<task>.diff`, then `node tools/glm/glm.mjs --task <id>-review --brief <file> --patch <diff>`. `REVIEWED` means the review ran, not that it passed: read the summary. `LIMIT`: pause the task (above); it is not done.
   - Judge each finding yourself: a real one gets a regression test and a fix (your own code: you fix it; Go's code: `--resume --feedback`), a wrong one gets one line saying why. After fixing your own code, run the `--patch` review once more on the full staged diff. At most 2 fix rounds; after that write it up in `STATE.md` as BLOCKED and stop. Never call a task done without review.
9. **Close, only after the gates and review pass.** Tick the box with at most two lines. Anything longer goes in `PLAN-notes.md` under the task; a gotcha future tasks need goes in the matching `.claude/rules/gotchas-*.md`. Rewrite `STATE.md` (under 40 lines): where things stand, next task and why, its risk tag, pending decisions. Run `graphify update .`. Stage the task's files. Remove the task's Go worktree (`git worktree remove .worktrees/glm-<id>`). Never commit or push.
10. **Stop.** Give what changed, the commands and results, and a conventional commit message with no AI attribution. Name the next task: "Commit, then `/clear`, `/task`". Don't start the next task, even if it looks small.

Also stop when something needs the user: an undecided question with nothing else unblocked, a failed fix round, a change you'd want them to see first.

## Split a milestone
1. Check the previous milestone's open boxes and report any left. Read this milestone's boxes and only the sections they cite, plus the code they extend (graph first).
2. Rewrite each box as numbered tasks: `- [ ] **M6.3** (high) ...`, keeping every requirement from the original box. Apply the size rules in step 3 above. Put decisions the tasks depend on first, and mark blocked tasks "Blocked:" with what they wait for.
3. Update `STATE.md`, show the user the list and wait for their OK.
