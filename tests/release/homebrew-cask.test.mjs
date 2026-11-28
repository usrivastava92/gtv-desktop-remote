import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const generator = fileURLToPath(new URL('../../scripts/render-homebrew-cask.mjs', import.meta.url));
const version = '3.0.0';
const armHash = 'a'.repeat(64);
const intelHash = 'b'.repeat(64);
const armAsset = 'GTV Remote-3.0.0-arm64.dmg';
const intelAsset = 'GTV Remote-3.0.0-x64.dmg';

function generate(args) {
  return execFileSync(process.execPath, [generator, '--version', version, ...args], {
    encoding: 'utf8',
  });
}

// Use Homebrew's actual DSL and artifact runner, including subprocess runners.
// Only the postflight artifact executes, against quarantined temporary fixtures.
const parseCask = String.raw`
require "json"
require "cask/cask_loader"
require "simulate_system"
require "stringio"
require "fileutils"
require "open3"

def xattr(*args)
  stdout, stderr, status = Open3.capture3("/usr/bin/xattr", *args)
  raise "xattr #{args.inspect} failed: #{stderr}" unless status.success?
  stdout
end

quarantine = "com.apple.quarantine"
quarantine_value = "0081;00000000;GTVReleaseTest;"
unrelated = "com.gtv.release-test"
unrelated_value = "preserve this attribute"

source = File.read(ARGV.fetch(0))
appdir = ARGV.fetch(1)
modern = Homebrew::InstallSteps::DSL.method_defined?(:run)
expected_mode = ARGV.fetch(2)
raise "Expected #{expected_mode} Homebrew API" unless modern == (expected_mode == "modern")
hook_class = modern ? Cask::Artifact::PostflightSteps : Cask::Artifact::PostflightBlock
results = [:arm, :intel].map do |arch|
  Homebrew::SimulateSystem.with(os: :macos, arch: arch) do
    # Each architecture starts with a quarantined, real app tree. No installation,
    # live tap changes, or writes outside this test's temporary directory occur.
    app = File.join(appdir, "GTV Remote.app")
    nested_dir = File.join(app, "Contents", "Resources")
    payload = File.join(nested_dir, "fixture.txt")
    other_app = File.join(appdir, "Unrelated.app")
    other_payload = File.join(other_app, "fixture.txt")
    FileUtils.mkdir_p([nested_dir, other_app])
    File.write(payload, "target payload")
    File.write(other_payload, "unrelated payload")
    target_paths = [app, File.join(app, "Contents"), nested_dir, payload]
    other_paths = [appdir, other_app, other_payload]
    (target_paths + other_paths).each do |path|
      xattr("-w", quarantine, quarantine_value, path)
      xattr("-w", unrelated, unrelated_value, path)
    end

    verify_fixture = lambda do |target_quarantined|
      (target_paths + other_paths).each do |path|
        expected_quarantine = other_paths.include?(path) || target_quarantined
        attributes = xattr(path).lines.map(&:chomp)
        raise "Incorrect quarantine state on #{path}" unless attributes.include?(quarantine) == expected_quarantine
        if expected_quarantine
          raise "Quarantine changed on #{path}" unless xattr("-p", quarantine, path).strip == quarantine_value
        end
        raise "Unrelated attribute changed on #{path}" unless xattr("-p", unrelated, path).strip == unrelated_value
      end
      raise "Target payload changed" unless File.read(payload) == "target payload"
      raise "Unrelated payload changed" unless File.read(other_payload) == "unrelated payload"
    end
    verify_fixture.call(true)
    config = Cask::Config.new(explicit: { appdir: appdir })
    warnings = StringIO.new
    previous_stderr = $stderr
    begin
      $stderr = warnings
      cask = Cask::CaskLoader::FromContentLoader.new(source).load(config: config)
      # Loading may prefer an installed cask's saved config; keep this test isolated.
      cask.config = config
    ensure
      $stderr = previous_stderr
    end
    raise "Cask loading emitted warnings: #{warnings.string}" unless warnings.string.empty?
    hooks = cask.artifacts.select do |artifact|
      artifact.is_a?(Cask::Artifact::PostflightSteps) || artifact.is_a?(Cask::Artifact::PostflightBlock)
    end
    raise "Expected exactly one #{hook_class} artifact" unless hooks.length == 1 && hooks.first.is_a?(hook_class)

    hook = hooks.first
    hook.install_phase
    verify_fixture.call(false)

    # A replacement app on upgrade/reinstall must be unquarantined again.
    target_paths.each { |path| xattr("-w", quarantine, quarantine_value, path) }
    verify_fixture.call(true)
    hook.install_phase
    verify_fixture.call(false)

    # Postflight must not run while uninstalling.
    target_paths.each { |path| xattr("-w", quarantine, quarantine_value, path) }
    hook.uninstall_phase
    verify_fixture.call(true)
    {
      arch: arch,
      token: cask.token,
      version: cask.version.to_s,
      sha256: cask.sha256.to_s,
      url: cask.url.to_s,
      name: cask.name,
      desc: cask.desc,
      modern: modern,
      lifecycle: ["install", "reinstall", "uninstall"],
    }
  end
end
puts JSON.generate(results)
`;

function parseWithHomebrew(t, source, brew = 'brew', mode = 'modern') {
  const directory = mkdtempSync(join(tmpdir(), 'gtv-cask-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const caskPath = join(directory, 'gtv-desktop-remote.rb');
  const appdir = join(directory, 'Custom Applications');
  writeFileSync(caskPath, source);
  const output = execFileSync(brew, ['ruby', '-e', parseCask, '--', caskPath, appdir, mode], {
    encoding: 'utf8',
    env: {
      ...process.env,
      HOMEBREW_NO_AUTO_UPDATE: '1',
      HOMEBREW_NO_ANALYTICS: '1',
    },
  });
  const results = JSON.parse(output);
  for (const result of results) {
    assert.equal(result.token, 'gtv-desktop-remote');
    assert.equal(result.version, version);
    assert.deepEqual(result.lifecycle, ['install', 'reinstall', 'uninstall']);
  }
  return results;
}

const brewAvailable =
  process.platform === 'darwin' && spawnSync('brew', ['--version']).status === 0;
const homebrewOptions = {
  skip: brewAvailable ? false : 'Requires macOS and Homebrew for actual cask DSL evaluation',
};

// Point at an isolated upstream checkout, never mutate the installed Homebrew.
// An explicitly supplied older runtime must execute and pass, not silently skip.
const compatBrew = process.env.HOMEBREW_COMPAT_BREW;
test('Homebrew 6.0.1 API loads without warnings and executes the legacy postflight', {
  skip: compatBrew ? false : 'Set HOMEBREW_COMPAT_BREW to an isolated Homebrew 6.0.1 bin/brew',
}, (t) => {
  const source = generate([
    '--sha256-arm64', armHash,
    '--artifact-name-arm64', armAsset,
    '--sha256-x64', intelHash,
    '--artifact-name-x64', intelAsset,
  ]);
  const results = parseWithHomebrew(t, source, compatBrew, 'legacy');
  assert.deepEqual(results.map(({ sha256, url }) => ({ sha256, url })), [
    {
      sha256: armHash,
      url: `https://github.com/usrivastava92/gtv-desktop-remote/releases/download/v${version}/${encodeURIComponent(armAsset)}`,
    },
    {
      sha256: intelHash,
      url: `https://github.com/usrivastava92/gtv-desktop-remote/releases/download/v${version}/${encodeURIComponent(intelAsset)}`,
    },
  ]);
});

test('dual-architecture cask parses in Homebrew and preserves both release assets', homebrewOptions, (t) => {
  const source = generate([
    '--sha256-arm64', armHash,
    '--artifact-name-arm64', armAsset,
    '--sha256-x64', intelHash,
    '--artifact-name-x64', intelAsset,
  ]);
  const results = parseWithHomebrew(t, source);
  assert.deepEqual(results.map(({ arch, sha256, url }) => ({ arch, sha256, url })), [
    {
      arch: 'arm',
      sha256: armHash,
      url: `https://github.com/usrivastava92/gtv-desktop-remote/releases/download/v${version}/${encodeURIComponent(armAsset)}`,
    },
    {
      arch: 'intel',
      sha256: intelHash,
      url: `https://github.com/usrivastava92/gtv-desktop-remote/releases/download/v${version}/${encodeURIComponent(intelAsset)}`,
    },
  ]);
});

test('single-asset cask parses in Homebrew with a custom repository', homebrewOptions, (t) => {
  const asset = 'GTV Remote-3.0.0-universal.dmg';
  const source = generate([
    '--sha256', armHash,
    '--artifact-name', asset,
    '--repository', 'example/release-fixture',
  ]);
  for (const result of parseWithHomebrew(t, source)) {
    assert.equal(result.sha256, armHash);
    assert.equal(
      result.url,
      `https://github.com/example/release-fixture/releases/download/v${version}/${encodeURIComponent(asset)}`
    );
  }
});

test('generator rejects incomplete release inputs without emitting a partial cask', () => {
  for (const args of [[], ['--version', version], ['--version', version, '--sha256-arm64', armHash]]) {
    const result = spawnSync(process.execPath, [generator, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /Missing required argument/);
  }
});
