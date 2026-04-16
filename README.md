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