/// <reference types="vite/client" />

import type { DesktopApi } from '../main/preload';

declare global {
  interface Window {
    gtvRemote?: DesktopApi;
  }
}

export {};
