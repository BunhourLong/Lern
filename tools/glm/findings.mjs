// Helpers for the GLM loop: nothing here touches the network or the model.
import { realpathSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';

// A model reply may wrap its JSON in prose or a code fence; take the outermost object.
export function parseJsonReply(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

// A finding must quote real code near the line it cites, or the reviewer imagined it.
export function quoteIsReal(finding, readFile) {
  const quote = finding.quote?.trim();
  if (!quote || !finding.file || !Number.isInteger(finding.line)) return false;
  let content;
  try {
    content = readFile(finding.file);
  } catch {
    return false;
  }
  const near = content
    .split('\n')
    .slice(Math.max(0, finding.line - 6), finding.line + 5)
    .join('\n');
  return near.includes(quote);
}

// Deterministic checks a weak model must not be trusted to run on itself.
export function diffProblems(diff) {
  const problems = [];
  let file = '';
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ b/')) file = line.slice(6);
    else if (line.startsWith('+') && /\b(?:it|test|describe)\.(?:skip|only)\b|\bx(?:it|describe)\(/.test(line)) {
      problems.push({
        severity: 'Critical',
        file,
        what: `added a skipped or focused test: ${line.slice(1).trim()}`,
        fix: 'Remove it; a test that does not run proves nothing.',
      });
    }
  }
  return problems;
}

// The Go plan's weekly cap: a parsed `opencode run --format json` event. It doesn't clear within a run.
export const isUsageLimit = (event) => event?.type === 'error' && event.error?.type === 'provider.go-limit';

// Stdout and stderr interleave at any byte, so each stream needs its own buffer.
export function lineSplitter(onLine) {
  let buffered = '';
  return {
    push(text) {
      buffered += text;
      const lines = buffered.split('\n');
      buffered = lines.pop();
      for (const line of lines) onLine(line);
    },
    flush() {
      if (buffered) onLine(buffered);
      buffered = '';
    },
  };
}

// Paths come from the model, and the script that uses them runs outside the sandbox. Realpath, so a symlink
// the model made inside the worktree can't point out of it either.
export function resolveInside(root, file) {
  if (typeof file !== 'string' || !file) return null;
  try {
    const path = realpathSync(resolve(root, file));
    return path.startsWith(realpathSync(root) + sep) && statSync(path).isFile() ? path : null;
  } catch {
    return null;
  }
}

const str = (s) => JSON.stringify(s);

// An allowlist for the home directory, so a credential file nobody thought of stays unreadable.
// shortcut: the network stays open and Docker stays reachable because inference and tests need them, so a
// container mount could still read host files. This guards against mistakes, not a determined attacker.
export function sandboxProfile({ home, repo, worktree, runDir, agentHome, readOnly }) {
  const readable = [
    '.local/bin', '.local/share/pnpm', '.local/state/pnpm', '.nvm', '.npm', '.cache', '.opencode', '.bun', '.agents',
    '.claude/skills', '.claude/CLAUDE.md', '.docker/run', '.docker/cli-plugins', '.docker/contexts',
    'Library/Caches', 'Library/pnpm', 'Library/Preferences/pnpm',
  ];
  const writable = [agentHome, '/private/tmp', '/private/var/folders', `${home}/Library/Caches`, `${home}/.cache`, `${home}/.npm`];
  if (!readOnly) writable.push(worktree);
  return `(version 1)
(allow default)
(deny file-write*)
(allow file-write* ${writable.map((p) => `(subpath ${str(p)})`).join(' ')} (regex #"^/dev/"))
(deny file-read-data (subpath ${str(home)}))
(allow file-read-data ${readable.map((p) => `(subpath ${str(`${home}/${p}`)})`).join(' ')})
(allow file-read-data (subpath ${str(`${repo}/.git`)}) (subpath ${str(worktree)}) (subpath ${str(runDir)}))
(deny mach-lookup (global-name "com.apple.SecurityServer"))
(deny network-outbound (remote unix-socket (path-regex #"^(/private)?/(tmp|var/run)/com\\.apple\\.launchd\\.")))
`;
}
