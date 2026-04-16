# GTV Desktop Remote

![GTV Desktop Remote icon](assets/icons/gtv-remote-icon.svg)

macOS-first desktop remote for Google TV and Android TV devices.

## First Cut

This repo currently includes:

- Local network scan
- Save, pair, connect, and forget devices
- Basic remote controls
- Keyboard shortcuts for remote buttons
- Text input

## Requirements

1. Ensure the TV has Android TV Remote Service available.

## Development

```bash
npm install
npm run dev
```

To build the renderer and Electron bundles without packaging:

```bash
npm run build
```

To create a local unpacked bundle for smoke testing:

```bash
npm run pack
```

To create a local macOS distributable without publishing it:

```bash
npm run dist:mac
```

The tray shortcut is `CmdOrCtrl+Shift+G`.

To reset saved devices and pairing certificates:

```bash
npm run reset:app
```

To preview what would be removed without deleting anything:

```bash
npm run reset:app:dry-run
```

## Icon Assets

- Primary source icon: `assets/icons/gtv-remote-icon.svg`
- Renderer favicon assets: `public/favicon.svg`, `public/favicon-32.png`, `public/favicon-16.png`
- macOS app bundle icon: `build/icon.icns`

## Release Pipeline

This repository now ships macOS builds through GitHub Actions using `electron-builder`.

- `CI` runs on pushes and pull requests and validates `npm ci`, `npm run typecheck`, and `npm run build`.
- `Release` runs on macOS.
- A manual `workflow_dispatch` run builds the macOS DMG and ZIP and uploads them as workflow artifacts for inspection.
- Pushing a tag that matches `vX.Y.Z` builds the same artifacts and publishes them to a draft GitHub Release.

The first release target is macOS only.

- macOS distribution format: DMG, with ZIP also generated for updater compatibility later.
- Windows target planned later: NSIS installer.
- Linux target planned later: AppImage.

## Versioning

Use `package.json` as the source of truth for the app version.

1. Update the version in `package.json`.
2. Run the CI checks locally if needed.
3. Commit the version bump.
4. Create and push a matching Git tag in the form `vX.Y.Z`.
5. Let the `Release` workflow publish the tagged build to a draft GitHub Release.
6. Review the release notes and attached artifacts in GitHub, then publish the draft release.

For example, if `package.json` is `0.2.0`, the release tag should be `v0.2.0`.

## Signing And Notarization

The current workflow produces unsigned macOS artifacts so the release pipeline can be exercised without Apple credentials.

When you are ready to distribute signed builds outside development, add Apple signing and notarization secrets in GitHub Actions and extend the release workflow with certificate import and notarization steps. The current workflow structure is intended to support that addition without redesigning the pipeline.