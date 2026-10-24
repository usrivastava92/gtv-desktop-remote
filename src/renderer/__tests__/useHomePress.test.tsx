import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import type { CommandDispatchRequest, DeviceCapabilities } from '../../shared/types';
import { useHomePress } from '../hooks/useHomePress';
import { useRemoteSession } from '../hooks/useRemoteSession';

interface HarnessProps {
  capabilities?: DeviceCapabilities;
  device?: string;
  view?: string;
  settingsOpen?: boolean;
  disabled?: boolean;
}

const holdCapabilities: DeviceCapabilities = {
  textInput: false,
  powerToggle: false,
  supportedCommands: ['home', 'home_hold'],
};

function Remote({
  capabilities = holdCapabilities,
  device = 'living-room',
  view = 'remote',
  settingsOpen = false,
  disabled = false,
}: HarnessProps) {
  const { handleCommand } = useRemoteSession();
  const home = useHomePress({
    enabled: view === 'remote' && !settingsOpen && !disabled,
    holdSupported: capabilities.supportedCommands?.includes('home_hold') === true,
    contextKey: `${view}:${device}`,
    onCommand: handleCommand,
  });
  return (
    <>
      <button disabled={disabled} {...home}>
        Home
      </button>
      <input aria-label="Text" />
    </>
  );
}

// Dispatch real DOM pointer events, including properties absent in older jsdom versions.
function pointer(
  target: HTMLElement,
  type: string,
  pointerType = 'mouse',
  pointerId = 1,
  button = 0,
  coordinates = { clientX: 0, clientY: 0 }
) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button, ...coordinates });
  Object.defineProperties(event, {
    pointerId: { value: pointerId },
    pointerType: { value: pointerType },
  });
  fireEvent(target, event);
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

let sendCommand: Mock<(request: CommandDispatchRequest) => Promise<void>>;
function commands() {
  return sendCommand.mock.calls.map(([request]) => [request.command, request.source]);
}

beforeEach(() => {
  vi.useFakeTimers();
  sendCommand = vi
    .fn<(request: CommandDispatchRequest) => Promise<void>>()
    .mockResolvedValue(undefined);
  vi.stubGlobal('gtvRemote', { sendCommand, recordCommandDrop: vi.fn() });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Home press gestures through the remote session queue', () => {
  it('sends one short Home on H release just before the hold boundary', () => {
    render(<Remote />);
    fireEvent.keyDown(window, { key: 'H' });
    advance(499);
    expect(commands()).toEqual([]);
    fireEvent.keyUp(window, { key: 'H' });
    expect(commands()).toEqual([['home', 'keyboard']]);
    advance(1000);
    fireEvent.keyUp(window, { key: 'H' });
    expect(commands()).toHaveLength(1);
  });

  it('holds at exactly 500ms, ignores repeats and sends nothing on long release', () => {
    render(<Remote />);
    fireEvent.keyDown(window, { key: 'h' });
    advance(250);
    fireEvent.keyDown(window, { key: 'h', repeat: true });
    fireEvent.keyDown(window, { key: 'h' });
    advance(249);
    expect(commands()).toEqual([]);
    advance(1);
    expect(commands()).toEqual([['home_hold', 'keyboard']]);
    fireEvent.keyDown(window, { key: 'h', repeat: true });
    advance(2000);
    fireEvent.keyUp(window, { key: 'h' });
    expect(commands()).toEqual([['home_hold', 'keyboard']]);
  });

  it('does not start from an orphan OS repeat, modified shortcut, or editable target', () => {
    render(<Remote />);
    fireEvent.keyDown(window, { key: 'h', repeat: true });
    fireEvent.keyDown(window, { key: 'h', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'h', altKey: true });
    fireEvent.keyDown(window, { key: 'h', metaKey: true });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'h' });
    advance(1000);
    fireEvent.keyUp(window, { key: 'h' });
    expect(commands()).toEqual([]);
  });

  it.each(['mouse', 'touch'])(
    'sends a single %s tap and suppresses the generated click',
    (type) => {
      render(<Remote />);
      const button = screen.getByRole('button');
      pointer(button, 'pointerdown', type);
      advance(499);
      pointer(button, 'pointerup', type);
      fireEvent.click(button, { detail: 1 });
      advance(1000);
      expect(commands()).toEqual([['home', 'button']]);
    }
  );

  it.each(['mouse', 'touch'])('sends a single %s hold with no Home on release/click', (type) => {
    render(<Remote />);
    const button = screen.getByRole('button');
    pointer(button, 'pointerdown', type);
    advance(500);
    expect(commands()).toEqual([['home_hold', 'button']]);
    pointer(button, 'pointerup', type);
    fireEvent.click(button, { detail: 1 });
    advance(1000);
    expect(commands()).toEqual([['home_hold', 'button']]);
  });

  it.each([499, 500])(
    'cancels implicitly captured touch movement outside after %i ms',
    (elapsed) => {
      render(<Remote />);
      const button = screen.getByRole('button');
      vi.spyOn(button, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 10, 100, 40));
      pointer(button, 'pointerdown', 'touch', 1, 0, { clientX: 20, clientY: 20 });
      advance(elapsed);
      // Captured touch moves still target the button, without pointerout/leave.
      pointer(button, 'pointermove', 'touch', 1, 0, { clientX: 111, clientY: 20 });
      advance(1000);
      pointer(button, 'pointerup', 'touch', 1, 0, { clientX: 20, clientY: 20 });
      fireEvent.click(button, { detail: 1 });
      expect(commands()).toEqual(elapsed < 500 ? [] : [['home_hold', 'button']]);
    }
  );

  it('cancels touch release outside even when no final move event arrives', () => {
    render(<Remote />);
    const button = screen.getByRole('button');
    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 10, 100, 40));
    pointer(button, 'pointerdown', 'touch', 1, 0, { clientX: 20, clientY: 20 });
    advance(499);
    pointer(button, 'pointerup', 'touch', 1, 0, { clientX: 20, clientY: 51 });
    fireEvent.click(button, { detail: 1 });
    advance(1000);
    expect(commands()).toEqual([]);
  });

  it('ignores outside movement from another pointer while a touch hold is active', () => {
    render(<Remote />);
    const button = screen.getByRole('button');
    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 10, 100, 40));
    pointer(button, 'pointerdown', 'touch', 1, 0, { clientX: 20, clientY: 20 });
    advance(499);
    pointer(button, 'pointermove', 'touch', 2, 0, { clientX: 111, clientY: 20 });
    advance(1);
    pointer(button, 'pointerup', 'touch', 1, 0, { clientX: 20, clientY: 20 });
    expect(commands()).toEqual([['home_hold', 'button']]);
  });

  it('preserves accessible synthetic Home clicks without starting a timer', () => {
    render(<Remote />);
    fireEvent.click(screen.getByRole('button'), { detail: 0 });
    advance(1000);
    expect(commands()).toEqual([['home', 'button']]);
  });

  it.each(['pointercancel', 'pointerleave', 'lostpointercapture', 'blur'])(
    'cancels a pointer gesture on %s',
    (type) => {
      render(<Remote />);
      const button = screen.getByRole('button');
      pointer(button, 'pointerdown');
      advance(499);
      if (type === 'blur') fireEvent.blur(window);
      else if (type === 'pointerleave') pointer(button, 'pointerout');
      else pointer(button, type);
      advance(1000);
      pointer(button, 'pointerup');
      fireEvent.click(button, { detail: 1 });
      expect(commands()).toEqual([]);
    }
  );

  it('cancels H on window blur and ignores the subsequent release', () => {
    render(<Remote />);
    fireEvent.keyDown(window, { key: 'h' });
    advance(499);
    fireEvent.blur(window);
    advance(1000);
    fireEvent.keyUp(window, { key: 'h' });
    expect(commands()).toEqual([]);
  });

  it.each([
    { device: 'bedroom' },
    { view: 'devices' },
    { settingsOpen: true },
    { disabled: true },
    {
      capabilities: {
        ...holdCapabilities,
        supportedCommands: ['home'],
      } satisfies DeviceCapabilities,
    },
  ])('cancels in-flight keyboard and pointer holds on context change: %j', (change) => {
    const view = render(<Remote />);
    fireEvent.keyDown(window, { key: 'h' });
    advance(499);
    view.rerender(<Remote {...change} />);
    advance(1000);
    fireEvent.keyUp(window, { key: 'h' });
    expect(commands()).toEqual([]);
    view.rerender(<Remote />);
    pointer(screen.getByRole('button'), 'pointerdown');
    advance(499);
    view.rerender(<Remote {...change} />);
    advance(1000);
    pointer(screen.getByRole('button'), 'pointerup');
    expect(commands()).toEqual([]);
  });

  it('keeps a hold alive across ordinary rerenders and dispatches through the latest closure', () => {
    const view = render(<Remote />);
    fireEvent.keyDown(window, { key: 'h' });
    advance(499);
    view.rerender(<Remote />);
    advance(1);
    expect(commands()).toEqual([['home_hold', 'keyboard']]);
  });

  it.each(['keyboard', 'pointer'])('cancels a pending %s hold on unmount', (source) => {
    const view = render(<Remote />);
    if (source === 'keyboard') fireEvent.keyDown(window, { key: 'h' });
    else pointer(screen.getByRole('button'), 'pointerdown');
    advance(499);
    view.unmount();
    advance(1000);
    expect(commands()).toEqual([]);
  });

  it.each([
    { textInput: true, powerToggle: true },
    { textInput: true, powerToggle: true, supportedCommands: ['home'] },
  ] satisfies DeviceCapabilities[])(
    'never holds without explicit capability; retains short press behavior: %j',
    async (capabilities) => {
      render(<Remote capabilities={capabilities} />);
      fireEvent.keyDown(window, { key: 'h' });
      expect(commands()).toEqual([['home', 'keyboard']]);
      advance(2000);
      fireEvent.keyUp(window, { key: 'h' });
      await act(async () => {
        await Promise.resolve();
      });
      const button = screen.getByRole('button');
      pointer(button, 'pointerdown', 'touch');
      advance(2000);
      pointer(button, 'pointerup', 'touch');
      fireEvent.click(button, { detail: 1 });
      expect(commands()).toEqual([
        ['home', 'keyboard'],
        ['home', 'button'],
      ]);
    }
  );
});
