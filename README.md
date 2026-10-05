# readme-entry-check

A small, dependency-free, read-only CLI for checking semantic drift between
README install/download entry points and their public GitHub, npm or PyPI state.
No AI or LLM is used.

## What it does

A broken-link checker asks whether a URL responds. This checker compares a few
machine-readable README references with release metadata and package registries.
A README can advertise the latest download while linking to an older release
that still returns HTTP 200. That fixed older version can be flagged here.

Simple version comparisons and nearby context heuristics are used. The checker
does not understand arbitrary prose or prove that an installation works.
Review findings before acting on them.

## Installation and usage

Requires Node.js 22 or newer and network access. Tested on Node.js 24.
Once this repository is published on GitHub:

```sh
git clone https://github.com/iwadjp/readme-entry-check.git
cd readme-entry-check
node src/cli.mjs iwadjp/agent-rules-linter
```

There are no dependencies to install. This project is not published on npm.

Check several public repositories, using owner/repo or GitHub URLs:

```sh
node src/cli.mjs iwadjp/agent-rules-linter https://github.com/iwadjp/wol-light
```

Use a local README or Markdown documentation file instead of fetching the README:

```sh
node src/cli.mjs iwadjp/wol-light --readme-file ./fixtures/wollight-before-45205ed.md
```

`--readme-file` replaces only the README input; public state is still fetched.
Use it with one repository: the same file is applied to every repository if you
supply several. Paths are resolved from the current working directory.

Illustrative output for a fictional repository (not a claim about a real project):

```text
DRIFT  acme/widget  (checked entrypoints: 1; release refs 1, npm 0, pip 0, github: 0; latest v1.2.0)
  [DRIFT] STALE_RELEASE_VERSION
    README : v1.1.0/widget-v1.1.0.zip
    actual : latest release v1.2.0
    basis  : line 12
```

## Supported checks

| Input recognized in the README | Public state checked |
|---|---|
| Fixed GitHub release tag/download URLs for the target repo; selected versioned asset filenames | Numeric version versus GitHub's latest release; asset name versus latest release assets |
| npm install, npm i, npm add, npx | Package existence on npm |
| pip install, pip3 install, pipx install, including python -m pip install | Package existence on PyPI |
| npx github:owner/repo and supported npm install/i/add github:owner/repo forms | Referenced GitHub repository existence |

Findings include `STALE_RELEASE_VERSION`, `RELEASE_ASSET_NOT_FOUND`,
`README_NEWER_THAN_LATEST`, `NPM_PACKAGE_NOT_FOUND`, `PYPI_PACKAGE_NOT_FOUND`,
and `GITHUB_REPO_NOT_FOUND`. Registry checks test package existence, not whether a
requested package version, executable, or dependency set is available.

## Status and exit codes

| Status | Meaning |
|---|---|
| OK | At least one recognized reference was checked, with no finding. |
| DRIFT | A supported comparison found a mismatch. Human review is still appropriate. |
| AMBIGUOUS | A possible mismatch needs interpretation: for example, an intentionally older release or a package/bin name belonging to another project. |
| NOT_CHECKED | No supported reference could be checked. No clean bill of health is implied. |
| ERROR | A reported fetch/API/registry error prevented normal checking. |

**NOT_CHECKED != OK.** Even OK applies only to the checked references, not the
whole README. Status precedence is ERROR, DRIFT, AMBIGUOUS, then
OK/NOT_CHECKED; findings remain visible when a higher-priority status wins.

The checked count includes recognized dependency package names and comparable
release/file references. Repeated npm/PyPI package names and GitHub repository
names are deduplicated; separate release references can each count. It is not a
count of unique installation methods or successful installations.

- Exit 0: no DRIFT or reported ERROR; this includes AMBIGUOUS and NOT_CHECKED.
- Exit 1: at least one DRIFT, without a reported ERROR.
- Exit 2: at least one reported ERROR, or no repository argument.

Malformed arguments, unreadable local files, or thrown transport errors can instead
terminate with a Node.js exception and a nonzero exit code.

## Limitations

This is **not a whole-README checker**, a general broken-link checker, or a
complete installation audit.

- No Homebrew, Docker, cargo/crates.io, Go, Maven/Gradle, NuGet, F-Droid, pnpm/yarn,
  local Node scripts, or PowerShell installation checks.
- Generic unversioned release links such as /releases and /releases/latest are
  not checked. Tags such as nightly cannot be compared numerically.
- Version comparison extracts numeric components; it is not full SemVer,
  compatibility analysis, or a reliable interpretation of prerelease intent.
- Release URL checks concern the target repository and GitHub's latest release.
  Arbitrary downloads, historical asset availability, and linked documentation
  pages are not crawled.
- Extraction is heuristic. It can miss quoted, multiline or unusual commands,
  skips some example/placeholder text, and can misinterpret context.
- Package and GitHub repository existence does not prove installability,
  executable availability, safety, or version/ref availability.
- API limits and changing upstream state can affect results. There are no retries
  or network timeouts configured by the tool.

There is no automatic fixing, PR creation, GitHub Action, scheduled monitoring,
GUI, or hosted service.

## Safety and optional authentication

The checker only makes HTTP GET requests to public GitHub API, npm registry and
PyPI endpoints. It does not install packages, run README commands, clone inspected
repositories, modify files or repositories, or download/run release binaries.
Local README text is read locally; extracted identifiers are used in API/registry
requests. There is no telemetry or separate reporting service.

No secret or account is required. An optional `GITHUB_TOKEN` environment variable
raises the GitHub API rate limit. It is sent only to https://api.github.com,
never to npm or PyPI. Set it through your shell or secret manager; do not put it
in source files, example commands, or committed files. .env files are not loaded.

Use public repositories as targets. The checker does not distinguish a nonexistent
repository from one inaccessible to the supplied credentials.

## Tests and evaluation

```sh
npm test              # offline unit and authentication safety tests
npm run test:network  # existing live acceptance tests; GET only
```

The network suite uses fixed regression README inputs and existing public repos.
It can fail when an upstream README, release, package or API response changes;
such failures need interpretation rather than silently changing expectations.
An optional GITHUB_TOKEN can avoid unauthenticated rate limits.

The checker has been used on the author's own public repositories and evaluated
on separate public-repository samples. Those small evaluations are not a general
precision or coverage guarantee. Historical regression fixtures are retained;
see [fixture provenance and license notices](THIRD-PARTY-NOTICES.md).

## License

MIT. See [LICENSE](LICENSE) and [fixture notices](THIRD-PARTY-NOTICES.md).
