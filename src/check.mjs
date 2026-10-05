// Network layer: GET only.
import { extractNpm, extractPip, extractReleaseRefs, extractGithubRefs } from './extract.mjs';
import { compareRelease, compareRegistry, compareGithubRepos, countCheckedRelease, finalStatus } from './compare.mjs';

const H = {
  'User-Agent': 'readme-entry-check/0.0.1',
  Accept: 'application/vnd.github+json',
};
const get = (url, headers = {}) => fetch(url, { headers: {
  ...H, ...headers,
  ...(new URL(url).origin === 'https://api.github.com' && process.env.GITHUB_TOKEN
    ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
} });

export function parseRepo(arg) {
  const m = String(arg).match(/^(?:https?:\/\/github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/#?].*)?$/);
  if (!m) throw new Error(`cannot parse repo: ${arg}`);
  return { owner: m[1], repo: m[2] };
}

async function ownNames(owner, repo) {
  const names = [repo];
  const raw = { Accept: 'application/vnd.github.raw' };
  const pj = await get(`https://api.github.com/repos/${owner}/${repo}/contents/package.json`, raw);
  if (pj.ok) { try { const n = JSON.parse(await pj.text()).name; if (n) names.push(n); } catch { /* ignore */ } }
  const pp = await get(`https://api.github.com/repos/${owner}/${repo}/contents/pyproject.toml`, raw);
  if (pp.ok) { const m = (await pp.text()).match(/^name\s*=\s*"([^"]+)"/m); if (m) names.push(m[1]); }
  return names;
}

export async function check(arg, { readmeText } = {}) {
  const { owner, repo } = parseRepo(arg);
  if (readmeText == null) {
    const r = await get(`https://api.github.com/repos/${owner}/${repo}/readme`, { Accept: 'application/vnd.github.raw' });
    if (!r.ok) return { repo: `${owner}/${repo}`, status: 'ERROR', issues: [{ status: 'ERROR', code: 'README_FETCH_FAILED', readme: '-', actual: `HTTP ${r.status}`, evidence: '' }] };
    readmeText = await r.text();
  }
  const refs = extractReleaseRefs(readmeText, owner, repo);
  const npm = extractNpm(readmeText), pip = extractPip(readmeText), gh = extractGithubRefs(readmeText);
  const issues = [];
  let latest = null;
  if (refs.length) {
    const r = await get(`https://api.github.com/repos/${owner}/${repo}/releases/latest`);
    if (r.ok) { const j = await r.json(); latest = { tag: j.tag_name, assets: (j.assets || []).map(a => a.name) }; }
    else if (r.status !== 404) issues.push({ status: 'ERROR', code: 'RELEASE_FETCH_FAILED', readme: '-', actual: `HTTP ${r.status}`, evidence: '' });
    issues.push(...compareRelease(refs, latest));
  }
  if (gh.length) {
    const gs = {};
    for (const g of gh) gs[g.repo] = (await get(`https://api.github.com/repos/${g.repo}`)).status;
    issues.push(...compareGithubRepos(gh, gs));
  }
  if (npm.length || pip.length) {
    const own = await ownNames(owner, repo);
    const st = async (url) => (await get(url, { Accept: 'application/json' })).status;
    const ns = {}, ps = {};
    for (const p of npm) ns[p.name] = await st('https://registry.npmjs.org/' + p.name.replace('/', '%2F'));
    for (const p of pip) ps[p.name] = await st(`https://pypi.org/pypi/${p.name}/json`);
    issues.push(...compareRegistry(npm, ns, own, 'npm'), ...compareRegistry(pip, ps, own, 'pypi'));
  }
  const checked = countCheckedRelease(refs, latest) + npm.length + pip.length + gh.length;
  return { repo: `${owner}/${repo}`, status: finalStatus(issues, checked), issues, summary: { releaseRefs: refs.length, npm: npm.length, pip: pip.length, github: gh.length, checked, latest: latest ? latest.tag : null } };
}
