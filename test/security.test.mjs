// Offline regression: an optional GitHub token must not reach package registries.
import test from 'node:test';
import assert from 'node:assert/strict';
import { check } from '../src/check.mjs';

test('GET only; optional token goes to GitHub API, never npm or PyPI', async () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.GITHUB_TOKEN;
  const requests = [];
  const token = 'offline-test-sentinel';
  try {
    for (const enabled of [true, false]) {
      requests.length = 0;
      if (enabled) process.env.GITHUB_TOKEN = token;
      else delete process.env.GITHUB_TOKEN;
      globalThis.fetch = async (url, options) => {
        requests.push({ url, options });
        return new Response('', { status: 200 });
      };
      const result = await check('acme/widget', { readmeText: 'npm install widget\npip install widget' });
      assert.equal(result.status, 'OK');
      assert.equal(result.summary.checked, 2);
      assert.equal(requests.length, 4);
      for (const { url, options } of requests) {
        assert.equal(options.method ?? 'GET', 'GET');
        assert.equal(options.body, undefined);
        const headers = new Headers(options.headers);
        assert.equal(headers.get('authorization'), enabled && new URL(url).origin === 'https://api.github.com'
          ? `Bearer ${token}` : null);
      }
      assert.deepEqual(new Set(requests.map(r => new URL(r.url).origin)),
        new Set(['https://api.github.com', 'https://registry.npmjs.org', 'https://pypi.org']));
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = originalToken;
  }
});
