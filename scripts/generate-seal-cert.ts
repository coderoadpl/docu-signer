import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { generateSealCertificate } from '#adapters/pdf-seal/certificate.js';

const { certificatePem, privateKeyPem } = generateSealCertificate();
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
