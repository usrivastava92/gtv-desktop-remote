import { useEffect, useRef, useState } from 'react';

import type { AppPreferences, PreferenceChange } from '../shared/preferences';

import { getDesktopApi } from './api';

export function Preferences({ onClose }: { onClose: () => void }) {
  const [preferences, setPreferences] = useState<AppPreferences | null>(null);
  const [shortcut, setShortcut] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
    let mounted = true;
    void getDesktopApi()
      .getPreferences()
      .then((value) => {
        if (!mounted) return;
        setPreferences(value);
        setShortcut(value.shortcut);
      })
      .catch((reason: unknown) => {
        if (mounted)
          setError(reason instanceof Error ? reason.message : 'Settings could not be loaded.');
      });
    return () => {
      mounted = false;
    };
  }, []);

  async function change(value: PreferenceChange) {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const result = await getDesktopApi().changePreference(value);
      setPreferences(result.preferences);
      setError(result.error);
      if (!result.error) {
        setShortcut(result.preferences.shortcut);
        setSaved(true);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Settings could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby="settings-heading"
      className="ui-settings ui-dragless"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !busy) {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <header className="ui-header ui-settings-header">
        <h2 ref={headingRef} tabIndex={-1} id="settings-heading" className="ui-settings-heading">
          Settings
        </h2>
        <button
          type="button"
          className="ui-settings-button ui-dragless"
          onClick={onClose}
          disabled={busy}
        >
          Done
        </button>
      </header>
      <div className="ui-settings-content">
        {preferences ? (
          <>
            <section className="ui-settings-group" aria-labelledby="login-heading">
              <label id="login-heading" className="ui-settings-toggle">
                <input
                  type="checkbox"
                  checked={preferences.launchAtLogin === true}
                  ref={(node) => {
                    if (node) node.indeterminate = preferences.launchAtLogin === null;
                  }}
                  aria-describedby={
                    preferences.launchAtLoginError
                      ? 'login-description login-state-error'
                      : 'login-description'
                  }
                  disabled={
                    busy ||
                    !preferences.launchAtLoginSupported ||
                    preferences.launchAtLogin === null
                  }
                  onChange={(event) => {
                    void change({ launchAtLogin: event.target.checked });
                  }}
                />
                Launch at login
              </label>
              <p id="login-description" className="ui-settings-copy">
                {!preferences.launchAtLoginSupported
                  ? 'Available in the installed macOS app. Development Electron is never added to Login Items.'
                  : 'Off by default. macOS Login Items settings take precedence.'}
              </p>
              {preferences.launchAtLoginError ? (
                <p
                  id="login-state-error"
                  role="alert"
                  className="ui-settings-message ui-settings-error"
                >
                  {preferences.launchAtLoginError}
                </p>
              ) : null}
            </section>
            <form
              className="ui-settings-group"
              onSubmit={(event) => {
                event.preventDefault();
                void change({ shortcut });
              }}
            >
              <label htmlFor="global-shortcut" className="ui-settings-label">
                Show / hide shortcut
              </label>
              <input
                id="global-shortcut"
                type="text"
                value={shortcut}
                disabled={busy}
                className="ui-settings-input"
                spellCheck={false}
                aria-describedby="shortcut-description shortcut-active"
                onChange={(event) => {
                  setShortcut(event.target.value);
                  setSaved(false);
                }}
              />
              <p id="shortcut-description" className="ui-settings-copy">
                Use modifiers plus a letter, digit, or F1–F24. Example: CommandOrControl+Shift+G.
                Blank shortcuts are not allowed.
              </p>
              <p id="shortcut-active" className="ui-settings-copy">
                Active:{' '}
                <span className="ui-settings-value">
                  {preferences.activeShortcut ?? 'Unavailable — use the menu bar'}
                </span>
              </p>
              <button type="submit" className="ui-settings-button ui-settings-save" disabled={busy}>
                Save shortcut
              </button>
              {preferences.shortcutError ? (
                <p role="alert" className="ui-settings-message ui-settings-error">
                  {preferences.shortcutError}
                </p>
              ) : null}
            </form>
          </>
        ) : (
          <p className="ui-settings-copy">
            {error ? 'Settings are unavailable.' : 'Loading settings…'}
          </p>
        )}
        {error ? (
          <p role="alert" className="ui-settings-message ui-settings-error">
            {error}
          </p>
        ) : null}
        {saved ? (
          <p role="status" className="ui-settings-message ui-settings-success">
            Settings saved.
          </p>
        ) : null}
      </div>
    </section>
  );
}
