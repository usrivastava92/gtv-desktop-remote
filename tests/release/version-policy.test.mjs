import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const config = JSON.parse(readFileSync(join(root, '.releaserc.json'), 'utf8'));
// Use the production analyzer, its actual rules, and the production notes generator.
// Never load npm/git/GitHub publication plugins, even in dry-run mode.
const previewPlugins = config.plugins
  .filter((plugin) => {
    const name = Array.isArray(plugin) ? plugin[0] : plugin;
    return (
      name === './scripts/analyze-release-commits.mjs' ||
      name === '@semantic-release/release-notes-generator'
    );
  })
  .map((plugin) => {
    if (Array.isArray(plugin) && plugin[0].startsWith('./')) {
      return [resolve(root, plugin[0]), plugin[1]];
    }
    return plugin;
  });

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'gtv-release-policy-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const cwd = join(directory, 'repository');
  const remote = join(directory, 'remote.git');
  git(directory, 'init', '--initial-branch=main', cwd);
  git(directory, 'init', '--bare', '--initial-branch=main', remote);
  git(cwd, 'config', 'user.name', 'Release policy fixture');
  git(cwd, 'config', 'user.email', 'fixture@example.invalid');
  git(cwd, 'commit', '--allow-empty', '-m', 'chore: initial fixture');
  git(cwd, 'remote', 'add', 'origin', pathToFileURL(remote).href);
  return { cwd, remote };
}

function commit(cwd, message) {
  git(cwd, 'commit', '--allow-empty', '-m', message);
}

async function preview({ cwd, remote }, expectedVersion, expectedType, expectedBase) {
  git(cwd, 'push', 'origin', 'main', '--tags');
  const before = git(cwd, 'show-ref');
  const remoteBefore = git(remote, 'show-ref');
  const info = JSON.parse(
    execFileSync(process.execPath, [join(root, 'scripts/resolve-release-version.mjs')], {
      cwd,
      encoding: 'utf8',
    })
  );
  // Isolate semantic-release's global output hooks from the Node test runner.
  // The child gets no tokens, CI detection variables, or NODE_TEST_CONTEXT.
  const resultPath = join(cwd, '.release-preview-result.json');
  const options = {
    branches: config.branches,
    repositoryUrl: pathToFileURL(remote).href,
    plugins: previewPlugins,
    dryRun: true,
    ci: false,
  };
  execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `
        import { writeFileSync } from 'node:fs';
        import { Writable } from 'node:stream';
        import semanticRelease from ${JSON.stringify(import.meta.resolve('semantic-release'))};
        const [options, resultPath] = JSON.parse(process.argv[1]);
        const sink = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
        const result = await semanticRelease(options, {
          cwd: process.cwd(), env: process.env, stdout: sink, stderr: sink,
        });
        writeFileSync(resultPath, JSON.stringify(result ? { nextRelease: result.nextRelease } : false));
      `,
      JSON.stringify([options, resultPath]),
    ],
    { cwd, env: { PATH: process.env.PATH }, encoding: 'utf8' }
  );
  const result = JSON.parse(readFileSync(resultPath, 'utf8'));
  assert.equal(info.lastTag, expectedBase);
  assert.equal(info.version, expectedVersion);
  assert.equal(info.releaseType, expectedType);
  assert.equal(info.willRelease, expectedType !== null);
  if (expectedType === null) {
    assert.equal(result, false);
  } else {
    assert.equal(result.nextRelease.version, info.version);
    assert.equal(result.nextRelease.type, info.releaseType);
    assert.equal(result.nextRelease.gitTag, `v${expectedVersion}`);
    assert.ok(result.nextRelease.notes.includes(expectedVersion));
  }
  assert.equal(git(cwd, 'show-ref'), before, 'dry-run must not mutate local refs');
  assert.equal(git(remote, 'show-ref'), remoteBefore, 'dry-run must not mutate remote refs');
  console.log(
    JSON.stringify({
      base: expectedBase,
      resolver: info.version,
      semanticRelease: result ? result.nextRelease.version : null,
      releaseType: expectedType,
    })
  );
}

test('obsolete v1 to v2 policy does not override historical conventional releases', async (t) => {
  const repository = fixture(t);
  git(repository.cwd, 'tag', 'v1.6.4');
  commit(repository.cwd, 'fix: preserve existing users');
  await preview(repository, '1.6.5', 'patch', 'v1.6.4');
});

for (const [base, message] of [
  ['2.0.0', 'fix: preserve Google credentials'],
  ['2.1.0', 'feat: add native TV providers'],
  ['2.2.0', 'docs: prepare the multi-TV product release'],
]) {
  test(`intentional product policy selects v3.0.0 from v${base}`, async (t) => {
    const repository = fixture(t);
    git(repository.cwd, 'tag', `v${base}`);
    await preview(repository, base, null, `v${base}`);
    commit(repository.cwd, message);
    await preview(repository, '3.0.0', 'major', `v${base}`);
  });
}

test('one-time policy expires at v3.0.0 and normal patch/minor rules resume', async (t) => {
  const repository = fixture(t);
  git(repository.cwd, 'tag', 'v3.0.0');
  await preview(repository, '3.0.0', null, 'v3.0.0');
  commit(repository.cwd, 'fix: correct remote control');
  await preview(repository, '3.0.1', 'patch', 'v3.0.0');
  git(repository.cwd, 'tag', 'v3.0.1');
  commit(repository.cwd, 'feat: add control');
  await preview(repository, '3.1.0', 'minor', 'v3.0.1');
});

test('post-product documentation does not release', async (t) => {
  const repository = fixture(t);
  git(repository.cwd, 'tag', 'v3.0.0');
  commit(repository.cwd, 'docs: describe controls');
  await preview(repository, '3.0.0', null, 'v3.0.0');
});

test('post-product refactor/perf rules and real breaking changes remain conventional', async (t) => {
  const repository = fixture(t);
  git(repository.cwd, 'tag', 'v3.0.0');
  commit(repository.cwd, 'refactor: simplify controls');
  commit(repository.cwd, 'perf: reduce command latency');
  await preview(repository, '3.0.1', 'patch', 'v3.0.0');
  git(repository.cwd, 'tag', 'v3.0.1');
  commit(repository.cwd, 'feat: replace command API\n\nBREAKING CHANGE: remove the old command API');
  await preview(repository, '4.0.0', 'major', 'v3.0.1');
});

test('untagged repositories retain the normal initial version', async (t) => {
  const repository = fixture(t);
  commit(repository.cwd, 'feat: initial control');
  await preview(repository, '1.0.0', 'minor', '');
});
