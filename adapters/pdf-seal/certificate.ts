import forge from 'node-forge';

export const generateSealCertificate = (): {
  certificatePem: string;
  privateKeyPem: string;
} => {
  const commonName = 'Amazing Company Sp. z o.o. — pieczęć dokumentowa';
  const keys = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
  const certificate = forge.pki.createCertificate();
  certificate.publicKey = keys.publicKey;
  certificate.serialNumber = `01${forge.util.bytesToHex(forge.random.getBytesSync(15))}`;
  // WHY: declared signing times back to 2015 must remain inside certificate validity.
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

  return {
    certificatePem: forge.pki.certificateToPem(certificate),
    privateKeyPem: forge.pki.privateKeyToPem(keys.privateKey),
  };
};
