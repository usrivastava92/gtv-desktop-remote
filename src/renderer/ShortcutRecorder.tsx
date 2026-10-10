import { useEffect, useRef, useState } from 'react';

import type { AppPreferences } from '../shared/preferences';

import { getDesktopApi } from './api';
import { recordedShortcut, shortcutLabel, shortcutModifiers } from './lib/shortcut';

interface ShortcutRecorderProps {
  shortcut: string;
  disabled: boolean;
  onChange: (shortcut: string) => void;
  onPreferences: (preferences: AppPreferences) => void;
  onError: (error: string | null) => void;
  onRecording: (recording: boolean) => void;
}

export function ShortcutRecorder(props: ShortcutRecorderProps) {
  const callbacks = useRef(props);
  callbacks.current = props;
  const mounted = useRef(false);
  const session = useRef(false);
  const ready = useRef(false);
  const ending = useRef(false);
  const candidate = useRef<{ shortcut: string; code: string; key: string } | null>(null);
  const [recording, setRecording] = useState(false);
  const [preview, setPreview] = useState('');
  const [feedback, setFeedback] = useState('');

  function hasLiveSession(): boolean {
    return mounted.current && session.current;
  }

  useEffect(() => {
    mounted.current = true;
    function cancelOnWindowBlur() {
      void finish();
    }
    window.addEventListener('blur', cancelOnWindowBlur);
    return () => {
      mounted.current = false;
      window.removeEventListener('blur', cancelOnWindowBlur);
      if (session.current) {
        session.current = false;
        void getDesktopApi()
          .setShortcutCapture(false)
          .catch(() => undefined);
      }
    };
    // The session refs own cleanup independently of renders and callback identities.
  }, []);

  async function start() {
    if (session.current || ending.current || props.disabled) return;
    session.current = true;
    ready.current = false;
    setRecording(true);
    setPreview('');
    setFeedback('Preparing to record…');
    callbacks.current.onRecording(true);
    callbacks.current.onError(null);
    try {
      const result = await getDesktopApi().setShortcutCapture(true);
      if (!hasLiveSession()) return;
      callbacks.current.onPreferences(result.preferences);
      if (result.error) {
        callbacks.current.onError(result.error);
        await finish();
        return;
      }
      ready.current = true;
      setFeedback('Press a shortcut. Escape cancels.');
    } catch (reason) {
      if (!hasLiveSession()) return;
      callbacks.current.onError(
        reason instanceof Error ? reason.message : 'Recording could not start.'
      );
      await finish();
    }
  }

  async function finish(shortcut?: string) {
    if (!session.current) return;
    session.current = false;
    ready.current = false;
    candidate.current = null;
    ending.current = true;
    if (mounted.current) setFeedback('Restoring shortcut…');
    try {
      const result = await getDesktopApi().setShortcutCapture(false);
      if (!mounted.current) return;
      callbacks.current.onPreferences(result.preferences);
      callbacks.current.onError(result.error);
      if (shortcut && !result.error) callbacks.current.onChange(shortcut);
      setFeedback(
        shortcut && !result.error
          ? 'Shortcut recorded. Click Save shortcut to apply.'
          : 'Recording cancelled.'
      );
    } catch (reason) {
      if (mounted.current) {
        callbacks.current.onError(
          reason instanceof Error
            ? reason.message
            : 'The shortcut could not be restored. Use the menu bar.'
        );
        setFeedback('Recording stopped. Shortcut restoration could not be confirmed.');
      }
    } finally {
      ending.current = false;
      if (mounted.current) {
        setRecording(false);
        setPreview('');
        callbacks.current.onRecording(false);
      }
    }
  }

  return (
    <>
      <button
        id="global-shortcut"
        type="button"
        className="ui-settings-input"
        disabled={props.disabled}
        aria-label={`Show / hide shortcut: ${shortcutLabel(props.shortcut)}. Record shortcut`}
        aria-describedby="shortcut-description shortcut-active shortcut-recording-status"
        aria-pressed={recording}
        onFocus={() => {
          void start();
        }}
        onClick={() => {
          void start();
        }}
        onBlur={() => {
          void finish();
        }}
        onKeyDown={(event) => {
          if (!recording && !session.current) return;
          if (event.key === 'Tab') {
            event.stopPropagation();
            void finish();
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          if (event.repeat || ending.current) return;
          if (event.key === 'Escape') {
            void finish();
            return;
          }
          if (!ready.current || candidate.current) return;
          const modifiers = shortcutModifiers(event.nativeEvent);
          setPreview(shortcutLabel(modifiers.join('+')));
          if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) {
            setFeedback('Now press a letter, digit, or F1–F24.');
            return;
          }
          const shortcut = recordedShortcut(event.nativeEvent);
          if (!shortcut) {
            setFeedback(
              'Use Ctrl, Alt/Opt, or Cmd/Win with a letter, digit, or F1–F24. This key combination is not supported.'
            );
            return;
          }
          candidate.current = { shortcut, code: event.code, key: event.key };
          setPreview(shortcutLabel(shortcut));
          setFeedback('Release keys to finish recording. Escape cancels.');
        }}
        onKeyUp={(event) => {
          if (!recording) return;
          event.stopPropagation();
          if (event.key !== 'Tab') event.preventDefault();
          const captured = candidate.current;
          if (captured) {
            const matches = captured.code
              ? event.code === captured.code
              : event.key.toLowerCase() === captured.key.toLowerCase();
            if (matches) void finish(captured.shortcut);
            return;
          }
          if (ready.current && ['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) {
            setPreview(shortcutLabel(shortcutModifiers(event.nativeEvent).join('+')));
          }
        }}
      >
        {recording ? preview || 'Press shortcut…' : shortcutLabel(props.shortcut)}
      </button>
      <p id="shortcut-recording-status" role="status" className="ui-settings-copy">
        {feedback || 'Focus or click the shortcut to record keys.'}
      </p>
    </>
  );
}
