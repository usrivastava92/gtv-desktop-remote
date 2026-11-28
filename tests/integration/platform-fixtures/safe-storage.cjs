const { Buffer } = require('node:buffer');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

const { app, safeStorage } = require('electron');

// Run in the test session before launching the suite, never against a user's profile.
const profile = mkdtempSync(path.join(tmpdir(), 'gtv-safe-storage-prerequisite-'));
app.setPath('userData', profile);

app.whenReady().then(() => {
  const backend = safeStorage.getSelectedStorageBackend();
  const available = safeStorage.isEncryptionAvailable();
  console.log(`Linux safeStorage prerequisite: backend=${backend}, available=${available}`);
  let exitCode = 0;
  try {
    if (backend !== 'gnome_libsecret' || !available) {
      throw new Error(
        'Expected an unlocked gnome_libsecret backend; plaintext fallback is forbidden'
      );
    }
    const probe = 'non-secret CI encryption prerequisite';
    const encrypted = safeStorage.encryptString(probe);
    if (encrypted.includes(Buffer.from(probe)) || safeStorage.decryptString(encrypted) !== probe) {
      throw new Error('Native safeStorage encryption/decryption did not round-trip');
    }
    console.log('Linux safeStorage prerequisite: native encrypted round-trip passed');
  } catch (error) {
    console.error(`::error::Linux safeStorage prerequisite failed: ${error.message}`);
    exitCode = 1;
  } finally {
    rmSync(profile, { recursive: true, force: true });
    app.exit(exitCode);
  }
});
