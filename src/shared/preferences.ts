export interface AppPreferences {
  shortcut: string;
  activeShortcut: string | null;
  shortcutError: string | null;
  launchAtLogin: boolean | null;
  launchAtLoginError: string | null;
  launchAtLoginSupported: boolean;
}

export type PreferenceChange = { shortcut: string } | { launchAtLogin: boolean };

export interface PreferenceResult {
  preferences: AppPreferences;
  error: string | null;
}
