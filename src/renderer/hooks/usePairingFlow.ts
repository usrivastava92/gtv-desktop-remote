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
