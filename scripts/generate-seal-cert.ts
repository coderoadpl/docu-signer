import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import forge from 'node-forge';

const commonName = 'Amazing Company Sp. z o.o. — pieczęć dokumentowa';
const keys = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
const certificate = forge.pki.createCertificate();
certificate.publicKey = keys.publicKey;
certificate.serialNumber = `01${forge.util.bytesToHex(forge.random.getBytesSync(15))}`;
// WHY: the owner requires a stable historical validity window for the test seal certificate.
certificate.validity.notBefore = new Date('2015-01-01T00:00:00.000Z');
certificate.validity.notAfter = new Date('2035-01-01T00:00:00.000Z');
const attributes = [
  {
    name: 'commonName',
    value: commonName,
  },
  {
    name: 'organizationName',
    value: 'Amazing Company Sp. z o.o.',
  },
  { shortName: 'C', value: 'PL' },
];
certificate.setSubject(attributes);
certificate.setIssuer(attributes);
for (const attribute of [
  ...certificate.subject.attributes,
  ...certificate.issuer.attributes,
]) {
  if (attribute.shortName !== 'C') {
    Object.defineProperty(attribute, 'valueTagClass', {
      value: forge.asn1.Type.UTF8,
      writable: true,
    });
  }
}
certificate.setExtensions([
  { name: 'basicConstraints', cA: false, critical: true },
  { name: 'keyUsage', digitalSignature: true, nonRepudiation: true, critical: true },
  { name: 'subjectKeyIdentifier' },
]);
certificate.sign(keys.privateKey, forge.md.sha256.create());

const certificatePem = forge.pki.certificateToPem(certificate);
const privateKeyPem = forge.pki.privateKeyToPem(keys.privateKey);
process.stdout.write(`SEAL_CERT_PEM:\n${certificatePem}\nSEAL_KEY_PEM:\n${privateKeyPem}`);

const outputIndex = process.argv.indexOf('--out-dir');
const outputDir = outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined;
if (outputDir) {
  const target = resolve(outputDir);
  await mkdir(target, { recursive: true });
  await Promise.all([
    writeFile(resolve(target, 'certificate.pem'), certificatePem),
    writeFile(resolve(target, 'private-key.pem'), privateKeyPem),
  ]);
}
