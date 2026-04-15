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

1. Use the project virtual environment or install the Python dependency from `requirements.txt`.
2. Ensure the TV has Android TV Remote Service available.

## Development

```bash
npm install
npm run dev
```

The tray shortcut is `CmdOrCtrl+Shift+G`.

The project venv can be prepared with:

```bash
.venv/bin/python -m pip install -r requirements.txt
```

## Icon Assets

- Primary source icon: `assets/icons/gtv-remote-icon.svg`
- Renderer favicon assets: `public/favicon.svg`, `public/favicon-32.png`, `public/favicon-16.png`
- macOS app bundle icon: `build/icon.icns`