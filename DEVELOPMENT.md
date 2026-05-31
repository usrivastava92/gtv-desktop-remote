# Development Guide

## Overview

This document is for developers working on GTV Desktop Remote locally. It covers environment setup, prerequisites, common commands, packaging, reset utilities, and how debug telemetry works.

## Prerequisites

- macOS
- Node.js with Corepack-enabled Yarn
- A Google TV or Android TV device on the same local network for end-to-end testing
- Android TV Remote Service available on the target device

## Install Dependencies

```bash
corepack enable
yarn install
```

## Local Development

Run the renderer, Electron main process, and Electron preload build in watch mode:

```bash
yarn dev
```

This starts:

- Vite for the renderer
- TypeScript watch compilation for the Electron process
- Electron once the required bundles are ready

## Type Checking

```bash
yarn typecheck
```

## Local Build

Build the renderer and Electron bundles without packaging:

```bash
yarn build
```

## Packaging

Create a local unpacked app bundle for smoke testing:

```bash
yarn pack
```

Create local macOS distributables without publishing:

```bash
yarn dist:mac
```

## Resetting Local App State

Remove saved devices and pairing certificates:

```bash
yarn reset:app
```

Preview what would be removed without deleting anything:

```bash
yarn reset:app:dry-run
```

## Debug Telemetry

The app contains command and transport tracing that is useful during debugging.

Current behavior:

- Development runs: telemetry is enabled by default
- Packaged production runs: telemetry is disabled by default
- Packaged debug runs: telemetry can be explicitly enabled

You can enable debug telemetry for a packaged run in either of these ways:

```bash
GTV_REMOTE_DEBUG=1 /path/to/GTV\ Remote.app/Contents/MacOS/GTV\ Remote
```

```bash
/path/to/GTV\ Remote.app/Contents/MacOS/GTV\ Remote --debug
```

You can also use:

```bash
/path/to/GTV\ Remote.app/Contents/MacOS/GTV\ Remote --debug-telemetry
```

Accepted truthy values for `GTV_REMOTE_DEBUG` are:

- `1`
- `true`
- `yes`
- `on`

## Keyboard Input Behavior

The renderer uses a bounded command queue for remote key dispatch.

- Each key press becomes its own queued command
- The queue allows short bursts to be absorbed cleanly
- The queue size is capped at `100`
- Once the queue is full, new key presses are dropped

This is intentional so short navigation bursts remain responsive while sustained input spam is bounded.

## Useful Runtime Notes

- The app registers a global tray shortcut: `CmdOrCtrl+Shift+G`
- Saved pairing state lives in the app data directory
- Text input support depends on the capabilities exposed by the current TV app / input surface

## Repository Notes

- Renderer source: `src/renderer`
- Electron main and preload source: `src/main`
- Shared cross-process types: `src/shared`
- Packaging output: `release`

## Release Workflow

Releases are produced by the `Release` GitHub Actions workflow
(`.github/workflows/release.yml`), driven by
[semantic-release](https://semantic-release.gitbook.io/) and
[Conventional Commits](https://www.conventionalcommits.org/). Packaging is
handled by `electron-builder`.

### Manual, batched releases

The workflow is **manually triggered** — it no longer fires on every push to
`main`. This lets you batch several commits into a single release instead of
producing a new GitHub Release per commit.

Use the helper script:

```bash
# Preview the next version from commits on origin/main, then prompt before
# triggering the Release workflow on GitHub:
yarn release

# Just preview locally, do not trigger CI:
yarn release:dry-run

# Skip the confirmation prompt (e.g. for use in other automation):
bin/release --yes

# Trigger against a non-main ref:
bin/release --ref some-branch
```

The script will:

1. Verify you are in a clean checkout that is in sync with `origin/<ref>`.
2. List the commits that will be included since the last release tag.
3. Run `semantic-release --dry-run` locally to compute and display the next
   version (based on `feat:` / `fix:` / `BREAKING CHANGE:` etc.).
4. Ask for confirmation, then dispatch the `Release` workflow via the `gh`
   CLI (falling back to a REST call if `gh` is unavailable and
   `GH_TOKEN`/`GITHUB_TOKEN` is set).
5. Optionally tail the workflow run with `gh run watch`.

You can also trigger the workflow directly from the GitHub Actions UI
("Run workflow" on the `Release` workflow), but the script is preferred because
it shows the next version and commit list before you commit to publishing.

### What CI does on each push

- The `CI` workflow validates install, typecheck, lint, format, and build for
  every push and pull request.
- The `Release` workflow only runs on manual dispatch and is responsible for
  building the macOS DMG + ZIP, running semantic-release, and updating the
  Homebrew tap.

### Who can trigger a release

The `Release` workflow is locked down with **two layers**:

1. **Actor allow-list (fast-fail).** The `authorize` job in `release.yml`
   reads `RELEASE_ALLOWED_ACTORS` and fails the run immediately if the
   triggering user is not on the list. Update this env var in the workflow
   file (in a PR you review) to grant or revoke access.
2. **GitHub Environment approval (hard, GitHub-enforced).** Both jobs declare
   `environment: production`. GitHub will pause the run and require an
   approval from a configured reviewer before any build, publish, or
   Homebrew-tap update step runs.

#### One-time setup for the `production` environment

In the repo on GitHub:

1. **Settings → Environments → New environment** → name it `production`.
2. Enable **Required reviewers** and add yourself (and only yourself, or
   whoever should be able to approve releases).
3. Under **Deployment branches and tags**, choose "Selected branches and
   tags" and add `main` (so releases can only be approved from `main`).
4. Move release-sensitive secrets onto this environment instead of the
   repository-wide secrets:
   - `HOMEBREW_TAP_TOKEN` → **Environment secrets** of `production`.
   - (Optional) `HOMEBREW_TAP_REPOSITORY` → **Environment variables** of
     `production`.

   This guarantees the secret is only injected after you click "Approve and
   run", so an unauthorized or accidental dispatch cannot exfiltrate it.

After this setup, the flow for a release is:

1. Someone (you) runs `yarn release` or "Run workflow" in the Actions UI.
2. `authorize` job runs in seconds and either fails (unauthorized) or
   succeeds.
3. The run pauses with a "Review required" banner — GitHub emails the
   reviewer(s).
4. You click **Approve and run** → `build-macos` and `release` proceed and
   publish exactly one GitHub Release for the batched commits.

## Homebrew Cask Releases

Homebrew installation is published through a tap repository. The release workflow
updates `usrivastava92/homebrew-tap` after semantic-release creates a GitHub
release and uploads the macOS DMG.

Required setup:

- Create the tap repository: `usrivastava92/homebrew-tap`
- Add a repository secret named `HOMEBREW_TAP_TOKEN` with permission to push to
  that tap repository
- Optionally set a repository variable named `HOMEBREW_TAP_REPOSITORY` if the
  tap repository is not `usrivastava92/homebrew-tap`

The workflow computes the DMG checksum and renders
`Casks/gtv-desktop-remote.rb` using:

```bash
yarn homebrew:cask --version 0.8.0 --sha256 <sha256> --artifact-name "GTV Remote-0.8.0-mac-arm64.dmg"
```

Users can install the published cask with:

```bash
brew install --cask usrivastava92/tap/gtv-desktop-remote
```

## Recommended Developer Flow

1. `yarn install`
2. `yarn dev`
3. Pair with a real device and verify input behavior
4. Run `yarn typecheck`
5. Run `yarn build`
6. Use `yarn pack` or `yarn dist:mac` when packaging needs to be tested
