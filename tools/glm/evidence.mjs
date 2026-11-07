// The evidence pack Opus reads instead of the whole diff. The model only makes claims: every snippet is cut
// from the real file here, and every changed hunk no claim cites is shown in full, so nothing can be hidden.
import { quoteIsReal } from './findings.mjs';

export const isProduction = (file) => !/(\.spec\.|\.test\.|\.int-spec\.|(^|\/)test\/|pnpm-lock\.yaml$)/.test(file);

export function changedHunks(diff) {
  const hunks = [];
  let oldFile = '';
  let file = '';
  let hunk = null;
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) hunk = null;
    else if (line.startsWith('--- ') && !hunk) oldFile = line.slice(6);
    else if (line.startsWith('+++ ') && !hunk) file = line === '+++ /dev/null' ? oldFile : line.slice(6);
    else if (line.startsWith('@@ ')) {
      const [, start, count = '1'] = line.match(/\+(\d+)(?:,(\d+))?/);
      hunk = { file, start: Number(start), end: Number(start) + Math.max(Number(count), 1) - 1, text: line };
      if (isProduction(file)) hunks.push(hunk);
    } else if (hunk) hunk.text += `\n${line}`;
  }
  return hunks;
}

export function requirementIds(brief) {
  const section = brief.split(/^## Requirements\s*$/m)[1]?.split(/^## /m)[0] ?? '';
  return [...section.matchAll(/^(\d+)\.\s/gm)].map((m) => m[1]);
}

function snippet(content, line) {
  const first = Math.max(1, line - 3);
  return content
    .split('\n')
    .slice(first - 1, line + 3)
    .map((text, i) => `${first + i}: ${text}`)
    .join('\n');
}

export function buildEvidence({ claims, diff, requirements, readFile }) {
  const verified = [];
  const rejected = [];
  for (const claim of claims) {
    if (typeof claim !== 'object' || claim === null) continue;
    if (quoteIsReal(claim, readFile)) verified.push({ ...claim, snippet: snippet(readFile(claim.file), claim.line) });
    else rejected.push(claim);
  }
  const met = new Set(verified.map((c) => String(c.requirement)));
  const cites = (h) => verified.some((c) => c.file === h.file && c.line >= h.start && c.line <= h.end);
  return {
    verified,
    rejected,
    missing: requirements.filter((r) => !met.has(r)),
    uncited: changedHunks(diff).filter((h) => !cites(h)),
  };
}

export function renderEvidence(pack, mutations = []) {
  const out = [];
  if (pack.missing.length) out.push(`## No verified claim for requirements: ${pack.missing.join(', ')}`);
  if (pack.rejected.length) {
    out.push(`## Rejected claims (quote not found in the file)`);
    for (const c of pack.rejected) out.push(`- req ${c.requirement} ${c.file}:${c.line} ${c.why}`);
  }
  out.push(`## Mutation checks (run by the script)`);
  if (!mutations.length) out.push('None ran: nothing here shows the tests can fail.');
  for (const m of mutations) out.push(`- ${m.result} ${m.file}:${m.line} ${m.guards ?? ''} [${m.test}]`);
  out.push(`## Claims (snippets cut from the real files; reasons are the model's, unverified)`);
  for (const c of pack.verified) out.push(`### req ${c.requirement} ${c.file}:${c.line}\n${c.why}\n\`\`\`\n${c.snippet}\n\`\`\``);
  out.push(`## Changed production code no claim cites: read this`);
  if (!pack.uncited.length) out.push('None.');
  for (const h of pack.uncited) out.push(`### ${h.file}:${h.start}\n\`\`\`diff\n${h.text}\n\`\`\``);
  return `${out.join('\n')}\n`;
}

export function validMutation(m) {
  return (
    typeof m?.file === 'string' &&
    isProduction(m.file) &&
    !/(^|\/)(node_modules|\.git)\//.test(m.file) &&
    Number.isInteger(m.line) &&
    typeof m.quote === 'string' &&
    typeof m.replacement === 'string' &&
    typeof m.test === 'string'
  );
}

// A signal means the test never finished, which says nothing about whether it can fail.
export const mutationResult = (code) => (code === null ? 'INVALID' : code === 0 ? 'SURVIVED' : 'KILLED');

// Finished, but "the tests can fail" is only shown by a caught mutation inside this change. Guards elsewhere
// are still worth breaking, as a brief may ask, but they say nothing about the new code.
export function completionStatus(mutations, hunks) {
  const inChange = (m) => hunks.some((h) => h.file === m.file && m.line >= h.start && m.line <= h.end);
  return mutations.some((m) => m.result === 'KILLED' && inChange(m)) ? 'DONE' : 'DONE_UNMUTATED';
}

// The quote must be on the cited line and the edit must change it, so a mutation can't silently do nothing.
export function applyMutation(content, { line, quote, replacement }) {
  const lines = content.split('\n');
  const current = lines[line - 1];
  if (!quote || current === undefined || !current.includes(quote)) return null;
  const mutated = current.replace(quote, () => replacement);
  if (mutated === current) return null;
  lines[line - 1] = mutated;
  return lines.join('\n');
}
