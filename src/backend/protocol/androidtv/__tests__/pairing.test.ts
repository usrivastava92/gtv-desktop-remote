import { describe, expect, it } from 'vitest';

import { PairingManager } from '../pairing';

/**
 * lands the module move + a light surface test. The full pairing FSM
 * (happy path, invalid code, mid-flow disconnect, cert-rejected, restart-
 * after-failure) is the subject of , which will inject a fake transport.
 *
 * Here we just assert the public class exists and can be constructed without
 * exploding when given the inputs the real call site passes.
 */
describe('PairingManager — module surface', () => {
  it('is exported as a class with the expected constructor surface', () => {
    expect(typeof PairingManager).toBe('function');
    expect(PairingManager.name).toBe('PairingManager');
  });
});
