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
