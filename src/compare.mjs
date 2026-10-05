// Pure comparison logic: README refs + public state -> issues.
import { compareVersions, parseVersion, INTENTIONAL_OLD } from './extract.mjs';

const DOWNLOAD_CTX = /(download|assets|install|ダウンロード|インストール)/i;
const D = 'DRIFT', A = 'AMBIGUOUS';

export function compareRelease(refs, latest) {
  const issues = [];
  if (!latest) return issues;
  const assets = new Set(latest.assets || []);
  for (const r of refs) {
    if (r.kind === 'download' || r.kind === 'tag') {
      const c = compareVersions(r.tag, latest.tag);
      if (c === null) continue;
      const shown = r.kind === 'download' ? `${r.tag}/${r.asset}` : r.tag;
      if (c === 0) {
        if (r.kind === 'download' && r.asset && !assets.has(r.asset)) {
          issues.push({ status: D, code: 'RELEASE_ASSET_NOT_FOUND', readme: shown, actual: `latest ${latest.tag} assets: ${[...assets].join(', ') || '(none)'}`, evidence: `line ${r.line}` });
        }
      } else if (c < 0) {
        const old = INTENTIONAL_OLD.test(r.ctx);
        issues.push({ status: old ? A : D, code: 'STALE_RELEASE_VERSION', readme: shown, actual: `latest release ${latest.tag}`, evidence: `line ${r.line}` + (old ? '; nearby text suggests an intentionally older/pre-release version' : '') });
      } else {
        issues.push({ status: A, code: 'README_NEWER_THAN_LATEST', readme: shown, actual: `latest stable release ${latest.tag}`, evidence: `line ${r.line}` });
      }
    } else if (r.kind === 'file') {
      if (assets.has(r.file)) continue;
      const v = parseVersion(r.file), lv = parseVersion(latest.tag);
      if (!v || !lv || compareVersions(r.file, latest.tag) !== -1) continue;
      const cand = r.file.replace(v.join('.'), lv.join('.'));
      if (cand !== r.file && assets.has(cand)) {
        const old = INTENTIONAL_OLD.test(r.ctx);
        const dl = DOWNLOAD_CTX.test(r.ctx);
        issues.push({
          status: old || !dl ? A : D, code: 'STALE_RELEASE_VERSION', readme: r.file, actual: `latest asset ${cand} (release ${latest.tag})`,
          evidence: `line ${r.line}` + (old ? '; intentionally older?' : '') + (dl ? '' : '; filename appears outside a download/install context'),
        });
      }
    }
  }
  return collapse(issues);
}

export function compareRegistry(pkgs, statuses, ownNames, kind) {
  const code = kind === 'npm' ? 'NPM_PACKAGE_NOT_FOUND' : 'PYPI_PACKAGE_NOT_FOUND';
  const own = new Set(ownNames.map(n => n.toLowerCase()));
  const issues = [];
  for (const p of pkgs) {
    const s = statuses[p.name];
    if (s === 200) continue;
    if (s !== 404) {
      issues.push({ status: 'ERROR', code, readme: p.name, actual: `registry returned ${s}`, evidence: `line ${p.line}: ${p.cmd}` });
      continue;
    }
    const last = p.name.split('/').pop().toLowerCase();
    const isOwn = own.has(p.name.toLowerCase()) || own.has(last);
    issues.push({
      status: isOwn ? D : A, code, readme: p.name, actual: `${kind} registry: 404 Not Found`,
      evidence: `line ${p.line}: ${p.cmd}` + (isOwn ? '' : "; name is not this repo's own package name (third-party / bin name / unpublished by design?)"),
    });
  }
  return issues;
}

export function compareGithubRepos(refs, statuses) {
  const issues = [];
  for (const r of refs) {
    const s = statuses[r.repo];
    if (s === 200) continue;
    issues.push(s === 404
      ? { status: D, code: 'GITHUB_REPO_NOT_FOUND', readme: r.repo, actual: 'GitHub API: 404 Not Found', evidence: `line ${r.line}: ${r.cmd}` }
      : { status: 'ERROR', code: 'GITHUB_REPO_NOT_FOUND', readme: r.repo, actual: `GitHub API returned ${s}`, evidence: `line ${r.line}: ${r.cmd}` });
  }
  return issues;
}

// How many release references were actually compared (comparable version, latest release known).
export function countCheckedRelease(refs, latest) {
  if (!latest) return 0;
  const assets = new Set(latest.assets || []);
  let n = 0;
  for (const r of refs) {
    if (r.kind === 'file') { if (assets.has(r.file) || (parseVersion(r.file) && compareVersions(r.file, latest.tag) === -1 && assets.has(r.file.replace(parseVersion(r.file).join('.'), (parseVersion(latest.tag) || []).join('.'))))) n++; }
    else if (compareVersions(r.tag, latest.tag) !== null) n++;
  }
  return n;
}

// OK only if something was actually checked; otherwise NOT_CHECKED.
export function finalStatus(issues, checked) {
  const o = overall(issues);
  return o === 'OK' && !(checked > 0) ? 'NOT_CHECKED' : o;
}

export function overall(issues) {
  if (issues.some(i => i.status === 'ERROR')) return 'ERROR';
  if (issues.some(i => i.status === D)) return 'DRIFT';
  if (issues.some(i => i.status === A)) return 'AMBIGUOUS';
  return 'OK';
}

// One issue per (code, README version): several download links for the same stale version are one finding.
function collapse(issues) {
  const byKey = new Map();
  for (const i of issues) {
    const k = i.code + '|' + (i.code === 'STALE_RELEASE_VERSION' ? (parseVersion(i.readme) || [i.readme]).join('.') : i.readme);
    const prev = byKey.get(k);
    if (!prev) { byKey.set(k, { ...i, refs: 1 }); continue; }
    prev.refs++;
    if (prev.status !== D && i.status === D) prev.status = D;
  }
  return [...byKey.values()].map(i => ({ ...i, evidence: i.evidence + (i.refs > 1 ? ` (+${i.refs - 1} more reference(s) to the same version)` : '') }));
}
