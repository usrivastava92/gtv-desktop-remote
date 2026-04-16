# Development Guide

## Overview

This document is for developers working on GTV Desktop Remote locally. It covers environment setup, prerequisites, common commands, packaging, reset utilities, and how debug telemetry works.

## Prerequisites

- macOS
- Node.js and npm
- A Google TV or Android TV device on the same local network for end-to-end testing
- Android TV Remote Service available on the target device

## Install Dependencies

```bash
npm install
```

## Local Development

Run the renderer, Electron main process, and Electron preload build in watch mode:

```bash
npm run dev
```

This starts:

- Vite for the renderer
- TypeScript watch compilation for the Electron process
- Electron once the required bundles are ready

## Type Checking

```bash
npm run typecheck
```

## Local Build

Build the renderer and Electron bundles without packaging:

```bash
npm run build
```

## Packaging

Create a local unpacked app bundle for smoke testing:

```bash
npm run pack
```

Create local macOS distributables without publishing:

```bash
npm run dist:mac
```

## Resetting Local App State

Remove saved devices and pairing certificates:

```bash
npm run reset:app
```

Preview what would be removed without deleting anything:

```bash
npm run reset:app:dry-run
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

This project uses `electron-builder` for packaging.

- CI validates install, typecheck, and build
- Tagged releases are intended to produce macOS artifacts
- The current target platform is macOS

## Recommended Developer Flow

1. `npm install`
2. `npm run dev`
3. Pair with a real device and verify input behavior
4. Run `npm run typecheck`
5. Run `npm run build`
6. Use `npm run pack` or `npm run dist:mac` when packaging needs to be tested