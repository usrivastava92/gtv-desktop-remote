/// <reference types="vite/client" />

import type { DesktopApi } from '../shared/desktopApi';

declare global {
  interface Window {
    gtvRemote?: DesktopApi;
  }
}

export {};
