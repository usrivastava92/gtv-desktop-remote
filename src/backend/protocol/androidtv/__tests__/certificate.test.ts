import { X509Certificate } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { generateCertificate } from '../certificate';

/**
 * The Android TV pairing protocol exchanges client + server certificates and
 * derives a session secret from their key material. If we ever regress the
 * cert shape (CN, key size, signature algo, validity window), pairing breaks
 * silently — and you only find out the next time a user re-pairs a TV. These
 * tests lock down the invariants.
 */
describe('certificate generator', () => {
  it('produces a PEM cert + PEM key pair', () => {
    const pair = generateCertificate('gtv-test');
    // node-forge emits CRLF line endings; the regex is whitespace-tolerant.
    expect(pair.cert).toMatch(/^-----BEGIN CERTIFICATE-----\s/);
    expect(pair.cert).toMatch(/-----END CERTIFICATE-----\s*$/);
    expect(pair.key).toMatch(/^-----BEGIN RSA PRIVATE KEY-----\s/);
    expect(pair.key).toMatch(/-----END RSA PRIVATE KEY-----\s*$/);
  });

  it('uses the supplied common name in the subject', () => {
    const pair = generateCertificate('gtv-cn-check');
    const parsed = new X509Certificate(pair.cert);
    expect(parsed.subject).toContain('CN=gtv-cn-check');
  });

  it('is self-signed (issuer == subject)', () => {
    const pair = generateCertificate('self-signed');
    const parsed = new X509Certificate(pair.cert);
    expect(parsed.subject).toBe(parsed.issuer);
  });

  it('uses RSA-2048 (the wire format the pairing protocol expects)', () => {
    const pair = generateCertificate('rsa-2048');
    const parsed = new X509Certificate(pair.cert);
    expect(parsed.publicKey.asymmetricKeyType).toBe('rsa');
    const details = parsed.publicKey.asymmetricKeyDetails;
    expect(details?.modulusLength).toBe(2048);
  });

  it('is valid for the long-lived window the protocol assumes', () => {
    const pair = generateCertificate('validity-check');
    const parsed = new X509Certificate(pair.cert);
    const notAfter = new Date(parsed.validTo);
    expect(notAfter.getUTCFullYear()).toBeGreaterThanOrEqual(2090);
  });

  it('generates unique serials across calls', () => {
    const a = new X509Certificate(generateCertificate('a').cert);
    const b = new X509Certificate(generateCertificate('b').cert);
    expect(a.serialNumber).not.toBe(b.serialNumber);
  });
});
