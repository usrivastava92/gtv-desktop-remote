// PR-renderer-3 (Wave 14): extracted getDesktopApi from App.tsx so hooks
// in src/renderer/hooks/ can import it without creating a circular
// dependency on the 2,000-line App component.
//
// This is the ONLY place in the renderer that touches window.gtvRemote.
// All other renderer code must go through this accessor.

import type { DesktopApi } from '../shared/desktopApi';
export type { UpdaterStatus } from '../shared/types';

export function getDesktopApi(): DesktopApi {
  // window.gtvRemote is installed by src/main/preload.ts at startup.
  const api = (window as Window & { gtvRemote?: DesktopApi }).gtvRemote;

  if (!api) {
    throw new Error(
      'Desktop bridge unavailable. Restart the app after the Electron preload finishes compiling.'
    );
  }

  return api;
}
