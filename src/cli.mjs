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
  throw new Error("no repo given");
}
let code = 0;
for (const r of repos) {
  const res = await check(r, { readmeText: readmeFile ? fs.readFileSync(readmeFile, 'utf8') : undefined });
  const s = res.summary;
  console.log(`${res.status}  ${res.repo}` + (s ? `  (refs: release ${s.releaseRefs}, npm ${s.npm}, pip ${s.pip}; latest ${s.latest})` : ''));
  for (const i of res.issues) console.log(`  [${i.status}] ${i.code}\n    README : ${i.readme}\n    actual : ${i.actual}\n    basis  : ${i.evidence}`);
  if (res.status === 'DRIFT') code = Math.max(code, 1);
  if (res.status === 'ERROR') code = 2;
}
process.exitCode = code;
