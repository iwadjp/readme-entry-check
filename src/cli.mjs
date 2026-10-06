#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { check } from './check.mjs';

async function main(args) {
  const repos = [], readmeFiles = [], seen = new Set();
  for (let index = 0; index < args.length; index++) {
    if (args[index] !== '--readme-file') {
      repos.push(args[index]);
      continue;
    }
    const name = args[++index];
    if (!name || name.startsWith('--')) throw new Error('--readme-file requires a path');
    const resolved = path.resolve(name);
    const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    if (!seen.has(key)) {
      seen.add(key);
      readmeFiles.push({ name, resolved });
    }
  }
  if (!repos.length) throw new Error('no repo given');

  const files = readmeFiles.length ? readmeFiles : [{}];
  for (const file of readmeFiles) {
    try { file.readmeText = fs.readFileSync(file.resolved, 'utf8'); }
    catch (error) { file.error = error.message; }
  }
  let code = 0, checkedTotal = 0;
  const counts = { OK: 0, DRIFT: 0, AMBIGUOUS: 0, NOT_CHECKED: 0, ERROR: 0 };
  for (const repo of repos) {
    for (const file of files) {
      let res;
      try {
        if (file.error) throw new Error(file.error);
        res = await check(repo, { readmeText: file.readmeText });
      } catch (error) {
        res = { repo, status: 'ERROR', issues: [{ status: 'ERROR',
          code: file.error ? 'README_READ_FAILED' : 'CHECK_FAILED',
          readme: file.name ?? '-', actual: error.message, evidence: '' }] };
      }
      const s = res.summary;
      counts[res.status]++;
      if (s) checkedTotal += s.checked;
      const label = files.length > 1 ? ` [README: ${JSON.stringify(file.name)}]` : '';
      console.log(`${res.status}  ${res.repo}${label}` + (s ? `  (checked entrypoints: ${s.checked}; release refs ${s.releaseRefs}, npm ${s.npm}, pip ${s.pip}, github: ${s.github}; latest ${s.latest})` : ''));
      if (res.status === 'NOT_CHECKED') console.log('  no supported entrypoint found in README; NOT judged as OK');
      for (const issue of res.issues) console.log(`  [${issue.status}] ${issue.code}\n    README : ${issue.readme}\n    actual : ${issue.actual}\n    basis  : ${issue.evidence}`);
      if (res.status === 'DRIFT') code = Math.max(code, 1);
      if (res.status === 'ERROR') code = 2;
    }
  }
  if (repos.length > 1 || files.length > 1) {
    const scope = files.length > 1
      ? `${repos.length * files.length} README checks across ${repos.length} repo${repos.length === 1 ? '' : 's'}`
      : `${repos.length} repos`;
    console.log(`\nSUMMARY (${scope}): ` + Object.entries(counts).map(([key, value]) => `${key} ${value}`).join(', ') + `; checked entrypoints total ${checkedTotal}`);
  }
  process.exitCode = code;
}

try { await main(process.argv.slice(2)); }
catch (error) {
  console.error(`usage: readme-entry-check <owner/repo|url>... [--readme-file path]...   (GET only; set GITHUB_TOKEN to raise the rate limit)\n${error.message}`);
  process.exitCode = 2;
}
