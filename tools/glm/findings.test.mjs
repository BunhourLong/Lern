import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { diffProblems, isUsageLimit, lineSplitter, parseJsonReply, quoteIsReal, resolveInside, sandboxProfile } from './findings.mjs';

test('parseJsonReply reads fenced JSON and rejects prose', () => {
  assert.deepEqual(parseJsonReply('Here:\n```json\n{"findings":[]}\n```'), { findings: [] });
  assert.equal(parseJsonReply('no findings, looks good'), null);
  assert.equal(parseJsonReply('{broken'), null);
});

test('quoteIsReal keeps a quote near its line and drops an invented one', () => {
  const read = () => 'a\nb\nconst x = 1;\nd';
  assert.equal(quoteIsReal({ file: 'f', line: 3, quote: 'const x = 1;' }, read), true);
  assert.equal(quoteIsReal({ file: 'f', line: 3, quote: 'const y = 2;' }, read), false);
  assert.equal(quoteIsReal({ file: 'f', line: 300, quote: 'const x = 1;' }, read), false);
  assert.equal(quoteIsReal({ file: 'f', line: 3 }, read), false);
  const missing = () => {
    throw new Error('ENOENT');
  };
  assert.equal(quoteIsReal({ file: 'nope', line: 1, quote: 'a' }, missing), false);
});

test('diffProblems flags added skip and only, not removed ones', () => {
  const diff = '+++ b/a.spec.ts\n+  it.skip("x", f);\n-  it.only("y", f);\n+  xit("z", f);\n+  it("ok", f);';
  const problems = diffProblems(diff);
  assert.equal(problems.length, 2);
  assert.equal(problems[0].file, 'a.spec.ts');
});

test('isUsageLimit spots the real Go limit event and nothing else', () => {
  const real = '{"type":"error","timestamp":1794024084398,"sessionID":"ses_e4bd4f250ffeJqzt9XITIjF5g9","error":{"type":"provider.go-limit","message":"OpenCode Go weekly usage limit reached. Switch to a free model, or turn on Extra Usage on the Go page in OpenCode Console to keep going.","status":429}}';
  assert.equal(isUsageLimit(JSON.parse(real)), true);
  // A rate limit clears within a run, so it gets the normal retry.
  assert.equal(isUsageLimit({ type: 'error', error: { type: 'provider.rate-limit', message: 'slow down' } }), false);
  // The model's own output can mention the phrase; only an error event counts.
  assert.equal(isUsageLimit({ type: 'text', part: { text: 'OpenCode Go weekly usage limit reached' } }), false);
});

test('lineSplitter keeps streams apart and flushes a last line with no newline', () => {
  const lines = [];
  const out = lineSplitter((l) => lines.push(l));
  const err = lineSplitter((l) => lines.push(l));
  out.push('{"type":"te');
  err.push('level=ERROR usage limit reached');
  out.push('xt"}\n');
  err.flush();
  out.flush();
  assert.deepEqual(lines, ['{"type":"text"}', 'level=ERROR usage limit reached']);
});

test('resolveInside refuses traversal, symlink escapes, missing files and non-strings', (t) => {
  const root = realpathSync(mkdtempSync(join(homedir(), '.glm-test-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const inner = join(root, 'wt');
  mkdirSync(join(inner, 'src'), { recursive: true });
  writeFileSync(join(inner, 'src/a.ts'), 'a');
  writeFileSync(join(root, '.env'), 'SECRET');
  symlinkSync(join(root, '.env'), join(inner, 'link.env'));
  assert.equal(resolveInside(inner, 'src/a.ts'), join(inner, 'src/a.ts'));
  assert.equal(resolveInside(inner, '../.env'), null);
  assert.equal(resolveInside(inner, join(root, '.env')), null);
  assert.equal(resolveInside(inner, 'link.env'), null);
  assert.equal(resolveInside(inner, 'missing.ts'), null);
  assert.equal(resolveInside(inner, undefined), null);
  assert.equal(resolveInside(inner, ''), null);
  assert.equal(resolveInside(inner, 'src'), null); // a directory: reading it would throw
});

test('sandbox blocks secrets and writes outside the worktree', { skip: !existsSync('/usr/bin/sandbox-exec') }, (t) => {
  // Not under the system temp dir: the profile leaves that writable, which would hide an escape.
  const home = realpathSync(mkdtempSync(join(homedir(), '.glm-test-')));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const repo = join(home, 'Documents/repo');
  const worktree = join(repo, '.worktrees/t');
  const runDir = join(repo, '.superpowers/glm/t');
  const agentHome = join(runDir, 'agent');
  for (const d of [join(repo, '.git'), worktree, agentHome, join(home, '.ssh')]) mkdirSync(d, { recursive: true });
  writeFileSync(join(repo, '.env'), 'SECRET');
  writeFileSync(join(repo, 'PLAN.md'), 'private');
  writeFileSync(join(home, '.ssh/id'), 'KEY');
  writeFileSync(join(worktree, 'code.ts'), 'code');
  for (const f of ['.zshrc', '.git-credentials', '.pgpass']) writeFileSync(join(home, f), 'SECRET');
  mkdirSync(join(home, '.local/share/opencode'), { recursive: true });
  writeFileSync(join(home, '.local/share/opencode/auth.json'), 'KEY');
  mkdirSync(join(home, '.claude/skills'), { recursive: true });
  writeFileSync(join(home, '.claude/skills/s.md'), 'skill');

  const profile = (readOnly) => sandboxProfile({ home, repo, worktree, runDir, agentHome, readOnly });
  const run = (readOnly, cmd) =>
    spawnSync('/usr/bin/sandbox-exec', ['-p', profile(readOnly), 'sh', '-c', cmd], { cwd: worktree }).status;

  assert.equal(run(false, `cat ${join(repo, '.env')}`) !== 0, true);
  assert.equal(run(false, `cat ${join(repo, 'PLAN.md')}`) !== 0, true);
  assert.equal(run(false, `cat ${join(home, '.ssh/id')}`) !== 0, true);
  // An allowlist: a file nobody thought to deny is still unreadable.
  for (const f of ['.zshrc', '.git-credentials', '.pgpass', '.local/share/opencode/auth.json']) {
    assert.notEqual(run(false, `cat ${join(home, f)}`), 0, f);
  }
  assert.equal(run(false, `cat ${join(home, '.claude/skills/s.md')}`), 0);
  assert.equal(run(false, `echo x > ${join(repo, 'escaped')}`) !== 0, true);
  assert.equal(run(false, `echo x > ${join(repo, '.git/escaped')}`) !== 0, true);
  assert.equal(run(false, `cat ${join(worktree, 'code.ts')} && echo x > new.ts`), 0);
  assert.equal(run(true, 'echo x > readonly.ts') !== 0, true);
  assert.equal(run(true, 'cat code.ts'), 0);
});

// Only the /private/tmp form: macOS keeps the usual path, /var/run/com.apple.launchd.*, writable by root alone.
test('sandbox blocks the ssh-agent socket path', { skip: !existsSync('/usr/bin/sandbox-exec') }, async (t) => {
  const dir = mkdtempSync('/private/tmp/com.apple.launchd.glmtest');
  const socket = join(dir, 'Listeners');
  const server = createServer((c) => c.end());
  await new Promise((done) => server.listen(socket, done));
  t.after(() => {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const connect = (args) =>
    new Promise((done) => {
      const code = `require('net').connect(${JSON.stringify(socket)}).on('connect',()=>process.exit(0)).on('error',()=>process.exit(3))`;
      spawn(...args(code), { stdio: 'ignore' }).on('close', done);
    });
  const home = realpathSync(homedir());
  const profile = sandboxProfile({ home, repo: '/nonexistent', worktree: '/nonexistent/w', runDir: '/nonexistent/r', agentHome: '/nonexistent/a' });
  assert.equal(await connect((code) => [process.execPath, ['-e', code]]), 0, 'control: reachable without the sandbox');
  assert.equal(await connect((code) => ['/usr/bin/sandbox-exec', ['-p', profile, process.execPath, '-e', code]]), 3);
});
