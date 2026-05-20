/// <reference types="vite/client" />

// PR-5c: renderer no longer reaches into `../main/preload` for its type
// surface — `DesktopApi` lives in `src/shared/desktopApi.ts` and is derived
// from the typed IPC contract. This removes a long-standing renderer →
// main layering violation.
import type { DesktopApi } from '../shared/desktopApi';

declare global {
  interface Window {
    gtvRemote?: DesktopApi;
  }
}

export {};
