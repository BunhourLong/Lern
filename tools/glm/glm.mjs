#!/usr/bin/env node
// Optional OpenCode Go model work in a sandboxed worktree. The default workflow doesn't need it: the Go plan has
// a weekly cap, a run ends with Status: LIMIT when it is hit, and /task carries on without it.
// Full loop: implement, gates, review, verify, fix. --patch: review an existing diff and report only; its
// exit 0 means the review ran, not that it passed, so read the summary.
// Usage: node tools/glm/glm.mjs --task M5.11 --brief <file> [--rounds 3] [--parallel 4] [--resume] [--patch <diff>]
// --resume keeps the existing worktree and starts again from the gates, without implementing.
import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { applyMutation, buildEvidence, changedHunks, completionStatus, mutationResult, renderEvidence, requirementIds, validMutation } from './evidence.mjs';
import { diffProblems, isUsageLimit, lineSplitter, parseJsonReply, quoteIsReal, resolveInside, sandboxProfile } from './findings.mjs';

// The paid OpenCode Go plan only: its weekly cap ends a run with Status: LIMIT, and every other provider is
// disabled, so a run can never bill pay-per-token Zen with the same key. Long implementer sessions are mostly
// cache reads, which DeepSeek prices at a tenth of GLM; a second model for review catches what the first missed.
const IMPL_MODEL = 'opencode-go/deepseek-v4.1-flash#max';
const REVIEW_MODEL = 'opencode-go/glm-5.3-flash#max';
const PROVIDER = 'opencode-go';
const CONTEXT_LIMIT = 1_000_000;
// Past this a session gets compacted, and a summary is where a weak model starts inventing things.
const FRESH_SESSION_AT = 120_000;
const IDLE_KILL_MS = 20 * 60_000;
const RETRY_WAITS_MS = [30_000, 120_000];
const GATES = 'pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration';
const LENSES = {
  spec: 'Spec compliance: every requirement in the brief is met, nothing is misunderstood, and every changed line traces to the brief (unrelated edits are findings).',
  invariants: 'The CLAUDE.md §3 invariants the change touches, race conditions, transaction boundaries, and timers or ordering that depend on luck.',
  tests: 'Do the tests prove the behaviour? For each new test, name the production line that would make it fail if removed. A test that would still pass, asserts on its own setup, depends on timing, or only tests a mock is a finding.',
  security: 'Crossed trust boundaries: missing auth or ownership checks (IDOR), unvalidated input, unbounded queries, and error handling at boundaries.',
  edges: 'Failure paths: null and empty values, reconnects, retries, partial failure, resource leaks, and callers the change broke.',
};

const { values: args } = parseArgs({
  options: {
    task: { type: 'string' },
    brief: { type: 'string' },
    rounds: { type: 'string', default: '3' },
    parallel: { type: 'string', default: '4' },
    resume: { type: 'boolean', default: false },
    patch: { type: 'string' },
  },
});
if (!args.task || !args.brief) {
  console.error('usage: glm.mjs --task <id> --brief <file> [--rounds n] [--parallel n] [--resume] [--patch <diff>]');
  process.exit(2);
}
// --patch replaces its own previous run, so it must never share a name with a full run's work.
if (Boolean(args.patch) !== args.task.endsWith('-review')) {
  console.error('a task id ending in -review goes with --patch, and only then');
  process.exit(2);
}

const here = dirname(fileURLToPath(import.meta.url));
const repo = realpathSync(execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: here, encoding: 'utf8' }).trim());
const home = homedir();
// opencode v2 keeps keys in its DB; the agent's isolated XDG_DATA_HOME can't see it, so the key goes in by env.
const goEnv = (() => {
  const dbFile = join(process.env.XDG_DATA_HOME ?? join(home, '.local/share'), 'opencode/opencode.db');
  let row;
  try {
    row = new DatabaseSync(dbFile, { readOnly: true }).prepare('SELECT value FROM credential WHERE integration_id = ?').get(PROVIDER);
  } catch (error) {
    row = null;
    console.error(`${dbFile}: ${error.message}`);
  }
  const key = row && JSON.parse(row.value).key;
  if (!key) {
    console.error(`no ${PROVIDER} key in ${dbFile}: run \`opencode auth login\` and pick OpenCode Go`);
    process.exit(2);
  }
  // Zen reads the same OPENCODE_API_KEY and bills per token, so only Go stays enabled, title generation included.
  const config = { enabled_providers: [PROVIDER], small_model: REVIEW_MODEL.split('#')[0] };
  return { OPENCODE_API_KEY: key, OPENCODE_CONFIG_CONTENT: JSON.stringify(config) };
})();
const brief = readFileSync(resolve(args.brief), 'utf8');
const worktree = join(repo, '.worktrees', `glm-${args.task}`);
const runDir = join(repo, '.superpowers/glm', args.task);
const prompt = (name) => readFileSync(join(here, 'prompts', `${name}.md`), 'utf8');
const git = (...a) => execFileSync('git', a, { cwd: worktree, encoding: 'utf8', maxBuffer: 1 << 28 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
const peaks = {};
let inputTokens = 0;

class UsageLimit extends Error {}

// A silent opencode never exits by itself, so one left behind would hang forever.
const children = new Set();
// The whole group: pnpm, jest and the docker CLI outlive a signal sent only to their parent.
const killTree = (child) => {
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    // already gone
  }
};
process.on('exit', () => children.forEach(killTree));
process.on('SIGTERM', () => process.exit(143));
process.on('SIGINT', () => process.exit(130));

// Only what tools need: no tokens from the user's shell reach the model or the code it writes.
function agentEnv(agentHome) {
  const keep = ['PATH', 'HOME', 'USER', 'LANG', 'TERM', 'SHELL', 'TMPDIR', 'PNPM_HOME', 'DOCKER_HOST', 'NVM_DIR'];
  const env = Object.fromEntries(keep.filter((k) => process.env[k]).map((k) => [k, process.env[k]]));
  for (const k of Object.keys(process.env)) if (k.startsWith('TESTCONTAINERS_')) env[k] = process.env[k];
  for (const d of ['DATA', 'STATE', 'CACHE', 'CONFIG']) env[`XDG_${d}_HOME`] = join(agentHome, d.toLowerCase());
  // The sandbox blocks ~/.docker/config.json, and testcontainers fails when it can't read its config.
  // Jest would start a watchman daemon per agent, with a socket path past the OS limit under this XDG_STATE_HOME.
  // This stand-in fails its version check, so jest uses its own file crawler instead.
  const bin = join(runDir, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'watchman'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  env.PATH = `${bin}:${env.PATH}`;
  return { ...env, DOCKER_CONFIG: join(agentHome, 'docker'), GIT_CONFIG_GLOBAL: '/dev/null', OPENCODE_DISABLE_AUTOUPDATE: '1' };
}

function sandboxed(cmd, cmdArgs, { label, readOnly, stdoutFile, onLine, env = {} }) {
  const agentHome = join(runDir, 'agents', label);
  mkdirSync(agentHome, { recursive: true });
  const profile = sandboxProfile({ home, repo, worktree, runDir, agentHome, readOnly });
  return new Promise((done) => {
    const child = spawn('/usr/bin/sandbox-exec', ['-p', profile, cmd, ...cmdArgs], {
      cwd: worktree,
      env: { ...agentEnv(agentHome), ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    children.add(child);
    let output = '';
    let idle;
    const touch = () => {
      clearTimeout(idle);
      idle = setTimeout(() => killTree(child), IDLE_KILL_MS);
    };
    touch();
    const read = (stream) => {
      const lines = lineSplitter((line) => onLine?.(line, child));
      stream.setEncoding('utf8');
      stream.on('data', (text) => {
        touch();
        output += text;
        lines.push(text);
      });
      return lines;
    };
    const streams = [read(child.stdout), read(child.stderr)];
    child.on('close', (code) => {
      streams.forEach((s) => s.flush());
      children.delete(child);
      clearTimeout(idle);
      appendFileSync(stdoutFile, output);
      done({ code, output });
    });
  });
}

// One model turn. Throws when the model never answered, so no caller can mistake silence for approval.
async function ask(label, message, { readOnly, session } = {}) {
  // Only the implementer writes; every read-only turn (review, verify, mutate, evidence) is the second model.
  const model = readOnly ? REVIEW_MODEL : IMPL_MODEL;
  for (let attempt = 0; ; attempt += 1) {
    const result = { text: '', session, error: null, peak: 0 };
    // --standalone keeps the server inside the sandbox; without it opencode hands the work to a background service.
    const cli = ['run', '--standalone', '--auto', '--print-logs', '--log-level', 'error', '-m', model, '--format', 'json'];
    if (result.session) cli.push('-s', result.session);
    const { code } = await sandboxed('opencode', [...cli, message], {
      label,
      readOnly,
      env: goEnv,
      stdoutFile: join(runDir, `${label}.${attempt}.jsonl`),
      onLine(line, child) {
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          return;
        }
        if (isUsageLimit(event)) {
          result.limit = true;
          killTree(child);
          return;
        }
        result.session = event.sessionID ?? result.session;
        if (event.type === 'error') result.error = JSON.stringify(event.error ?? event).slice(0, 500);
        if (event.type === 'text') result.text = event.part.text;
        if (event.type === 'step_finish') {
          const t = event.part.tokens ?? {};
          const input = (t.input ?? 0) + (t.cache?.read ?? 0);
          result.peak = Math.max(result.peak, input);
          inputTokens += input;
        }
      },
    });
    peaks[label] = Math.max(peaks[label] ?? 0, result.peak);
    // Retrying can't help, and waiting only hides it: the cap doesn't clear within a run.
    if (result.limit) throw new UsageLimit(`${model}: OpenCode Go weekly usage limit reached during ${label}`);
    if (code === 0 && !result.error && result.text.trim()) return result;
    if (attempt >= RETRY_WAITS_MS.length) {
      throw new Error(`${label}: no answer from ${model} (exit ${code}): ${result.error ?? 'empty reply'}`);
    }
    log(`${label}: attempt ${attempt + 1} failed (${result.error ?? `exit ${code}`}), retrying`);
    await sleep(RETRY_WAITS_MS[attempt]);
    session = result.session;
  }
}

async function pool(items, limit, fn) {
  const results = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i]);
      }
    }),
  );
  return results;
}

// Throws outside the worktree: a model-supplied path must not reach the real .env through this script.
function readInside(file) {
  const path = resolveInside(worktree, file);
  if (!path) throw new Error(`not inside the worktree: ${file}`);
  return readFileSync(path, 'utf8');
}

function setupWorktree(base) {
  if (existsSync(worktree) || existsSync(runDir)) {
    throw new Error(`${worktree} or ${runDir} exists: inspect it, then remove both to start over`);
  }
  mkdirSync(runDir, { recursive: true });
  execFileSync('git', ['worktree', 'add', '--detach', worktree, base], { cwd: repo, stdio: 'ignore' });
  // Rules are private and untracked, so a fresh worktree lacks them. .env.example, never the real .env.
  copyFileSync(join(repo, 'CLAUDE.md'), join(worktree, 'CLAUDE.md'));
  cpSync(join(repo, '.claude/rules'), join(worktree, '.claude/rules'), { recursive: true });
  copyFileSync(join(repo, 'apps/api/.env.example'), join(worktree, 'apps/api/.env'));
  // git add -A collects the patch, and these only stay out of it through local ignore rules. The repo is public.
  for (const path of ['CLAUDE.md', '.claude/rules/file-organization.md', 'apps/api/.env']) {
    try {
      git('check-ignore', '-q', path);
    } catch {
      throw new Error(`${path} is not git-ignored, so it would end up in the patch`);
    }
  }
  execFileSync('pnpm', ['install', '--frozen-lockfile'], { cwd: worktree, stdio: 'ignore' });
}

function collectPatch(base, round) {
  git('add', '-A');
  const patch = git('diff', '--cached', '--binary', base);
  const path = join(runDir, `patch.${round}.diff`);
  writeFileSync(path, patch);
  return { patch, path };
}

async function runGates(round) {
  log(`gates: ${GATES}`);
  const logFile = join(runDir, `gates.${round}.log`);
  const { code, output } = await sandboxed('sh', ['-c', GATES], { label: `gates-${round}`, stdoutFile: logFile });
  return { ok: code === 0, tail: output.split('\n').slice(-100).join('\n'), logFile };
}

async function review(round, patchPath) {
  const reviews = await pool(Object.entries(LENSES), Number(args.parallel), async ([lens, focus]) => {
    const message = `${prompt('reviewer')}\nYour lens, and only this lens: ${focus}\n\nThe diff is at ${patchPath}.\n\n# Brief\n${brief}`;
    for (let i = 0; i < 2; i += 1) {
      const { text } = await ask(`review-${round}-${lens}${i ? '-retry' : ''}`, message, { readOnly: true });
      const parsed = parseJsonReply(text);
      if (Array.isArray(parsed?.findings)) return parsed.findings.map((f) => ({ ...f, lens }));
    }
    throw new Error(`reviewer ${lens} never returned valid JSON`);
  });
  const raw = reviews.flat();
  const real = raw.filter((f) => quoteIsReal(f, readInside));
  const minor = real.filter((f) => f.severity === 'Minor');
  const serious = real.filter((f) => f.severity !== 'Minor');
  const judged = await pool(serious, Number(args.parallel), async (finding) => {
    const n = serious.indexOf(finding);
    const { text } = await ask(
      `verify-${round}-${n}`,
      `${prompt('verifier')}\n# Finding\n${JSON.stringify(finding, null, 2)}\n\n# Brief\n${brief}`,
      { readOnly: true },
    );
    // A verifier that can't answer keeps the finding: an unverified bug beats a silently dropped one.
    return { finding, verdict: parseJsonReply(text) ?? { verdict: 'CONFIRMED', evidence: 'verifier unparseable' } };
  });
  const confirmed = judged.filter((j) => j.verdict.verdict !== 'REFUTED');
  const stats = {
    round,
    raw: raw.length,
    fakeQuote: raw.length - real.length,
    minor: minor.length,
    refuted: judged.length - confirmed.length,
    confirmed: confirmed.length,
  };
  writeFileSync(join(runDir, `review.${round}.json`), JSON.stringify({ stats, raw, judged }, null, 2));
  log(`review ${round}: ${JSON.stringify(stats)}`);
  return { confirmed: confirmed.map((j) => j.finding), stats, minor, dropped: raw.filter((f) => !real.includes(f)) };
}

// A model turn that must return JSON with an array under key. Null when it never does: callers fail safe.
async function askList(label, message, key) {
  for (let i = 0; i < 2; i += 1) {
    const { text } = await ask(`${label}${i ? '-retry' : ''}`, message, { readOnly: true });
    const list = parseJsonReply(text)?.[key];
    if (Array.isArray(list)) return list;
  }
  return null;
}

// The model only proposes: this script applies each edit, runs the test, and always restores the file.
async function mutationChecks(round, patchPath) {
  const proposed = await askList(`mutate-${round}`, `${prompt('mutator')}\nThe diff is at ${patchPath}.\n\n# Brief\n${brief}`, 'mutations');
  const baseline = new Map();
  const results = [];
  let n = 0;
  const runTest = async (test) => (await sandboxed('sh', ['-c', test], { label: `mutation-${round}`, stdoutFile: join(runDir, `mutation.${round}.${n++}.log`) })).code;
  for (const m of proposed ?? []) {
    const path = validMutation(m) ? resolveInside(worktree, m.file) : null;
    const original = path && readFileSync(path, 'utf8');
    const mutated = path && applyMutation(original, m);
    if (!mutated) {
      results.push({ ...m, result: 'INVALID' });
      continue;
    }
    if (!baseline.has(m.test)) baseline.set(m.test, await runTest(m.test));
    if (baseline.get(m.test) !== 0) {
      results.push({ ...m, result: 'INVALID' });
      continue;
    }
    // shortcut: killing this process mid-test skips the finally and leaves the mutation in the worktree; on a killed run, discard the worktree instead of using --resume
    writeFileSync(path, mutated);
    try {
      results.push({ ...m, result: mutationResult(await runTest(m.test)) });
    } finally {
      writeFileSync(path, original);
    }
  }
  writeFileSync(join(runDir, `mutations.${round}.json`), JSON.stringify(results, null, 2));
  log(`mutations ${round}: ${results.map((r) => r.result).join(' ') || 'none'}`);
  return results;
}

const survivors = (mutations) =>
  mutations
    .filter((m) => m.result === 'SURVIVED')
    .map((m) => ({ severity: 'Important', file: m.file, line: m.line, what: `no test fails when this is broken: ${m.quote} -> ${m.replacement} (${m.guards})`, fix: `Make ${m.test} fail on that mutation.`, lens: 'mutation' }));

// Second opinion on a diff someone else wrote: no gates and no fixes, because the caller owns both.
async function reviewPatch(state) {
  removeWorktree();
  rmSync(runDir, { recursive: true, force: true });
  setupWorktree(state.base);
  execFileSync('git', ['apply', '--index', resolve(args.patch)], { cwd: worktree });
  const { patch, path } = collectPatch(state.base, 0);
  state.patchPath = path;
  state.files = git('diff', '--cached', '--stat', state.base);
  const { confirmed, stats, minor, dropped } = await review(0, path);
  state.stats.push(stats);
  state.minor = minor;
  state.dropped = dropped;
  state.mutations = await mutationChecks(0, path);
  state.open = [...diffProblems(patch), ...confirmed, ...survivors(state.mutations)];
  state.status = 'REVIEWED';
  removeWorktree();
}

function removeWorktree() {
  if (existsSync(worktree)) execFileSync('git', ['worktree', 'remove', '--force', worktree], { cwd: repo, stdio: 'ignore' });
}

async function writeEvidence(state) {
  // Any failure here, the cap included, must not undo a finished run: no claims surfaces the whole change.
  let claims = null;
  try {
    claims = await askList('evidence', `${prompt('evidence')}\nThe diff is at ${state.patchPath}.\n\n# Brief\n${brief}`, 'claims');
  } catch (error) {
    log(`evidence: ${error.message}`);
  }
  const pack = buildEvidence({
    claims: claims ?? [],
    diff: readFileSync(state.patchPath, 'utf8'),
    requirements: requirementIds(brief),
    readFile: readInside,
  });
  state.evidence = join(runDir, 'evidence.md');
  writeFileSync(state.evidence, renderEvidence(pack, state.mutations));
}

function writeSummary(state) {
  const peak = Math.max(0, ...Object.values(peaks));
  const lines = [
    `Status: ${state.status}${state.reason ? ` (${state.reason})` : ''}`,
    `Task: ${args.task}  Base: ${state.base?.slice(0, 8)}  Models: impl ${IMPL_MODEL}, review ${REVIEW_MODEL}`,
    `Fix rounds used: ${state.fixes}  Review rounds: ${JSON.stringify(state.stats)}`,
    `Gates: ${state.gates ?? 'not run'}`,
    `Peak context: ${Math.round((peak / CONTEXT_LIMIT) * 100)}% of ${CONTEXT_LIMIT}  Input tokens used: ${inputTokens}`,
    '',
    state.files ? `Files:\n${state.files}` : 'Files: none',
    '',
    `Implementer's last reply (unverified):\n${(state.reply ?? '').slice(0, 1500)}`,
  ];
  if (state.mutations) {
    const count = (r) => state.mutations.filter((m) => m.result === r).length;
    lines.push('', `Mutations: ${count('KILLED')} killed, ${count('SURVIVED')} survived, ${count('INVALID')} invalid`);
  }
  if (state.open?.length) {
    lines.push('', 'Open findings:');
    for (const f of state.open) lines.push(`- ${f.severity} ${f.file}:${f.line ?? '?'} ${f.what} [${f.lens ?? 'script'}]`);
  }
  if (state.minor?.length) {
    lines.push('', 'Minor, not fixed:');
    for (const f of state.minor) lines.push(`- ${f.file}:${f.line} ${f.what}`);
  }
  if (state.dropped?.length) {
    lines.push('', 'Dropped because the quote did not match (may be real):');
    for (const f of state.dropped) lines.push(`- ${f.severity} ${f.file}:${f.line} ${f.what}`);
  }
  lines.push('', `Evidence: ${state.evidence ?? 'none'}`, `Patch: ${state.patchPath ?? 'none'}`, `Run dir: ${runDir}`, `Worktree: ${worktree}`);
  const text = `${lines.join('\n')}\n`;
  writeFileSync(join(runDir, 'summary.md'), text);
  console.log(`\n${text}`);
}

async function main() {
  // The worktree's own HEAD on resume: the main checkout may have moved on since the run started.
  const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: args.resume ? worktree : repo, encoding: 'utf8' }).trim();
  const state = { status: 'BLOCKED', base, fixes: 0, stats: [] };
  // git add -A must not run if setup failed: its ignore check is what keeps private files out of a patch.
  let setupDone = args.resume;
  try {
    if (args.patch) {
      await reviewPatch(state);
      writeSummary(state);
      process.exit(0);
    }
    let turn = null;
    if (!args.resume) {
      setupWorktree(base);
      setupDone = true;
      log(`worktree ready, implementing ${args.task}`);
      turn = await ask('impl', `${prompt('implementer')}\n# Brief\n${brief}`);
    }
    state.reply = turn?.text ?? '(resumed: no implementer turn)';
    let session = turn?.session;
    const maxFixes = Number(args.rounds);

    for (let round = 0; ; round += 1) {
      if (/^\s*Status:\s*BLOCKED/.test(state.reply)) {
        state.reason = 'implementer blocked';
        break;
      }
      const { patch, path } = collectPatch(base, round);
      state.patchPath = path;
      state.files = git('diff', '--cached', '--stat', base);
      if (!patch.trim()) {
        state.reason = 'implementer changed nothing';
        break;
      }

      const gates = await runGates(round);
      state.gates = `${gates.ok ? 'PASS' : 'FAIL'} (${gates.logFile})`;
      let feedback = null;
      if (gates.ok) {
        const scripted = diffProblems(patch);
        const { confirmed, stats, minor, dropped } = await review(round, path);
        state.stats.push(stats);
        state.minor = minor;
        state.dropped = dropped;
        state.open = [...scripted, ...confirmed];
        if (state.open.length === 0) {
          state.mutations = await mutationChecks(round, path);
          state.open = survivors(state.mutations);
          if (state.open.length === 0) {
            state.status = completionStatus(state.mutations, changedHunks(patch));
            break;
          }
        }
        feedback = `Reviewers confirmed these defects. Fix each with a regression test that fails first:\n${JSON.stringify(state.open, null, 2)}`;
      } else {
        feedback = `The gates failed (\`${GATES}\`). Find the cause and fix it; never skip or weaken a test. Output tail:\n${gates.tail}`;
      }

      if (state.fixes >= maxFixes) {
        state.reason = gates.ok ? 'findings left after the last fix round' : 'gates still failing after the last fix round';
        break;
      }
      state.fixes += 1;
      log(`fix round ${state.fixes} of ${maxFixes}`);
      const fresh = !session || (peaks.impl ?? 0) > FRESH_SESSION_AT;
      const message = fresh
        ? `${prompt('implementer')}\n# Brief\n${brief}\n\nThe work so far is already in the working tree (see \`git diff --cached\`).\n\n${feedback}`
        : `${feedback}\n\nEnd with the same reply format, starting with the Status line.`;
      if (fresh) peaks.impl = 0;
      turn = await ask('impl', message, { session: fresh ? undefined : session });
      session = turn.session;
      state.reply = turn.text;
    }
    // Never lets a problem here undo a finished run; with no pack, the summary says Evidence: none.
    if (state.status.startsWith('DONE')) await writeEvidence(state).catch((error) => log(`evidence: ${error.message}`));
  } catch (error) {
    state.reason = error.message;
    state.status = error instanceof UsageLimit ? 'LIMIT' : 'BLOCKED';
    // What the model wrote before it stopped is still worth having.
    try {
      if (setupDone && !args.patch) state.patchPath = collectPatch(base, 'partial').path;
    } catch (collectError) {
      log(`could not save partial work: ${collectError.message}`);
    }
  }
  writeSummary(state);
  if (args.patch) removeWorktree();
  process.exit(state.status === 'DONE' ? 0 : 1);
}

await main();
