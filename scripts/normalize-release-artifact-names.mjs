#!/usr/bin/env node

import { readdirSync, renameSync } from 'node:fs';
import path from 'node:path';

const RELEASE_DIR = process.argv[2] || 'release';
const DOTTED_PREFIX = 'GTV.Remote-';
const SPACED_PREFIX = 'GTV Remote-';
const RENAMED_EXTENSIONS = new Set(['.dmg', '.zip']);

for (const entry of readdirSync(RELEASE_DIR, { withFileTypes: true })) {
  if (!entry.isFile()) {
    continue;
  }

  const extension = path.extname(entry.name);
  if (!RENAMED_EXTENSIONS.has(extension) || !entry.name.startsWith(DOTTED_PREFIX)) {
    continue;
  }

  const nextName = `${SPACED_PREFIX}${entry.name.slice(DOTTED_PREFIX.length)}`;
  renameSync(path.join(RELEASE_DIR, entry.name), path.join(RELEASE_DIR, nextName));
  process.stdout.write(`${entry.name} -> ${nextName}\n`);
}
