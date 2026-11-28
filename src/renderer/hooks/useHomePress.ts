import { useCallback, useLayoutEffect, useRef } from 'react';
import type { MouseEvent, PointerEvent } from 'react';

import type { RemoteCommand, RemoteCommandSource } from '../../shared/types';
import { isEditableTarget } from '../lib/pure';

const HOME_HOLD_DELAY_MS = 500;

interface HomePressOptions {
  enabled: boolean;
  holdSupported: boolean;
  contextKey: string;
  onCommand: (command: RemoteCommand, source: RemoteCommandSource) => void;
}

interface Press {
  source: RemoteCommandSource;
  pointerId?: number;
  held: boolean;
  timer: number;
}

/** Home alone delays its tap until release on devices advertising a hold command. */
export function useHomePress(options: HomePressOptions) {
  const optionsRef = useRef(options);
  const pressRef = useRef<Press | null>(null);

  const cancel = useCallback(() => {
    if (pressRef.current) window.clearTimeout(pressRef.current.timer);
    pressRef.current = null;
  }, []);

  // Commit the latest dispatch closure without cancelling a gesture on ordinary rerenders.
  // Layout cleanup cancels before a timer can observe a changed device/view/availability.
  useLayoutEffect(() => {
    optionsRef.current = options;
  });
  useLayoutEffect(
    () => cancel,
    [cancel, options.enabled, options.holdSupported, options.contextKey]
  );

  const begin = useCallback((source: RemoteCommandSource, pointerId?: number) => {
    if (pressRef.current || !optionsRef.current.enabled) return;
    const press: Press = {
      source,
      pointerId,
      held: false,
      timer: window.setTimeout(() => {
        if (pressRef.current !== press) return;
        press.held = true;
        optionsRef.current.onCommand('home_hold', source);
      }, HOME_HOLD_DELAY_MS),
    };
    pressRef.current = press;
  }, []);

  const release = useCallback(
    (source: RemoteCommandSource, pointerId?: number) => {
      const press = pressRef.current;
      if (press?.source !== source || press.pointerId !== pointerId) return;
      cancel();
      if (!press.held && optionsRef.current.enabled) {
        optionsRef.current.onCommand('home', source);
      }
    },
    [cancel]
  );

  useLayoutEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const current = optionsRef.current;
      if (
        event.key.toLowerCase() !== 'h' ||
        !current.enabled ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        isEditableTarget(event.target)
      )
        return;
      event.preventDefault();
      if (!current.holdSupported) {
        current.onCommand('home', 'keyboard');
      } else if (!event.repeat) {
        begin('keyboard');
      }
    }
    function onKeyUp(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== 'h') return;
      if (pressRef.current?.source === 'keyboard') event.preventDefault();
      release('keyboard');
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', cancel);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', cancel);
      cancel();
    };
  }, [begin, cancel, release]);

  function cancelPointerOutside(event: PointerEvent<HTMLButtonElement>) {
    const press = pressRef.current;
    if (press?.source !== 'button' || press.pointerId !== event.pointerId) return false;
    // Touch implicitly captures its pointer, so leaving the button need not emit pointerleave.
    const bounds = event.currentTarget.getBoundingClientRect();
    const outside =
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom;
    if (outside) cancel();
    return outside;
  }

  return {
    onPointerDown(event: PointerEvent<HTMLButtonElement>) {
      if (!optionsRef.current.enabled || !optionsRef.current.holdSupported || event.button !== 0)
        return;
      begin('button', event.pointerId);
    },
    onPointerMove: cancelPointerOutside,
    onPointerUp(event: PointerEvent<HTMLButtonElement>) {
      if (cancelPointerOutside(event)) return;
      release('button', event.pointerId);
    },
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onLostPointerCapture: cancel,
    onClick(event: MouseEvent<HTMLButtonElement>) {
      const current = optionsRef.current;
      if (!current.enabled) return;
      // Pointer releases already dispatched their intent. detail=0 preserves keyboard/AT clicks.
      const pointerType = (event.nativeEvent as globalThis.PointerEvent).pointerType;
      if (current.holdSupported && (event.detail > 0 || pointerType)) return;
      current.onCommand('home', 'button');
    },
  };
}
