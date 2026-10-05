# readme-entry-check (v0 prototype — Reality Check, not a product)

Read-only (GET only), no AI, no dependencies. Compares what a GitHub repo's README tells users to
install/download with the actual public state:

| code | meaning |
|---|---|
| `STALE_RELEASE_VERSION` | README points at a fixed older release/asset version than the latest release |
| `RELEASE_ASSET_NOT_FOUND` | README points at a release asset that is not in that (latest) release |
| `NPM_PACKAGE_NOT_FOUND` | `npm install` / `npx` names a package that is not on the npm registry |
| `PYPI_PACKAGE_NOT_FOUND` | `pip` / `pipx install` names a package that is not on PyPI |

Statuses: `OK` (at least one entrypoint was actually checked and nothing was wrong), `NOT_CHECKED` (no supported entrypoint found; NOT judged OK), `DRIFT` (confirmed), `AMBIGUOUS` (suspicious but intent unclear: intentionally older
version, third-party/bin name, filename outside a download context ...), `ERROR`.
Precision is preferred over recall.

```
node src/cli.mjs owner/repo [owner/repo ...] [--readme-file path]   # exit 1 if any DRIFT
npm test               # pure unit tests
npm run test:network   # acceptance tests (live GitHub/npm/PyPI, GET only)
```

Set `GITHUB_TOKEN` to avoid the unauthenticated GitHub rate limit.

`fixtures/` hold READMEs as they were before the fixes: WolLight `45205ed`, agent-rules-linter `57cceed`.

Out of scope on purpose: crates.io, Maven, NuGet, Homebrew, Docker, F-Droid, version-semantics beyond
"older than latest", README quality, general link checking, fixing, PRs, Actions, scheduling.
