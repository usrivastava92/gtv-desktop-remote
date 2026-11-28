import { useEffect, useRef, useState, type ReactNode } from 'react';

import type { AppPreferences, PreferenceChange } from '../shared/preferences';

import { getDesktopApi } from './api';
import { shortcutLabel } from './lib/shortcut';
import { ShortcutRecorder } from './ShortcutRecorder';

export function Preferences({ onClose, children }: { onClose: () => void; children?: ReactNode }) {
  const [preferences, setPreferences] = useState<AppPreferences | null>(null);
  const [shortcut, setShortcut] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [recording, setRecording] = useState(false);
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
        if (event.key === 'Escape' && !busy && !recording) {
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
          disabled={busy || recording}
        >
          Done
        </button>
      </header>
      <div className="ui-settings-content">
        {preferences ? (
          <>
            <section className="ui-settings-group" aria-labelledby="general-heading">
              <h3 id="general-heading" className="ui-settings-section-label">
                General
              </h3>
              <div className="ui-settings-card">
                <label id="login-heading" className="ui-settings-toggle">
                  <span>Launch at login</span>
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
                      recording ||
                      !preferences.launchAtLoginSupported ||
                      preferences.launchAtLogin === null
                    }
                    onChange={(event) => {
                      void change({ launchAtLogin: event.target.checked });
                    }}
                  />
                </label>
                <p
                  id="login-description"
                  className={preferences.launchAtLoginSupported ? 'sr-only' : 'ui-settings-copy'}
                >
                  {!preferences.launchAtLoginSupported
                    ? 'Available in the installed macOS app.'
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
              </div>
            </section>
            <form
              className="ui-settings-group"
              onSubmit={(event) => {
                event.preventDefault();
                void change({ shortcut });
              }}
            >
              <h3 className="ui-settings-section-label">App shortcut</h3>
              <div className="ui-settings-card">
                <div className="ui-settings-shortcut-row">
                  <ShortcutRecorder
                    shortcut={shortcut}
                    disabled={busy}
                    onChange={(value) => {
                      setShortcut(value);
                      setSaved(false);
                    }}
                    onPreferences={setPreferences}
                    onError={setError}
                    onRecording={setRecording}
                  />
                  <button
                    type="submit"
                    className="ui-settings-button ui-settings-save"
                    aria-label="Save shortcut"
                    disabled={busy || recording}
                  >
                    Save
                  </button>
                </div>
              </div>
              <p
                id="shortcut-active"
                className={
                  recording || preferences.activeShortcut !== shortcut
                    ? 'ui-settings-copy ui-settings-footnote'
                    : 'sr-only'
                }
              >
                Active:{' '}
                <span className="ui-settings-value">
                  {recording
                    ? 'Paused while recording'
                    : preferences.activeShortcut
                      ? shortcutLabel(preferences.activeShortcut)
                      : 'Unavailable - use the menu bar'}
                </span>
              </p>
              <details className="ui-settings-help">
                <summary>Shortcut help</summary>
                <p id="shortcut-description">
                  Press modifiers plus a letter, digit, or F1–F24. Escape cancels recording; Tab or
                  leaving the control also cancels. The app shortcut is paused only while recording.
                </p>
              </details>
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
        {children}
      </div>
    </section>
  );
}
