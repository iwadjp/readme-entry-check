#!/usr/bin/env node
import fs from 'node:fs';
import { check } from './check.mjs';

const args = process.argv.slice(2);
let readmeFile = null;
const repos = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--readme-file') readmeFile = args[++i]; else repos.push(args[i]);
}
if (!repos.length) {
  console.error('usage: readme-entry-check <owner/repo|url>... [--readme-file path]   (GET only; set GITHUB_TOKEN to raise the rate limit)');
  process.exitCode = 2;
  throw new Error('no repo given');
}
let code = 0;
const counts = { OK: 0, DRIFT: 0, AMBIGUOUS: 0, NOT_CHECKED: 0, ERROR: 0 };
let checkedTotal = 0;
for (const r of repos) {
  const res = await check(r, { readmeText: readmeFile ? fs.readFileSync(readmeFile, 'utf8') : undefined });
  const s = res.summary;
  counts[res.status]++;
  if (s) checkedTotal += s.checked;
  console.log(`${res.status}  ${res.repo}` + (s ? `  (checked entrypoints: ${s.checked}; release refs ${s.releaseRefs}, npm ${s.npm}, pip ${s.pip}, github: ${s.github}; latest ${s.latest})` : ''));
  if (res.status === 'NOT_CHECKED') console.log('  no supported entrypoint found in README; NOT judged as OK');
  for (const i of res.issues) console.log(`  [${i.status}] ${i.code}\n    README : ${i.readme}\n    actual : ${i.actual}\n    basis  : ${i.evidence}`);
  if (res.status === 'DRIFT') code = Math.max(code, 1);
  if (res.status === 'ERROR') code = 2;
}
if (repos.length > 1) {
  console.log(`\nSUMMARY (${repos.length} repos): ` + Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ') + `; checked entrypoints total ${checkedTotal}`);
}
process.exitCode = code;
