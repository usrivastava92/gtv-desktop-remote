import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

// The package exports only its adapter. Load the installed, pinned protocol
// implementation so the independent vectors exercise the durable Yarn patch.
const cryptoUrl = pathToFileURL(
  resolve(__dirname, '../../../node_modules/@librecontrol/apple-tv/dist/protocol/crypto.js')
).href;
type Aead = (key: Buffer, nonce: Buffer, input: Buffer, aad?: Buffer) => Buffer;
let seal: Aead;
let open: Aead;
beforeAll(async () => {
  const installedCrypto = (await import(/* @vite-ignore */ cryptoUrl)) as {
    seal: Aead;
    open: Aead;
  };
  seal = installedCrypto.seal;
  open = installedCrypto.open;
});

// https://www.rfc-editor.org/rfc/rfc8439.html#section-2.8.2
const key = Buffer.from('808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f', 'hex');
const nonce = Buffer.from('070000004041424344454647', 'hex');
const aad = Buffer.from('50515253c0c1c2c3c4c5c6c7', 'hex');
const plaintext = Buffer.from(
  "Ladies and Gentlemen of the class of '99: If I could offer you only one tip for the future, sunscreen would be it."
);
const ciphertextAndTag = Buffer.from(
  'd31a8d34648e60db7b86afbc53ef7ec2' +
    'a4aded51296e08fea9e2b5a736ee62d6' +
    '3dbea45e8ca9671282fafb69da92728b' +
    '1a71de0a9e060b2905d6a5b67ecd3b36' +
    '92ddbd7f2d778b8c9803aee328091b58' +
    'fab324e4fad675945585808b4831d7bc' +
    '3ff4def08e4b7a9de576d26586cec64b6116' +
    '1ae10b594f09e26a7e902ecbd0600691',
  'hex'
);

function flipped(input: Buffer, index: number): Buffer {
  const result = Buffer.from(input);
  const byte = result[index];
  if (byte === undefined) throw new RangeError('Invalid vector byte index');
  result[index] = byte ^ 1;
  return result;
}

describe('installed Apple TV ChaCha20-Poly1305', () => {
  it('seals to the RFC 8439 section 2.8.2 ciphertext and appended tag', () => {
    const sealed = seal(key, nonce, plaintext, aad);
    expect(Buffer.isBuffer(sealed)).toBe(true);
    expect(sealed).toEqual(ciphertextAndTag);
  });

  it('opens the independently specified RFC vector', () => {
    const opened = open(key, nonce, ciphertextAndTag, aad);
    expect(Buffer.isBuffer(opened)).toBe(true);
    expect(opened).toEqual(plaintext);
  });

  it('normalizes eight-byte pairing nonces by prepending four zero bytes', () => {
    const shortNonce = Buffer.from('PS-Msg05');
    const fullNonce = Buffer.concat([Buffer.alloc(4), shortNonce]);
    const sealed = seal(key, shortNonce, plaintext, aad);
    expect(sealed).toEqual(seal(key, fullNonce, plaintext, aad));
    expect(open(key, fullNonce, sealed, aad)).toEqual(plaintext);
    expect(open(key, shortNonce, sealed, aad)).toEqual(plaintext);
    expect(() => open(key, Buffer.concat([shortNonce, Buffer.alloc(4)]), sealed, aad)).toThrow();
  });

  it('authenticates AAD, key, and nonce without returning plaintext on failure', () => {
    expect(() => open(key, nonce, ciphertextAndTag, flipped(aad, 0))).toThrow();
    expect(() => open(key, nonce, ciphertextAndTag)).toThrow();
    expect(() => open(flipped(key, 0), nonce, ciphertextAndTag, aad)).toThrow();
    expect(() => open(key, flipped(nonce, 0), ciphertextAndTag, aad)).toThrow();
  });

  it.each([0, 113, 114, 129])('rejects a changed ciphertext/tag byte at %i', (index) => {
    expect(() => open(key, nonce, flipped(ciphertextAndTag, index), aad)).toThrow();
  });

  it.each([0, 1, 15])('rejects truncated authenticated ciphertext of length %i', (length) => {
    expect(() => open(key, nonce, Buffer.alloc(length), aad)).toThrow();
  });

  it.each([0, 31, 33])('rejects key length %i in both directions', (length) => {
    expect(() => seal(Buffer.alloc(length), nonce, plaintext, aad)).toThrow();
    expect(() => open(Buffer.alloc(length), nonce, ciphertextAndTag, aad)).toThrow();
  });

  it.each([0, 7, 9, 11, 13])('rejects nonce length %i in both directions', (length) => {
    expect(() => seal(key, Buffer.alloc(length), plaintext, aad)).toThrow();
    expect(() => open(key, Buffer.alloc(length), ciphertextAndTag, aad)).toThrow();
  });

  it('supports empty plaintext and omitted AAD with a full authentication tag', () => {
    const sealed = seal(key, nonce, Buffer.alloc(0));
    expect(sealed).toHaveLength(16);
    expect(open(key, nonce, sealed)).toEqual(Buffer.alloc(0));
    expect(() => open(key, nonce, flipped(sealed, 0))).toThrow();
  });
});
