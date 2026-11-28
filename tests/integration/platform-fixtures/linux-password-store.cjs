const { app } = require('electron');

// Playwright 1.64's Electron loader appends password-store=basic through
// app.commandLine after parsing CLI arguments. This later Node preload changes
// only that switch, before Chromium initializes native safeStorage at app ready.
if (process.platform === 'linux') {
  // Electron can retain Node preload arguments in argv. Remove only this
  // consumed pair so the real main entry and singleton child arguments stay intact.
  const preloadIndex = process.argv.findIndex(
    (argument, index) => argument === '--require' && process.argv[index + 1] === __filename
  );
  if (preloadIndex !== -1) process.argv.splice(preloadIndex, 2);
  if (app.isReady()) {
    throw new Error('Linux password-store preload must run before Electron app ready');
  }
  if (app.commandLine.getSwitchValue('password-store') === 'basic') {
    app.commandLine.removeSwitch('password-store');
    app.commandLine.appendSwitch('password-store', 'gnome-libsecret');
  }
}
