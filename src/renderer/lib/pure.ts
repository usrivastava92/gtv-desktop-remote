/**
 * pure renderer helpers extracted from
 * `App.tsx`. These are the easiest 4 functions to lift because they have
 * no React, no DOM mutation, no Electron, and no closure state — just
 * inputs → outputs (with `isEditableTarget` reading DOM properties on a
 * passed-in node, which jsdom synthesizes fine in tests).
 *
 * Why extract these first
 *   - First real renderer tests use jsdom + @testing-library/react
 *     shipped the jsdom + RTL harness.
 *   - Sets the import convention (`renderer/lib/`) so future hooks
 *     (`renderer/hooks/`) and features (`renderer/features/`) have a
 *     stable place to land as App.tsx (2,079 LOC) decomposes.
 *   - Zero coupling to the App.tsx state machine, so the move is a 1:1
 *     re-export with byte-identical behavior in production.
 */

/**
 * Returns true when the given target is a focused editable surface
 * (input, textarea, select, or contenteditable host). The keyboard
 * shortcut handler in App.tsx uses this to suppress remote-control
 * shortcuts while the user is typing into a text field.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName;
  const editable = (target.isContentEditable as unknown) === true;
  return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT' || editable;
}

/**
 * Normalises a user-typed pair code: strips non-hex characters (the Android
 * TV Remote v2 protocol encodes the 6-character code as hexadecimal),
 * upper-cases the rest, and truncates to the 6-character protocol limit.
 */
export function sanitizePairCode(value: string): string {
  return value
    .replace(/[^a-f0-9]/gi, '')
    .toUpperCase()
    .slice(0, 6);
}

/**
 * Variadic className joiner that ignores falsy entries. Equivalent to
 * `clsx(...)` minus the object/array overloads we don't use.
 */
export function classes(...values: (string | false | null | undefined)[]): string {
  return values.filter(Boolean).join(' ');
}

/**
 * Detects pairing-side error messages that mean the previous pair session
 * is no longer valid and the renderer should restart the flow from
 * scratch (re-fetch a fresh 6-character code) rather than retry the same
 * code. Regex encodes the phrases the backend emits via androidtv-remote's
 * pairing protocol, including the local certificate hash validation error
 * thrown when the entered code does not match the TV's certificate.
 */
export function shouldRestartPairingFlow(message: string): boolean {
  return /invalid pairing code|request a new code|no pairing session is active|pairing failed|certificate hash validation/i.test(
    message
  );
}
