// Offline unit and CLI integration tests (no network).
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractNpm, extractPip, extractReleaseRefs, extractGithubRefs, compareVersions, parseVersion } from '../src/extract.mjs';
import { compareRelease, compareRegistry, compareGithubRepos, countCheckedRelease, finalStatus, overall } from '../src/compare.mjs';

test('release URL extraction: download + tag, own repo only', () => {
  const md = [
    '[APK](https://github.com/me/app/releases/download/v1.0.5/app-v1.0.5.apk)',
    '[page](https://github.com/me/app/releases/tag/v1.0.5)',
    'curl -L https://github.com/other/tool/releases/download/v0.7.1/x.tar.gz',
  ].join('\n');
  const refs = extractReleaseRefs(md, 'me', 'app');
  assert.equal(refs.filter(r => r.kind === 'download').length, 1);
  assert.equal(refs.filter(r => r.kind === 'tag').length, 1);
  assert.equal(refs.some(r => r.tag === 'v0.7.1'), false, 'third-party repo URL is ignored');
  assert.equal(refs.find(r => r.kind === 'download').asset, 'app-v1.0.5.apk');
});

test('versioned asset filename extraction', () => {
  const refs = extractReleaseRefs('Download `wol-light-v1.0.5-android.apk` from Assets.', 'a', 'b');
  assert.deepEqual(refs.map(r => [r.kind, r.file]), [['file', 'wol-light-v1.0.5-android.apk']]);
});

test('version parsing and comparison', () => {
  assert.deepEqual(parseVersion('v1.0.5'), [1, 0, 5]);
  assert.deepEqual(parseVersion('tkn_0.46.0_Darwin'), [0, 46, 0]);
  assert.equal(compareVersions('v1.0.5', 'v1.0.6'), -1);
  assert.equal(compareVersions('3.1.1', '3.1.0'), 1);
  assert.equal(compareVersions('v2.0', '2.0.0'), 0);
  assert.equal(compareVersions('nightly', 'v1.0.0'), null);
});

test('npm install / npx extraction', () => {
  const md = 'npm install\nnpx agent-rules-linter\nnpm i -g @acme/widget@1.2.3\nnpx -y some-tool --flag\nnpx -p realpkg mycmd';
  assert.deepEqual(extractNpm(md).map(x => x.name), ['agent-rules-linter', '@acme/widget', 'some-tool', 'realpkg']);
});

test('npm false positives are avoided: placeholders, examples, urls, git, bare install', () => {
  const md = [
    'npm install',
    'npm install && npm test',
    'npx <package-name>',
    'npm install your-package',
    'npx github:me/tool',
    'npm i https://example.com/x.tgz',
    'Example: npx foo-bar-baz',
  ].join('\n');
  assert.deepEqual(extractNpm(md), []);
});

test('pip / pipx extraction', () => {
  const md = 'pip install requests\npip3 install "x"\npipx install acme-tool\npip install -U acme-lib[extra]>=1.0\npython -m pip install ok_pkg';
  assert.deepEqual(extractPip(md).map(x => x.name), ['requests', 'acme-tool', 'acme-lib', 'ok_pkg']);
});

test('pip false positives are avoided: -r, -e, ., git+, requirements, placeholders', () => {
  const md = 'pip install -r requirements.txt\npip install -e .\npip install git+https://github.com/a/b\npip install .\npip install <package>\npip install your-package';
  assert.deepEqual(extractPip(md), []);
});

const latest = { tag: 'v1.0.6', assets: ['app-v1.0.6.apk'] };
const ref = (o) => ({ line: 1, ctx: '', ...o });

test('compare: stale fixed version -> DRIFT STALE_RELEASE_VERSION', () => {
  const r = compareRelease([ref({ kind: 'tag', tag: 'v1.0.5' })], latest);
  assert.equal(r.length, 1);
  assert.equal(r[0].code, 'STALE_RELEASE_VERSION');
  assert.equal(r[0].status, 'DRIFT');
});

test('compare: same version but asset missing -> RELEASE_ASSET_NOT_FOUND', () => {
  const r = compareRelease([ref({ kind: 'download', tag: 'v1.0.6', asset: 'old-name.apk' })], latest);
  assert.equal(r[0].code, 'RELEASE_ASSET_NOT_FOUND');
});

test('compare: current version and existing asset -> no issue', () => {
  assert.deepEqual(compareRelease([ref({ kind: 'download', tag: 'v1.0.6', asset: 'app-v1.0.6.apk' }), ref({ kind: 'tag', tag: 'v1.0.6' })], latest), []);
});

test('compare: intentionally older / alpha context -> AMBIGUOUS, not DRIFT', () => {
  const r = compareRelease([ref({ kind: 'tag', tag: 'v0.1.6', ctx: 'Download older version (v0.1.6)' })], latest);
  assert.equal(r[0].status, 'AMBIGUOUS');
});

test('compare: README newer than latest stable -> AMBIGUOUS', () => {
  assert.equal(compareRelease([ref({ kind: 'tag', tag: 'v2.0.0' })], latest)[0].status, 'AMBIGUOUS');
});

test('compare: unparsable tag / unrelated filename -> ignored', () => {
  assert.deepEqual(compareRelease([ref({ kind: 'tag', tag: 'nightly' }), ref({ kind: 'file', file: 'Music_8.1.0.apk' })], latest), []);
});

test('compare: several links to the same stale version collapse into one issue', () => {
  const r = compareRelease([ref({ kind: 'tag', tag: 'v1.0.5' }), ref({ kind: 'download', tag: 'v1.0.5', asset: 'app-v1.0.5.apk' }), ref({ kind: 'file', file: 'app-v1.0.5.apk' })], latest);
  assert.equal(r.length, 1);
  assert.match(r[0].evidence, /more reference/);
});

test('compare: no release at all -> no release issues', () => {
  assert.deepEqual(compareRelease([ref({ kind: 'tag', tag: 'v1.0.5' })], null), []);
});

test('registry: 404 for own package name -> DRIFT', () => {
  const r = compareRegistry([{ name: 'agent-rules-linter', line: 18, cmd: 'npx agent-rules-linter' }], { 'agent-rules-linter': 404 }, ['agent-rules-linter'], 'npm');
  assert.equal(r[0].code, 'NPM_PACKAGE_NOT_FOUND');
  assert.equal(r[0].status, 'DRIFT');
});

test('registry: 404 for a name that is not the repo\'s own -> AMBIGUOUS', () => {
  const r = compareRegistry([{ name: 'pbiviz', line: 1, cmd: 'npx pbiviz' }], { pbiviz: 404 }, ['pbi-cli'], 'npm');
  assert.equal(r[0].status, 'AMBIGUOUS');
});

test('registry: 200 -> no issue; 5xx -> ERROR; pypi code name', () => {
  assert.deepEqual(compareRegistry([{ name: 'x', line: 1, cmd: '' }], { x: 200 }, [], 'pypi'), []);
  assert.equal(compareRegistry([{ name: 'x', line: 1, cmd: '' }], { x: 503 }, [], 'pypi')[0].status, 'ERROR');
  assert.equal(compareRegistry([{ name: 'mine', line: 1, cmd: '' }], { mine: 404 }, ['mine'], 'pypi')[0].code, 'PYPI_PACKAGE_NOT_FOUND');
});

test('npm: placeholder scope like @scope/x is ignored', () => {
  assert.deepEqual(extractNpm('npx -y @scope/server'), []);
});

test('compare: stale filename outside a download context -> AMBIGUOUS, inside -> DRIFT', () => {
  const a = compareRelease([ref({ kind: 'file', file: 'app-v1.0.5.apk', ctx: 'apksigner verify --print-certs app-v1.0.5.apk' })], latest);
  assert.equal(a[0].status, 'AMBIGUOUS');
  const d = compareRelease([ref({ kind: 'file', file: 'app-v1.0.5.apk', ctx: 'Download app-v1.0.5.apk from Assets.' })], latest);
  assert.equal(d[0].status, 'DRIFT');
});

test('status: no entrypoint checked -> NOT_CHECKED; checked and clean -> OK', () => {
  assert.equal(finalStatus([], 0), 'NOT_CHECKED');
  assert.equal(finalStatus([], 1), 'OK');
  assert.equal(finalStatus([{ status: 'DRIFT' }], 0), 'DRIFT');
  assert.equal(finalStatus([{ status: 'AMBIGUOUS' }], 2), 'AMBIGUOUS');
});

test('checked count: comparable release refs only; none without latest', () => {
  const l = { tag: 'v1.0.6', assets: ['app-v1.0.6.apk'] };
  const refs = [{ kind: 'tag', tag: 'v1.0.6' }, { kind: 'tag', tag: 'nightly' }, { kind: 'file', file: 'Music_8.1.0.apk' }, { kind: 'file', file: 'app-v1.0.6.apk' }];
  assert.equal(countCheckedRelease(refs, l), 2);
  assert.equal(countCheckedRelease(refs, null), 0);
});

test('github: npx github:owner/repo extraction', () => {
  const md = 'npx github:iwadjp/ember scan\nnpx -p github:iwadjp/ember ember-demo\nnpm i github:acme-co/tool#v1';
  assert.deepEqual(extractGithubRefs(md).map(x => x.repo), ['iwadjp/ember', 'acme-co/tool']);
});

test('github: placeholders / examples are not extracted', () => {
  const md = 'npx github:owner/repo\nnpx github:your-name/your-tool\nExample: npx github:acme/real-looking\nnpx github:user/package';
  assert.deepEqual(extractGithubRefs(md), []);
});

test('github: repo exists -> no issue; 404 -> DRIFT GITHUB_REPO_NOT_FOUND; 500 -> ERROR', () => {
  const refs = [{ repo: 'a/ok', line: 1, cmd: 'c' }, { repo: 'a/gone', line: 2, cmd: 'c' }, { repo: 'a/err', line: 3, cmd: 'c' }];
  const r = compareGithubRepos(refs, { 'a/ok': 200, 'a/gone': 404, 'a/err': 500 });
  assert.deepEqual(r.map(i => [i.readme, i.status, i.code]), [['a/gone', 'DRIFT', 'GITHUB_REPO_NOT_FOUND'], ['a/err', 'ERROR', 'GITHUB_REPO_NOT_FOUND']]);
});

test('overall status precedence', () => {
  assert.equal(overall([]), 'OK');
  assert.equal(overall([{ status: 'AMBIGUOUS' }]), 'AMBIGUOUS');
  assert.equal(overall([{ status: 'AMBIGUOUS' }, { status: 'DRIFT' }]), 'DRIFT');
  assert.equal(overall([{ status: 'DRIFT' }, { status: 'ERROR' }]), 'ERROR');
});

import fs from 'node:fs';
const agentty = fs.readFileSync(new URL('../fixtures/agentty-prose-install.md', import.meta.url), 'utf8');

test('regression (1ay1/agentty): prose after "npm install" is not parsed as packages', () => {
  assert.deepEqual(extractNpm(agentty), []);
  assert.deepEqual(extractPip(agentty), []);
  assert.deepEqual(extractGithubRefs(agentty), []);
  assert.equal(finalStatus([], extractNpm(agentty).length + extractPip(agentty).length), 'NOT_CHECKED');
});

test('package list stops at the first non-package token (npm and pip), valid packages before it are kept', () => {
  assert.deepEqual(extractNpm('npm install alpha beta — gamma delta').map(x => x.name), ['alpha', 'beta']);
  assert.deepEqual(extractPip('pip install alpha beta — gamma delta').map(x => x.name), ['alpha', 'beta']);
  assert.deepEqual(extractNpm('npm install alpha beta && npm test').map(x => x.name), ['alpha', 'beta']);
});

test('existing valid forms still work: scoped, multiple, version specifiers, pip extras', () => {
  assert.deepEqual(extractNpm('npm i -g @acme/widget@1.2.3 left-pad').map(x => x.name), ['@acme/widget', 'left-pad']);
  assert.deepEqual(extractPip('pip install requests>=2.0 acme-lib[extra]==1.0 other').map(x => x.name), ['requests', 'acme-lib', 'other']);
});

// Offline CLI integration: run the real entrypoint with public GETs stubbed in the child.
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const cliUrl = new URL('../src/cli.mjs', import.meta.url).href;
const readmeFor = (version) => `Download [APK](https://github.com/iwadjp/pixel-tag-drawer/releases/download/v${version}/pixel-tag-drawer-v${version}.apk)\n`;
const cliBootstrap = `
  const [cli, ...args] = process.argv.slice(1);
  process.argv = [process.execPath, cli, ...args];
  globalThis.fetch = async (url, options) => {
    if ((options.method ?? 'GET') !== 'GET') throw new Error('Unexpected non-GET');
    if (url.endsWith('/releases/latest')) return Response.json({
      tag_name: 'v0.1.6', assets: [{ name: 'pixel-tag-drawer-v0.1.6.apk' }]
    });
    if (url.endsWith('/readme')) return new Response(${JSON.stringify(readmeFor('0.1.6'))});
    throw new Error('Unexpected offline request: ' + url);
  };
  await import(cli);
`;

function cliFixture(t, versions = ['0.1.6', '0.1.6']) {
  const fixtureParent = path.resolve(os.tmpdir());
  const cwd = fs.mkdtempSync(path.join(fixtureParent, 'readme-cli-'));
  assert.equal(path.dirname(cwd), fixtureParent);
  assert.match(path.basename(cwd), /^readme-cli-/);
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  for (const [index, name] of ['README.md', 'README.ja.md'].entries()) {
    fs.writeFileSync(path.join(cwd, name), readmeFor(versions[index]));
  }
  return cwd;
}

function runCli(cwd, args) {
  const result = spawnSync(process.execPath,
    ['--input-type=module', '--eval', cliBootstrap, '--', cliUrl, ...args],
    { cwd, encoding: 'utf8', timeout: 10000 });
  assert.equal(result.error, undefined);
  return result;
}

const repoArg = 'iwadjp/pixel-tag-drawer';
const twoReadmes = [repoArg, '--readme-file', 'README.md', '--readme-file', 'README.ja.md'];

test('CLI single --readme-file preserves the existing successful output', (t) => {
  const r = runCli(cliFixture(t), [repoArg, '--readme-file', 'README.md']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'OK  iwadjp/pixel-tag-drawer  (checked entrypoints: 2; release refs 2, npm 0, pip 0, github: 0; latest v0.1.6)\n');
});

test('CLI without --readme-file still fetches the default README', (t) => {
  const r = runCli(cliFixture(t), [repoArg]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^OK  iwadjp\/pixel-tag-drawer /);
});

for (const [label, versions, expectedCode, expectedStatuses] of [
  ['two README files both OK', ['0.1.6', '0.1.6'], 0, ['OK', 'OK']],
  ['first OK / second stale', ['0.1.6', '0.1.5'], 1, ['OK', 'DRIFT']],
  ['first stale / second OK', ['0.1.5', '0.1.6'], 1, ['DRIFT', 'OK']],
  ['both stale', ['0.1.5', '0.1.5'], 1, ['DRIFT', 'DRIFT']],
]) {
  test(`CLI localized README pair: ${label}`, (t) => {
    const r = runCli(cliFixture(t, versions), twoReadmes);
    assert.equal(r.status, expectedCode, r.stderr);
    const rows = r.stdout.split('\n').filter(line => /^(OK|DRIFT)  /.test(line));
    assert.equal(rows.length, 2, r.stdout);
    assert.match(rows[0], new RegExp(`^${expectedStatuses[0]}  .*README.md`));
    assert.match(rows[1], new RegExp(`^${expectedStatuses[1]}  .*README.ja.md`));
    assert.equal((r.stdout.match(/STALE_RELEASE_VERSION/g) || []).length,
      expectedStatuses.filter(s => s === 'DRIFT').length);
    assert.match(r.stdout, /SUMMARY \(2 README checks across 1 repo\)/);
  });
}

test('CLI nonexistent path is identified, other README still checked, ERROR wins over DRIFT', (t) => {
  const r = runCli(cliFixture(t, ['0.1.5', '0.1.6']),
    [repoArg, '--readme-file', 'missing.md', '--readme-file', 'README.md']);
  assert.equal(r.status, 2);
  assert.match(r.stdout, /^ERROR  .*missing.md/m);
  assert.match(r.stdout, /README_READ_FAILED/);
  assert.match(r.stdout, /^DRIFT  .*README.md/m);
  assert.match(r.stdout, /STALE_RELEASE_VERSION/);
});

test('CLI duplicate normalized paths are checked once', (t) => {
  const r = runCli(cliFixture(t),
    [repoArg, '--readme-file', 'README.md', '--readme-file', './README.md']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal((r.stdout.match(/^OK  /gm) || []).length, 1);
  assert.doesNotMatch(r.stdout, /SUMMARY/);
});

test('CLI paths with spaces and Japanese characters work without shell expansion', (t) => {
  const cwd = cliFixture(t);
  fs.writeFileSync(path.join(cwd, 'README 日本語.md'), readmeFor('0.1.6'));
  const r = runCli(cwd, [repoArg, '--readme-file', 'README.md', '--readme-file', 'README 日本語.md']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^OK  .*README 日本語.md/m);
});

test('CLI single local file still applies to every repository argument', (t) => {
  const r = runCli(cliFixture(t), [repoArg, repoArg, '--readme-file', 'README.md']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal((r.stdout.match(/^OK  /gm) || []).length, 2);
  assert.match(r.stdout, /SUMMARY \(2 repos\)/);
});

test('CLI missing --readme-file value fails with exit 2', (t) => {
  const r = runCli(cliFixture(t), [repoArg, '--readme-file']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--readme-file requires a path/);
});

test('CLI missing path after another option does not consume that option', (t) => {
  const r = runCli(cliFixture(t), [repoArg, '--readme-file', '--readme-file', 'README.md']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--readme-file requires a path/);
  assert.equal(r.stdout, '');
});

test('CLI missing second file cannot hide behind a successful first file', (t) => {
  const r = runCli(cliFixture(t), [repoArg, '--readme-file', 'README.md', '--readme-file', 'missing.md']);
  assert.equal(r.status, 2);
  assert.match(r.stdout, /^OK  .*README.md/m);
  assert.match(r.stdout, /^ERROR  .*missing.md/m);
});

test('CLI multiple local files apply to every repo and count README checks', (t) => {
  const r = runCli(cliFixture(t), [repoArg, repoArg, ...twoReadmes.slice(1)]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal((r.stdout.match(/^OK  /gm) || []).length, 4);
  assert.match(r.stdout, /SUMMARY \(4 README checks across 2 repos\)/);
});

test('CLI Windows path case variants are deduplicated', { skip: process.platform !== 'win32' }, (t) => {
  const r = runCli(cliFixture(t), [repoArg, '--readme-file', 'README.md', '--readme-file', 'readme.MD']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal((r.stdout.match(/^OK  /gm) || []).length, 1);
});

test('CLI thrown check errors do not prevent checking later repository inputs', (t) => {
  const r = runCli(cliFixture(t), ['not-a-repo', repoArg, '--readme-file', 'README.md']);
  assert.equal(r.status, 2);
  assert.match(r.stdout, /^ERROR  not-a-repo/m);
  assert.match(r.stdout, /CHECK_FAILED/);
  assert.match(r.stdout, /^OK  iwadjp\/pixel-tag-drawer/m);
});

test('CLI multi-file NOT_CHECKED keeps the existing exit-0 semantics', (t) => {
  const cwd = cliFixture(t);
  fs.writeFileSync(path.join(cwd, 'README.ja.md'), '# 説明だけ\n');
  const r = runCli(cwd, twoReadmes);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^OK  .*README.md/m);
  assert.match(r.stdout, /^NOT_CHECKED  .*README.ja.md/m);
  assert.match(r.stdout, /NOT judged as OK/);
});
