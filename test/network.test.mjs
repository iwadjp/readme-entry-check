// Acceptance tests: need network (GET only). Run with: npm run test:network
// Set GITHUB_TOKEN to avoid the unauthenticated GitHub rate limit.
// NOTE: results depend on the live state of the repos below (fixtures pin only the README side).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { check } from '../src/check.mjs';

const fx = (n) => fs.readFileSync(new URL(`../fixtures/${n}`, import.meta.url), 'utf8');
const codes = (r, status) => r.issues.filter(i => !status || i.status === status).map(i => i.code);

test('WolLight README before fix (45205ed) -> STALE_RELEASE_VERSION', async () => {
  const r = await check('iwadjp/wol-light', { readmeText: fx('wollight-before-45205ed.md') });
  assert.equal(r.status, 'DRIFT');
  assert.ok(codes(r, 'DRIFT').includes('STALE_RELEASE_VERSION'));
});

test('agent-rules-linter README before fix (57cceed) -> NPM_PACKAGE_NOT_FOUND', async () => {
  const r = await check('iwadjp/agent-rules-linter', { readmeText: fx('agent-rules-linter-before-57cceed.md') });
  assert.equal(r.status, 'DRIFT');
  assert.ok(codes(r, 'DRIFT').includes('NPM_PACKAGE_NOT_FOUND'));
});

test('current WolLight / agent-rules-linter READMEs (fixed) -> OK', async () => {
  for (const repo of ['iwadjp/wol-light', 'iwadjp/agent-rules-linter']) {
    const r = await check(repo);
    assert.equal(r.status, 'OK', `${repo}: ${JSON.stringify(r.issues)}`);
  }
});

test('external confirmed drift: tektoncd/cli, iamzubin/holdem (live; may be fixed upstream later)', async () => {
  for (const repo of ['tektoncd/cli', 'iamzubin/holdem']) {
    const r = await check(repo);
    assert.equal(r.status, 'DRIFT', `${repo} (if upstream fixed the README this expectation is obsolete)`);
    assert.ok(codes(r, 'DRIFT').includes('STALE_RELEASE_VERSION'));
  }
});

test('template-type repo is AMBIGUOUS, not DRIFT', async () => {
  const r = await check('vasu31dev/playwright-ts-template');
  assert.notEqual(r.status, 'DRIFT');
  assert.ok(codes(r).includes('NPM_PACKAGE_NOT_FOUND'));
});

test('npx github:owner/repo: existing repo -> OK, missing repo -> GITHUB_REPO_NOT_FOUND, no entrypoint -> NOT_CHECKED', async () => {
  const ok = await check('iwadjp/ember', { readmeText: 'npx github:iwadjp/ember scan' });
  assert.equal(ok.status, 'OK');
  assert.equal(ok.summary.checked, 1);
  const bad = await check('iwadjp/ember', { readmeText: 'npx github:iwadjp/this-repo-does-not-exist-xyz' });
  assert.equal(bad.status, 'DRIFT');
  assert.ok(codes(bad, 'DRIFT').includes('GITHUB_REPO_NOT_FOUND'));
  const none = await check('iwadjp/ember', { readmeText: 'Run node tool.cjs' });
  assert.equal(none.status, 'NOT_CHECKED');
});
