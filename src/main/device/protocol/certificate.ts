import crypto from 'node:crypto';

import forge from 'node-forge';

export interface PemPair {
  cert: string;
  key: string;
}

export function generateCertificate(commonName: string): PemPair {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();

  cert.publicKey = keys.publicKey;
  cert.serialNumber = `01${crypto.randomBytes(19).toString('hex')}`;
  cert.validity.notBefore = new Date();

  const expiresAt = new Date();
  expiresAt.setUTCFullYear(2099);
  cert.validity.notAfter = expiresAt;

  cert.setSubject([
    { name: 'commonName', value: commonName },
    { name: 'countryName', value: 'US' },
    { shortName: 'ST', value: 'Remote' },
    { name: 'localityName', value: 'Desktop' },
    { name: 'organizationName', value: 'GTV Desktop Remote' },
    { shortName: 'OU', value: 'Android TV' }
  ]);

  cert.setIssuer(cert.subject.attributes);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  return {
    cert: forge.pki.certificateToPem(cert),
    key: forge.pki.privateKeyToPem(keys.privateKey)
  };
}