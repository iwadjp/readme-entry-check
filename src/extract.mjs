// Pure functions: extract machine-readable entry points from README text.
const NAME_NPM = /^(@[\w.-]+\/)?[\w][\w.-]*(@[^\s]+)?$/;
const NAME_PIP = /^[A-Za-z][\w.-]*(\[[\w,.-]+\])?([=<>!~]=?[^\s]*)?$/;
const PLACEHOLDER = /^(your|my|foo|bar|baz|example|package|pkg|name|xxx)([-_].*)?$/i;
const EXAMPLE_LINE = /\b(example|e\.g\.|placeholder)\b/i;

function bareNpm(tok) {
  const m = tok.match(/^(@[\w.-]+\/[\w.-]+|[\w][\w.-]*)(@.+)?$/);
  return m ? m[1] : null;
}
function bareNpmOk(tok) {
  if (!NAME_NPM.test(tok)) return false;
  const n = bareNpm(tok);
  if (n && /^@(scope|org|your-?org|example|my)\//i.test(n)) return false;
  return !!n && !PLACEHOLDER.test(n.replace(/^@[\w.-]+\//, '')) && !/^(https?|github|git|file)$/i.test(n);
}

export function extractNpm(text) {
  const out = [], lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    if (EXAMPLE_LINE.test(line) || (lines[i - 1] && EXAMPLE_LINE.test(lines[i - 1]))) return;
    const re = /\b(?:npm\s+(?:install|i|add)|npx)\b((?:\s+[^\s&|;#`]+)*)/g;
    let m;
    while ((m = re.exec(line))) {
      const isNpx = /^npx/.test(m[0]);
      const toks = m[1].trim().split(/\s+/).filter(Boolean);
      for (let k = 0; k < toks.length; k++) {
        const t = toks[k];
        if (t === '-p' || t === '--package') { const nx = toks[++k]; if (nx && bareNpmOk(nx)) out.push({ name: bareNpm(nx), line: i + 1, cmd: m[0].trim() }); break; }
        if (t.startsWith('-')) continue;
        if (!bareNpmOk(t)) { if (isNpx) break; continue; }
        out.push({ name: bareNpm(t), line: i + 1, cmd: m[0].trim() });
        if (isNpx) break; // npx: first non-flag token is the package/bin
      }
    }
  });
  return dedupe(out, 'name');
}

export function extractPip(text) {
  const out = [], lines = text.split(/\r?\n/);
  const ARGFLAGS = new Set(['-r', '-e', '-c', '-i', '-f', '--index-url', '--extra-index-url', '--find-links', '--requirement', '--editable', '--constraint', '--target', '-t']);
  lines.forEach((line, i) => {
    if (EXAMPLE_LINE.test(line) || (lines[i - 1] && EXAMPLE_LINE.test(lines[i - 1]))) return;
    const re = /\b(?:pip3?|pipx)\s+install\b((?:\s+[^\s&|;#`]+)*)/g;
    let m;
    while ((m = re.exec(line))) {
      const toks = m[1].trim().split(/\s+/).filter(Boolean);
      for (let k = 0; k < toks.length; k++) {
        const t = toks[k];
        if (ARGFLAGS.has(t)) { k++; continue; }
        if (t.startsWith('-')) continue;
        if (!NAME_PIP.test(t)) continue;
        const name = t.replace(/\[.*$/, '').replace(/[=<>!~].*$/, '');
        if (PLACEHOLDER.test(name) || /^(git|http|https|requirements)$/i.test(name) || /\.(txt|toml|whl|gz)$/.test(name)) continue;
        out.push({ name, line: i + 1, cmd: m[0].trim() });
      }
    }
  });
  return dedupe(out, 'name');
}

export function extractReleaseRefs(text, owner, repo) {
  const refs = [], lines = text.split(/\r?\n/);
  const me = `${owner}/${repo}`.toLowerCase();
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/github\.com\/([\w.-]+\/[\w.-]+)\/releases\/(download|tag)\/([^\s)"'>\]`/]+)(?:\/([^\s)"'>\]`]+))?/g)) {
      if (m[1].toLowerCase() !== me) continue;
      const tag = decodeURIComponent(m[3]);
      refs.push({ kind: m[2] === 'download' ? 'download' : 'tag', tag, asset: m[2] === 'download' ? m[4] : undefined, line: i + 1, ctx: ctx(lines, i) });
    }
    for (const m of line.matchAll(/`?([\w.-]*\d+\.\d+(?:\.\d+)?[\w.-]*\.(?:apk|zip|exe|msi|jar|tar\.gz|dmg|AppImage|deb))`?/g)) {
      refs.push({ kind: 'file', file: m[1], line: i + 1, ctx: ctx(lines, i) });
    }
  });
  return refs;
}
const ctx = (lines, i) => [lines[i - 1] || '', lines[i]].join('\n');

export function parseVersion(s) {
  const m = String(s).match(/(\d+(?:\.\d+){0,3})/);
  return m ? m[1].split('.').map(Number) : null;
}
export function compareVersions(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) return null;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}
export const INTENTIONAL_OLD = /(older|previous|legacy|archive|old version|alpha|beta|nightly|pre-?release|unstable|旧|過去|以前)/i;

function dedupe(arr, key) { const s = new Set(); return arr.filter(x => !s.has(x[key]) && s.add(x[key])); }

// `npx github:owner/repo[#ref]` / `npm i github:owner/repo` -> the referenced GitHub repo.
const PLACEHOLDER_OWNER = /^(owner|user|username|you|your|org|me|example|account)([-_].*)?$/i;
export function extractGithubRefs(text) {
  const out = [], lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    if (EXAMPLE_LINE.test(line) || (lines[i - 1] && EXAMPLE_LINE.test(lines[i - 1]))) return;
    for (const m of line.matchAll(/\b(?:npx|npm\s+(?:install|i|add))\b[^\n`&|;#]*?\bgithub:([\w.-]+)\/([\w.-]+?)(?=[#\s`)"'&|;]|$)/g)) {
      const [, owner, repo] = m;
      if (PLACEHOLDER_OWNER.test(owner) || PLACEHOLDER.test(repo) || /^(repo|repository|package)$/i.test(repo)) continue;
      out.push({ repo: `${owner}/${repo}`, line: i + 1, cmd: m[0].trim() });
    }
  });
  return dedupe(out, 'repo');
}
