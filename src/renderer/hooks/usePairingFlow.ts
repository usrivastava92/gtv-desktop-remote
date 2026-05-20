// PR-renderer-7: extract pairing flow state from App.tsx.
//
// This hook owns:
//   - the pairCode state slice (string)
//   - the pairingDeviceId state slice (string)
//   - the pairingReady state slice (boolean)
//   - the pairCodeInputRef ref
//
// App.tsx uses this as:
//   const { pairCode, setPairCode, pairingDeviceId, setPairingDeviceId, pairingReady, setPairingReady, pairCodeInputRef } = usePairingFlow();
//
// Pairing handlers (startPairingFlow, handlePair, etc.) remain in App.tsx because they
// have dependencies on bootstrap state, setBootstrap, and other app-level state setters.
// They call the setters from this hook as needed.
//
// The hook is tested in src/renderer/hooks/__tests__/usePairingFlow.test.tsx.

import { useRef, useState } from 'react';

/**
 * Manages pairing flow state (code input, device selection, ready flag, and input ref).
 *
 * Returns:
 *   - pairCode: the 6-character code entered by the user
 *   - setPairCode: setter for pair code
 *   - pairingDeviceId: the device being paired
 *   - setPairingDeviceId: setter for pairing device ID
 *   - pairingReady: whether the pairing UI should be displayed
 *   - setPairingReady: setter for pairing ready flag
 *   - pairCodeInputRef: ref for the hidden pair code input element
 */
export function usePairingFlow() {
  const [pairCode, setPairCode] = useState('');
  const [pairingDeviceId, setPairingDeviceId] = useState('');
  const [pairingReady, setPairingReady] = useState(false);
  const pairCodeInputRef = useRef<HTMLInputElement>(null);

  return {
    pairCode,
    setPairCode,
    pairingDeviceId,
    setPairingDeviceId,
    pairingReady,
    setPairingReady,
    pairCodeInputRef,
  };
}
