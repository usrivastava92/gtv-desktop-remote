#!/usr/bin/env node

import { execFileSync } from 'node:child_process';

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function parseVersion(tag) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(tag);

  if (!match) {
    throw new Error(`Unsupported version tag: ${tag}`);
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function formatVersion({ major, minor, patch }) {
  return `${major}.${minor}.${patch}`;
}

function incrementVersion(version, releaseType) {
  if (releaseType === 'major') {
    return { major: version.major + 1, minor: 0, patch: 0 };
  }

  if (releaseType === 'minor') {
    return { major: version.major, minor: version.minor + 1, patch: 0 };
  }

  if (releaseType === 'patch') {
    return { major: version.major, minor: version.minor, patch: version.patch + 1 };
  }

  return version;
}

function releaseTypeForMessage(message) {
  const [header = ''] = message.split('\n');
  const trimmedHeader = header.trim();
  const body = message.toLowerCase();

  if (
    /!\s*:/.test(trimmedHeader) ||
    body.includes('breaking change:') ||
    body.includes('breaking changes:')
  ) {
    return 'major';
  }

  const typeMatch = /^([a-z]+)(\([^)]+\))?!?:/.exec(trimmedHeader);
  const type = typeMatch?.[1];

  if (type === 'feat') {
    return 'minor';
  }

  if (type === 'fix' || type === 'perf' || type === 'refactor') {
    return 'patch';
  }

  return null;
}

function maxReleaseType(current, next) {
  const rank = { patch: 1, minor: 2, major: 3 };

  if (!current) {
    return next;
  }

  if (!next) {
    return current;
  }

  return rank[next] > rank[current] ? next : current;
}

const headRef = process.argv[2] || 'HEAD';
let lastTag;

try {
  lastTag = git(['describe', '--tags', '--abbrev=0', '--match', 'v*', headRef]);
} catch {
  lastTag = '';
}

const range = lastTag ? `${lastTag}..${headRef}` : headRef;
const rawMessages = git(['log', '--format=%B%x1e', '--no-merges', range]);
const messages = rawMessages
  .split('\x1e')
  .map((message) => message.trim())
  .filter(Boolean);

let releaseType = null;

for (const message of messages) {
  releaseType = maxReleaseType(releaseType, releaseTypeForMessage(message));
}

const previousVersion = lastTag ? parseVersion(lastTag) : { major: 0, minor: 0, patch: 0 };
const nextVersion = releaseType ? incrementVersion(previousVersion, releaseType) : previousVersion;
const willRelease = releaseType !== null;
const initialRelease = !lastTag && willRelease;

process.stdout.write(
  JSON.stringify(
    {
      lastTag,
      releaseType,
      willRelease,
      version: initialRelease ? '1.0.0' : formatVersion(nextVersion),
      commitCount: messages.length,
    },
    null,
    2
  )
);
