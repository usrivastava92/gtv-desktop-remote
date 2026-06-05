#!/usr/bin/env node

const DEFAULT_REPOSITORY = 'usrivastava92/gtv-desktop-remote';
const CASK_TOKEN = 'gtv-desktop-remote';
const APP_NAME = 'GTV Remote.app';

function parseArgs(argv) {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected argument: ${arg}`);
    }

    const key = arg.slice(2);
    const value = argv[index + 1];

    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for --${key}`);
    }

    args[key] = value;
    index += 1;
  }

  return args;
}

function requireArg(args, key) {
  if (!args[key]) {
    throw new Error(`Missing required argument --${key}`);
  }

  return args[key];
}

function releaseAssetUrl(repository, version, artifactName) {
  const encodedArtifactName = encodeURIComponent(artifactName);
  return `https://github.com/${repository}/releases/download/v${version}/${encodedArtifactName}`;
}

function renderCask({ version, sha256, artifactName, repository }) {
  return `cask "${CASK_TOKEN}" do
  version "${version}"
  sha256 "${sha256}"

  url "${releaseAssetUrl(repository, version, artifactName)}"
  name "GTV Remote"
  desc "Desktop remote for Google TV and Android TV"
  homepage "https://github.com/${repository}"

  app "${APP_NAME}"

  postflight do
    system_command "/usr/bin/xattr",
                   args: ["-dr", "com.apple.quarantine", "#{appdir}/${APP_NAME}"]
  end

  caveats do
    <<~EOS
      GTV Remote is open source and intentionally not notarized - we don't pay
      Apple's $99/year gatekeeping tax to ship free software.

      This cask automatically removes the quarantine flag during install, so the
      app should launch normally. If macOS still blocks launch, run:

        sudo xattr -dr com.apple.quarantine "/Applications/${APP_NAME}"

      If launch is still blocked after that, use:
        System Settings -> Privacy & Security -> Open Anyway
    EOS
  end

  zap trash: [
    "~/Library/Application Support/GTV Remote",
    "~/Library/Preferences/com.utkarsh.gtvdesktopremote.plist",
    "~/Library/Saved Application State/com.utkarsh.gtvdesktopremote.savedState",
  ]
end
`;
}

try {
  const args = parseArgs(process.argv.slice(2));
  const version = requireArg(args, 'version');
  const sha256 = requireArg(args, 'sha256');
  const artifactName = requireArg(args, 'artifact-name');
  const repository = args.repository || DEFAULT_REPOSITORY;

  process.stdout.write(renderCask({ version, sha256, artifactName, repository }));
} catch (error) {
  console.error(error.message);
  console.error(
    'Usage: node scripts/render-homebrew-cask.mjs --version 1.2.3 --sha256 <sha256> --artifact-name <asset.dmg> [--repository owner/repo]'
  );
  process.exit(1);
}
