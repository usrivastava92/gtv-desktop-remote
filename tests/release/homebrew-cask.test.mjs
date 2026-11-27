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

// Use Homebrew itself rather than a permissive imitation of its Ruby DSL. Only
// evaluate the hook with a recording SystemCommand: no installer or xattr runs.
const parseCask = String.raw`
require "json"
require "cask/cask_loader"
require "simulate_system"
require "stringio"

class << SystemCommand
  attr_accessor :recorded_calls

  def run!(executable, **options)
    recorded_calls << [executable, options]
    nil
  end
end

source = File.read(ARGV.fetch(0))
appdir = ARGV.fetch(1)
modern = Homebrew::InstallSteps::DSL.method_defined?(:run)
expected_mode = ARGV.fetch(2)
raise "Expected #{expected_mode} Homebrew API" unless modern == (expected_mode == "modern")
hook_class = modern ? Cask::Artifact::PostflightSteps : Cask::Artifact::PostflightBlock
results = [:arm, :intel].map do |arch|
  Homebrew::SimulateSystem.with(os: :macos, arch: arch) do
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

    SystemCommand.recorded_calls = []
    hooks.first.install_phase
    {
      arch: arch,
      token: cask.token,
      version: cask.version.to_s,
      sha256: cask.sha256.to_s,
      url: cask.url.to_s,
      name: cask.name,
      desc: cask.desc,
      modern: modern,
      commands: SystemCommand.recorded_calls,
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
    assert.deepEqual(result.commands, [
      [
        '/usr/bin/xattr',
        {
          args: ['-dr', 'com.apple.quarantine', join(appdir, 'GTV Remote.app')],
          ...(result.modern ? {
            sudo: false,
            env: {},
            input: [],
            print_stdout: false,
            print_stderr: true,
            reset_uid: true,
            chdir: null,
          } : {}),
        },
      ],
    ]);
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
