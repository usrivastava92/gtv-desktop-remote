# Development Guide

## Overview

This document is for developers working on GTV Desktop Remote locally. It covers environment setup, prerequisites, common commands, packaging, reset utilities, and how debug telemetry works.

## Prerequisites

- macOS for the desktop app; Linux/Xvfb is supported for mandatory functional CI. Full local macOS IP-migration testing requires an operator-assigned `127.0.0.2` loopback alias; the runner never changes OS networking or skips that case.
- Node.js with Corepack-enabled Yarn
- A Google TV/Android TV on the same LAN only for physical-device interoperability checks; automated functional regression tests require no TV.
- Android TV Remote Service on that physical device when performing hardware checks.

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

For dependency upgrades, run both `yarn typecheck` and `yarn lint` in addition to the
behavioral test suite. Compile-time IPC parity checks use underscore-prefixed constants
without dummy `void` expressions; the lint configuration already permits those names.
Type test doubles with `Mock<ProductionFunction>` and `vi.fn<ProductionFunction>()`
rather than `ReturnType<typeof vi.fn>` so callable signatures remain precise across
Vitest versions.

Dependency updates retain Node 24 and Yarn's minimum package-age gate. Exact owned
releases preapproved in `.yarnrc.yml` are Google TV 1.0.2, Apple TV 1.0.0 and Fire TV
1.1.0. Newly published third-party versions must age normally, without exemptions.
Keep TypeScript within the supported range of `typescript-eslint` (currently
`>=4.8.4 <6.1.0`); a published compiler major alone does not establish lint-toolchain
compatibility. Concurrently 10's CLI requires Node 22 or later and remains compatible
with the Node 24 development scripts.

## Local Build

Build the renderer and Electron bundles without packaging:

```bash
yarn build
```

## Functional Electron Regression Tests

Install the pinned runner dependencies and its video encoder once, build the real app, then run:

```sh
yarn install --immutable
yarn playwright install ffmpeg
yarn build
yarn test:integration
```

Linux needs Xvfb/Xauth, ZIP/unzip and Electron display/audio libraries; use `xvfb-run -a yarn test:integration`. `yarn typecheck:integration` checks runner, native fixtures and emulator, and is also included in `yarn typecheck`.

The runner launches the actual package entry and built renderer, isolates each profile under the OS temporary directory, bootstraps explicit client-certificate trust after an initial refused pairing attempt, and uses genuine TLS plus an independent stateful Google TV model. Chromium fake-device WAV capture exercises production microphone/PCM code. Updates use loopback HTTP and real sandbox ZIP/install/rollback effects, never GitHub, `/Applications`, a live TV or user login/microphone settings.

See [the complete scenario matrix and fidelity boundaries](tests/integration/README.md). Mandatory CI runs the same suite under Xvfb and uploads failure-only traces, screenshots, video and sanitized protocol diagnostics; final build depends on the functional job. This does not certify firmware interoperability or physical macOS permissions/signing/menu-bar behavior.

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

Saved devices are stored in `<userData>/devices.json`. Each write completes a unique
temporary file in the same directory before atomically replacing the store, so
bootstrap reads see the previous complete list (or an empty list before the first
save) until the new complete list is published. Failed writes or replacements leave
the previous store intact and attempt to remove only their own temporary file;
cleanup failures do not mask the original error. Overlapping writes use separate
temporary files, but this is not a read-modify-write transaction: the last successful
replacement wins.

## Multi-TV provider contract

`src/main/device/tvProvider.ts` is the application-owned protocol boundary.
`TvAdapter` owns the saved-device repository, active/pairing device identity,
serialized lifecycle transitions, discovery aggregation, capabilities and IPC
behavior. Each provider owns discovery, protocol sessions, PIN progression,
credential persistence, key mapping, text input, forget/reset and address
migration. Protocol library types never cross preload into the renderer.

To add a platform:

1. Implement `TvProvider` with a stable `id`, display `name`, explicit capabilities,
   discovery and lifecycle/control methods. Map app `RemoteCommand` values inside
   the provider. Reject unsupported operations rather than substituting commands.
2. Return non-secret reconnect metadata in `providerData`; use its `identifier`
   for stable matching across address changes. Identity is scoped to platform,
   so different providers at the same address remain distinct devices.
3. Return a `PairingStep` from `startPairing`. Each `pair` submission returns the
   next step or `undefined` only when fully paired. `DeviceState.pairing` drives
   instructions, code alphabet and length; after a submission the renderer reads
   bootstrap before deciding whether to connect. Failed sessions are closed;
   retry starts a fresh handshake.
4. Register the provider once in `src/main/main.ts` and add its dependency.
   Bootstrap exposes provider names and optional semantic `icon` metadata from
   `TvProvider` via `ProviderDescriptor`. Tokens are app-owned: `assistant`
   (Google Assistant), `apple`, `fire-tv`, or `tv` (generic). The pairing screen
   resolves the device's provider descriptor and renders bundled SVG artwork;
   missing/unknown tokens or providers use the generic TV icon, not Google
   branding. Historical saved devices without a platform still resolve through
   the Google provider descriptor. No platform-specific pairing or control
   branches are needed. `DiscoveredDevice.source` currently enumerates
   discovery origins, so extend that type for a new origin.
5. Exercise the real protocol path, credential restoration, cancellation,
   unsupported commands and platform identity boundaries. Hardware
   interoperability is a separate acceptance gate.

`platform` omitted in historical records means `google-tv`. Apple/Fire credentials
are separate encrypted files under `<userData>/provider-credentials`, keyed by
provider plus saved-device ID. Atomic replacements use owner-only files and
directories. No plaintext fallback is allowed; keychain unavailability is an
explicit pairing error. Google retains its existing certificate store.
`reset:app` and in-app reset remove the new credentials as well.
Apple TV starts a fresh AirPlay/Companion handshake without reading saved credentials
or checking Keychain availability first. Only after both PINs succeed does it request
encrypted persistence; macOS may ask permission to use Keychain at that point.
That OS authorization is not an Apple TV account password. Failure to save remains
an explicit error; credentials are never silently stored in plaintext.

The spike uses `@librecontrol/apple-tv@1.0.0` and
`@librecontrol/fire-tv@1.1.0` through native dynamic ESM imports from the CommonJS
Electron main process. Apple requires a local Yarn patch plus pinned
`@noble/ciphers` for portable ChaCha20-Poly1305: Electron's crypto backend does not
expose that cipher through Node `createCipheriv`. The patch covers pairing AEAD
and Companion frame encryption/decryption without changing the cipher, AAD,
nonce counters or authentication-tag requirements. Fire adds no runtime transitive
dependencies. Apple requires AirPlay then Companion PINs; Fire requires one PIN. Google microphone
behavior is preserved; Apple/Fire microphone controls are intentionally disabled.
Fire has no volume mapping. Fire HTTPS accepts self-signed receiver certificates
by default and does not authenticate the receiver's certificate chain: trusted
LAN only, with no automatic HTTP fallback. An explicit HTTP provider setting is
unencrypted and is used by the loopback protocol fixture.

DIAL-discovered Fire devices call the library's `launchRemote()` once before each
explicit Pair or Connect intent; discovery and direct/mDNS records never activate
the service. A pinned local Fire library patch waits for native TCP acceptance
after DIAL HTTP 201, using the remaining configured timeout (default 5 seconds).
Only refused TCP connections are probed again; timers, sockets and abort listeners
are cleaned up on completion, timeout or cancellation. PIN and control requests
are never retried. TCP acceptance is not API authentication or TLS verification;
the normal native HTTPS request still performs that work. DIAL's reported
`stopped` state is not used as a readiness signal.

Discovery is concurrent across providers and isolates provider failures.
Lifecycle transitions, including scans that can migrate identities, are serialized.
An address/identity migration closes any affected active session and clears its
connected state before migrating; reconnect is explicit. This favors safe session
ownership over transparent handover. Apple re-resolves its advertised service
through the library when pairing/connecting; multicast restrictions can therefore
affect connection even after an earlier scan.

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

Apple TV advertises `home_hold`, mapped to the native library's `homeHold`.
`useHomePress` recognizes keyboard H and pointer holds after 500 ms; the library
then holds the TV/Home key down for 1000 ms. Short gestures send one `home` on
release, while completed holds send one `home_hold` and suppress the later tap.
Pending gestures cancel on blur, pointer cancellation/exit, view/device/settings
changes, disabled controls and unmount. Google TV and Fire TV do not advertise
or accept `home_hold`; their ordinary Home behavior is unchanged.

## Useful Runtime Notes

- The app registers a global tray shortcut: `CmdOrCtrl+Shift+G`
- Saved pairing state lives in the app data directory
- Text input support depends on the capabilities exposed by the current TV app / input surface

### Pairing regression checks

The Android TV bridge constructs the pairing client with a TLS transport error
listener before connecting, so refused connections reject rather than leave the
renderer busy. Failed and cleared pairing sessions close their client.
Certificate-bound hash validation remains enabled.

`src/backend/pairing/__tests__/createPairingClient.test.ts` exercises the actual
client over local TLS: configuration and secret exchange, independently computed
RSA/SHA-256 secret bytes, rejected checksum, refused port, and unanswered request.

```sh
node .yarn/releases/yarn-4.18.0.cjs test src/backend/pairing/__tests__/createPairingClient.test.ts
```

For an Electron smoke check, request pairing with `127.0.0.1` while no service is
listening on port 6467. The failure must clear busy state and allow another attempt.
This checks lifecycle recovery, not real-device compatibility.

To investigate a device-specific certificate-hash failure, collect the client
and TV public certificates from the same failed TLS session, the exact displayed
code, and the TV model/firmware. Public certificates are sufficient; never share
private keys. A screenshot code alone cannot reproduce the certificate-bound hash.

## Repository Notes

- Renderer source: `src/renderer`
- Electron main and preload source: `src/main`
- Shared cross-process types: `src/shared`
- DNS-SD TXT parsing and presentation decoding: `src/backend/discovery/dnsSdEncoding.ts`.
  TXT values are decoded once, and raw whitespace stays within a value until the
  next key boundary. Native browse instance names are already raw UTF-8 and are
  never presentation-decoded, including when used as a fallback device name.
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
3. Run the release-version resolver locally to compute and display the next
   version using the same analyzer and release rules as semantic-release.
4. Ask for confirmation, then dispatch the `Release` workflow via the `gh`
   CLI (falling back to a REST call if `gh` is unavailable and
   `GH_TOKEN`/`GITHUB_TOKEN` is set).
5. Optionally tail the workflow run with `gh run watch`.

You can also trigger the workflow directly from the GitHub Actions UI
("Run workflow" on the `Release` workflow), but the script is preferred because
it shows the next version and commit list before you commit to publishing.

### Intentional next major: v2.0.0

The next manually authorized release from the v1 line is intentionally **v2.0.0**.
This is a product-version decision, not a fabricated `BREAKING CHANGE` commit or
a package-version bump. `scripts/analyze-release-commits.mjs` wraps the normal
Conventional Commit analyzer: if the last release is v1 and there are new commits,
it selects a major release. The local resolver, macOS artifact version, semantic-release
tag, and generated release-note heading all use that same decision.

After the reachable v2.0.0 tag, the policy is automatically inactive: `fix:`,
`perf:`, and `refactor:` select patch; `feat:` selects minor; real breaking changes
select major; documentation-only changes do not release. No commits after a tag
also do not release. An untagged repository retains the normal initial v1.0.0 behavior.

The CI `release-preview` job runs `node --test tests/release/version-policy.test.mjs`.
It compares the actual resolver CLI with the actual semantic-release dry-run and
release-notes generator against both repository history and disposable local Git
fixtures, then checks the post-v2 rules. Publication plugins are excluded; there
are no GitHub credentials, API calls, release tags, or comments. Fixture setup tags
exist only in temporary local repositories. CI checks that dry-runs leave refs unchanged.
The production `Release` workflow remains manual-only with the existing actor
allow-list and production-environment approval gates.

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
4. Move release-sensitive App credentials onto this environment instead of the
   repository-wide secrets:
   - `APP_CLIENT_ID` → **Environment variables** of `production`.
   - `APP_PRIVATE_KEY` → **Environment secrets** of `production`.

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
release and uploads the arm64 and x64 macOS DMGs.

GitHub download labels identify Apple Silicon (ARM64) or Intel (x64), followed by
DMG or ZIP. These display labels are configured in `.releaserc.json`; artifact
filenames retain their `-mac-arm64` or `-mac-x64` suffixes. Homebrew selects the
download through the cask's `on_arm` and `on_intel` blocks, not GitHub labels.

Required setup:

- Create the tap repository: `usrivastava92/homebrew-tap`.
- Use repository-scoped GitHub App tokens for the source repo and the tap repo.
- Store the App client ID in `APP_CLIENT_ID` and the private key in
  `APP_PRIVATE_KEY`.

The workflow normalizes packaged filenames to the expected `GTV Remote-...`
pattern and computes each DMG's checksum. It passes both checksums to the Node
asset resolver as environment variables, matching uploaded assets by digest first
and architecture-specific filename suffix when a digest match is unavailable.
It then renders `Casks/gtv-desktop-remote.rb` with separate downloads for Apple
Silicon and Intel using:

```bash
yarn homebrew:cask --version 0.8.0 --sha256-arm64 <sha256> --artifact-name-arm64 "GTV Remote-0.8.0-mac-arm64.dmg" --sha256-x64 <sha256> --artifact-name-x64 "GTV Remote-0.8.0-mac-x64.dmg"
```

Users can install the published cask with:

```bash
brew install --cask usrivastava92/tap/gtv-desktop-remote
```

The next legitimate release should verify the GitHub Release, the Homebrew tap
update, and the App token setup before publishing again.

## Recommended Developer Flow

1. `yarn install`
2. `yarn dev`
3. Pair with a real device and verify input behavior
4. Run `yarn typecheck`
5. Run `yarn build`
6. Use `yarn pack` or `yarn dist:mac` when packaging needs to be tested
