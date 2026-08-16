import forge from 'node-forge';
import {
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFSignature,
  PDFString,
  StandardFonts,
} from 'pdf-lib';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  attemptPdfSeal,
  preparePdfSeal,
  recordPdfSeal,
  type PdfSealingDeps,
} from '#core/server/index.js';
import { MAX_DOCUMENT_FILE_BYTES } from '#core/domain/index.js';

import { generateSealCertificate } from './certificate.js';
import { createSignPdfSeal, pdfSealCertificateSubject } from './signpdf.js';
import { verifyPdfSeal } from './verify.js';

const testCertificate = generateSealCertificate();

const credentials = async () => ({
  kind: 'pem' as const,
  certificate: testCertificate.certificatePem,
  privateKey: testCertificate.privateKeyPem,
});

const samplePdf = async (): Promise<Uint8Array> => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText('PAdES organization seal fixture', {
    x: 72,
    y: 770,
    size: 18,
    font,
  });
  return pdf.save();
};

const asn1 = (
  tagClass: number,
  type: number,
  constructed: boolean,
  value: forge.asn1.Asn1[] | string,
): forge.asn1.Asn1 => forge.asn1.create(tagClass, type, constructed, value);

const cmsPdf = (cms: forge.asn1.Asn1): Uint8Array => Buffer.from(
  `/ByteRange [0 0 0 0] /Contents <${Buffer.from(
    forge.asn1.toDer(cms).getBytes(),
    'binary',
  ).toString('hex')}>`,
);

const cmsRoot = (signedData: forge.asn1.Asn1[]): forge.asn1.Asn1 => asn1(
  forge.asn1.Class.UNIVERSAL,
  forge.asn1.Type.SEQUENCE,
  true,
  [
    asn1(
      forge.asn1.Class.UNIVERSAL,
      forge.asn1.Type.OID,
      false,
      forge.asn1.oidToDer('1.2.840.113549.1.7.2').getBytes(),
    ),
    asn1(
      forge.asn1.Class.CONTEXT_SPECIFIC,
      0,
      true,
      [asn1(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, signedData)],
    ),
  ],
);

const malformedSignerCms = async (attributes: forge.asn1.Asn1[]): Promise<forge.asn1.Asn1> => {
  const pem = await credentials();
  const certificate = forge.pki.certificateFromPem(pem.certificate);
  return cmsRoot([
    asn1(
      forge.asn1.Class.CONTEXT_SPECIFIC,
      0,
      true,
      [forge.pki.certificateToAsn1(certificate)],
    ),
    asn1(
      forge.asn1.Class.UNIVERSAL,
      forge.asn1.Type.SET,
      true,
      [asn1(
        forge.asn1.Class.UNIVERSAL,
        forge.asn1.Type.SEQUENCE,
        true,
        [
          asn1(forge.asn1.Class.CONTEXT_SPECIFIC, 0, true, attributes),
          asn1(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.OCTETSTRING, false, ''),
        ],
      )],
    ),
  ]);
};

const sealingDeps = async (dateMode: 'declared' | 'actual'): Promise<PdfSealingDeps> => ({
  ids: { nextId: () => '11111111-1111-4111-8111-111111111111' },
  pdfSeal: createSignPdfSeal(await credentials()),
  signatureRecords: {
    listByDocument: async () => [],
    create: async () => null,
    recordSeal: async () => {},
  },
  tenantAccounts: {
    listByTenant: async () => [
      { accountId: 'user-anna', name: 'Anna Żółć' },
      { accountId: 'user-marek', name: 'Marek Nowak' },
    ],
  },
  tenantSettings: {
    get: async () => ({
      tenantId: 'tenant-1',
      storeSignatureRecords: true,
      pdfSealEnabled: true,
      signatureBoxEnabled: false,
      dateMode,
    }),
    set: async (tenantId: string, settings: {
      storeSignatureRecords: boolean;
      pdfSealEnabled: boolean;
      signatureBoxEnabled: boolean;
      dateMode: 'declared' | 'actual';
    }) => ({ tenantId, ...settings }),
  },
  warnings: { warn: vi.fn() },
});

const document = {
  id: '22222222-2222-4222-8222-222222222222',
  tenantId: 'tenant-1',
  title: 'Umowa',
  docType: 'umowa-uod' as const,
  documentDate: '2020-02-03',
  periodStart: null,
  periodEnd: null,
  person: null,
  tags: [],
  draft: false,
  signatureNotRequired: false,
  createdAt: '2026-08-09T10:00:00.000Z',
  updatedAt: '2026-08-09T10:00:00.000Z',
  deletedAt: null,
};

const dictionaryText = (dictionary: PDFDict, key: string): string => {
  const value = dictionary.lookup(PDFName.of(key));
  if (!(value instanceof PDFString) && !(value instanceof PDFHexString)) {
    throw new Error(`Signature dictionary ${key} is not text`);
  }
  return value.decodeText();
};

const signatureDictionary = (field: PDFSignature): PDFDict => {
  const value = field.acroField.V();
  if (!(value instanceof PDFDict)) throw new Error('Signature field has no dictionary');
  return value;
};

describe('signpdf PAdES adapter', () => {
  it('reads the configured certificate common name', async () => {
    expect(pdfSealCertificateSubject(await credentials())).toBe(
      'Amazing Company Sp. z o.o. — pieczęć dokumentowa',
    );
  });

  afterEach(() => vi.useRealTimers());

  it.each([
    ['declared', '2020-02-03T14:15:16.000Z', '2020-02-03T14:15:16.000Z'],
    ['actual', '2026-08-09T14:15:16.000Z', '2026-08-09T14:15:16.789Z'],
  ] as const)('seals and verifies CMS integrity in %s date mode', async (
    dateMode,
    expectedCmsTime,
    expectedMetadataTime,
  ) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-09T14:15:16.789Z'));
    const sealed = await attemptPdfSeal(
      {
        tenantId: 'tenant-1',
        document,
        bytes: await samplePdf(),
        dateMode,
        contributorAccountIds: ['user-anna', 'user-marek'],
      },
      await sealingDeps(dateMode),
    );
    expect(sealed).not.toBeNull();
    if (!sealed) return;
    const verification = verifyPdfSeal(sealed.bytes);
    expect(verification).toEqual({
      subject: 'Amazing Company Sp. z o.o. — pieczęć dokumentowa',
      name: 'Amazing Company Sp. z o.o. — pieczęć dokumentowa',
      reason: 'Signed by: Anna Żółć, Marek Nowak',
      declaredAt: expectedCmsTime,
      byteRangeValid: true,
      digestValid: true,
      signatureValid: true,
      integrity: true,
    });
    expect(sealed.metadata.declaredAt).toBe(expectedMetadataTime);
    expect(sealed.metadata.appliedAt).toBe('2026-08-09T14:15:16.789Z');
  });

  it('writes claimed signer names, certificate subject and unique seal field names', async () => {
    const adapter = createSignPdfSeal(await credentials());
    if (!adapter.configured) throw new Error('Fixture seal adapter is not configured');
    const first = await adapter.seal({
      bytes: await samplePdf(),
      signingTime: new Date('2026-08-09T14:15:16.000Z'),
      contributorNames: ['Anna Żółć', 'Marek Nowak'],
    });
    if (first.kind !== 'sealed') throw new Error(first.reason);
    const second = await adapter.seal({
      bytes: first.bytes,
      signingTime: new Date('2026-08-09T14:16:17.000Z'),
      contributorNames: ['Marek (Nowak) \\ QA'],
    });
    if (second.kind !== 'sealed') throw new Error(second.reason);
    const pdf = await PDFDocument.load(second.bytes);
    const fields = pdf.getForm().getFields()
      .filter((field) => field instanceof PDFSignature);
    expect(fields.map((field) => field.getName())).toEqual(['Pieczec-1', 'Pieczec-2']);
    const dictionaries = fields.map((field) => signatureDictionary(field));
    expect(dictionaries.map((dictionary) => dictionaryText(dictionary, 'Reason'))).toEqual([
      'Signed by: Anna Żółć, Marek Nowak',
      'Signed by: Marek (Nowak) \\ QA',
    ]);
    expect(dictionaries.map((dictionary) => dictionaryText(dictionary, 'Name'))).toEqual([
      'Amazing Company Sp. z o.o. — pieczęć dokumentowa',
      'Amazing Company Sp. z o.o. — pieczęć dokumentowa',
    ]);
    expect(verifyPdfSeal(second.bytes)).toMatchObject({
      name: 'Amazing Company Sp. z o.o. — pieczęć dokumentowa',
      reason: 'Signed by: Marek (Nowak) \\ QA',
    });
  });

  it('detects a byte changed inside the signed ranges', async () => {
    const adapter = createSignPdfSeal(await credentials());
    if (!adapter.configured) throw new Error('Fixture seal adapter is not configured');
    const sealed = await adapter.seal({
      bytes: await samplePdf(),
      signingTime: new Date('2026-08-09T14:15:16.000Z'),
      contributorNames: ['Anna Żółć'],
    });
    if (sealed.kind !== 'sealed') throw new Error(sealed.reason);
    const tampered = new Uint8Array(sealed.bytes);
    tampered[10] = (tampered[10] ?? 0) ^ 1;
    expect(verifyPdfSeal(tampered)).toMatchObject({
      byteRangeValid: true,
      digestValid: false,
      signatureValid: true,
      integrity: false,
    });
  });

  it('returns null when optional signature dictionary text entries are absent', async () => {
    const adapter = createSignPdfSeal(await credentials());
    if (!adapter.configured) throw new Error('Fixture seal adapter is not configured');
    const sealed = await adapter.seal({
      bytes: await samplePdf(),
      signingTime: new Date('2026-08-09T14:15:16.000Z'),
      contributorNames: ['Anna Żółć'],
    });
    if (sealed.kind !== 'sealed') throw new Error(sealed.reason);
    const withoutEntries = Buffer.from(sealed.bytes);
    for (const key of ['Name', 'Reason']) {
      const keyStart = withoutEntries.indexOf(Buffer.from(`/${key} <`));
      if (keyStart < 0) throw new Error(`Missing ${key} fixture entry`);
      withoutEntries[keyStart + 1] = 'X'.charCodeAt(0);
    }

    expect(verifyPdfSeal(withoutEntries)).toMatchObject({
      name: null,
      reason: null,
      byteRangeValid: true,
      digestValid: false,
    });
  });

  it('supports PKCS#12 credentials and generalized CMS signing time', async () => {
    const pem = await credentials();
    const certificate = forge.pki.certificateFromPem(pem.certificate);
    const privateKey = forge.pki.privateKeyFromPem(pem.privateKey);
    const p12 = forge.pkcs12.toPkcs12Asn1(privateKey, certificate, 'fixture-pass', {
      algorithm: '3des',
    });
    const adapter = createSignPdfSeal({
      kind: 'p12',
      base64: Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary').toString('base64'),
      passphrase: 'fixture-pass',
    });
    if (!adapter.configured) throw new Error('Fixture seal adapter is not configured');
    const sealed = await adapter.seal({
      bytes: await samplePdf(),
      signingTime: new Date('2051-08-09T14:15:16.000Z'),
      contributorNames: ['Anna Żółć'],
    });
    if (sealed.kind !== 'sealed') throw new Error(sealed.reason);
    expect(verifyPdfSeal(sealed.bytes)).toMatchObject({
      declaredAt: '2051-08-09T14:15:16.000Z',
      integrity: true,
    });
  });

  it('reports a certificate without a common name as a failed outcome', async () => {
    const pem = await credentials();
    const privateKey = forge.pki.privateKeyFromPem(pem.privateKey);
    const certificate = forge.pki.createCertificate();
    certificate.publicKey = forge.pki.rsa.setPublicKey(privateKey.n, privateKey.e);
    certificate.serialNumber = '01';
    certificate.validity.notBefore = new Date('2015-01-01T00:00:00.000Z');
    certificate.validity.notAfter = new Date('2035-01-01T00:00:00.000Z');
    certificate.setSubject([{ name: 'organizationName', value: 'Fixture' }]);
    certificate.setIssuer([{ name: 'organizationName', value: 'Fixture' }]);
    certificate.sign(privateKey, forge.md.sha256.create());
    const adapter = createSignPdfSeal({
      kind: 'pem',
      certificate: forge.pki.certificateToPem(certificate),
      privateKey: pem.privateKey,
    });
    if (!adapter.configured) throw new Error('Fixture seal adapter is not configured');
    await expect(adapter.seal({
      bytes: await samplePdf(),
      signingTime: new Date('2026-08-09T14:15:16.000Z'),
      contributorNames: ['Anna Żółć'],
    })).resolves.toMatchObject({
      kind: 'failed',
      reason: expect.stringContaining('common name'),
    });
  });

  it('reports incomplete and mismatched PKCS#12 credential bundles', async () => {
    const pem = await credentials();
    const certificate = forge.pki.certificateFromPem(pem.certificate);
    const p12Credentials = (
      key: forge.pki.rsa.PrivateKey | null,
      certificates: forge.pki.Certificate | forge.pki.Certificate[],
    ) => ({
      kind: 'p12' as const,
      base64: Buffer.from(forge.asn1.toDer(
        forge.pkcs12.toPkcs12Asn1(key, certificates, '', { algorithm: '3des' }),
      ).getBytes(), 'binary').toString('base64'),
      passphrase: '',
    });
    const noKey = createSignPdfSeal(p12Credentials(null, certificate));
    if (!noKey.configured) throw new Error('Fixture seal adapter is not configured');
    await expect(noKey.seal({
      bytes: await samplePdf(),
      signingTime: new Date('2026-08-09T14:15:16.000Z'),
      contributorNames: ['Anna Żółć'],
    })).resolves.toMatchObject({
      kind: 'failed',
      reason: expect.stringContaining('no private key'),
    });

    const mismatchedKey = forge.pki.rsa.generateKeyPair({ bits: 1024 }).privateKey;
    const mismatched = createSignPdfSeal(p12Credentials(mismatchedKey, certificate));
    if (!mismatched.configured) throw new Error('Fixture seal adapter is not configured');
    await expect(mismatched.seal({
      bytes: await samplePdf(),
      signingTime: new Date('2026-08-09T14:15:16.000Z'),
      contributorNames: ['Anna Żółć'],
    })).resolves.toMatchObject({
      kind: 'failed',
      reason: expect.stringContaining('matching its private key'),
    });
  });

  it('uses the wall clock when a signer receives no explicit signing time', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-09T14:15:16.000Z'));
    const adapter = createSignPdfSeal(await credentials());
    if (!adapter.configured) throw new Error('Fixture seal adapter is not configured');
    const input = {
      bytes: await samplePdf(),
      signingTime: new Date('2026-08-09T14:15:16.000Z'),
      contributorNames: ['Anna Żółć'],
    };
    Object.defineProperty(input, 'signingTime', { value: undefined });
    const sealed = await adapter.seal(input);
    if (sealed.kind !== 'sealed') throw new Error(sealed.reason);
    expect(verifyPdfSeal(sealed.bytes).declaredAt).toBe('2026-08-09T14:15:16.000Z');
  });

  it('reports invalid byte ranges and invalid RSA signature values independently', async () => {
    const adapter = createSignPdfSeal(await credentials());
    if (!adapter.configured) throw new Error('Fixture seal adapter is not configured');
    const sealed = await adapter.seal({
      bytes: await samplePdf(),
      signingTime: new Date('2026-08-09T14:15:16.000Z'),
      contributorNames: ['Anna Żółć'],
    });
    if (sealed.kind !== 'sealed') throw new Error(sealed.reason);
    const invalidRange = Buffer.from(sealed.bytes);
    const rangeStart = invalidRange.indexOf(Buffer.from('/ByteRange [0 '));
    invalidRange[rangeStart + '/ByteRange ['.length] = '1'.charCodeAt(0);
    expect(verifyPdfSeal(invalidRange)).toMatchObject({
      byteRangeValid: false,
      digestValid: false,
      signatureValid: true,
      integrity: false,
    });

    const invalidSignature = Buffer.from(sealed.bytes);
    const source = invalidSignature.toString('latin1');
    const contentsStart = source.indexOf(
      '<',
      source.indexOf('/Contents ', source.indexOf('/ByteRange')),
    );
    const derStart = contentsStart + 1;
    const lengthOctet = Number.parseInt(source.slice(derStart + 2, derStart + 4), 16);
    const lengthBytes = lengthOctet & 0x7f;
    const contentLength = Number.parseInt(
      source.slice(derStart + 4, derStart + 4 + lengthBytes * 2),
      16,
    );
    const finalHexIndex = derStart + (2 + lengthBytes + contentLength) * 2 - 2;
    invalidSignature[finalHexIndex] = source[finalHexIndex] === '0'
      ? '1'.charCodeAt(0)
      : '0'.charCodeAt(0);
    expect(verifyPdfSeal(invalidSignature)).toMatchObject({
      byteRangeValid: true,
      digestValid: true,
      signatureValid: false,
      integrity: false,
    });
  });

  it.each([
    ['', 'PDF has no digital signature'],
    ['/ByteRange [0 0 50 0] /Contents ', 'PDF signature contents are absent'],
    ['/ByteRange [0 0 50 0] /Contents <>', 'not hexadecimal CMS'],
    ['/ByteRange [0 0 50 0] /Contents <0>', 'not hexadecimal CMS'],
    ['/ByteRange [0 0 50 0] /Contents <zz>', 'not hexadecimal CMS'],
    ['/ByteRange [0 0 50 0] /Contents <30>', 'CMS value is empty'],
    ['/ByteRange [0 0 50 0] /Contents <3080>', 'CMS length is invalid'],
    ['/ByteRange [0 0 50 0] /Contents <308701020304050607>', 'CMS length is invalid'],
  ])('rejects malformed PDF signature input %#', (input, message) => {
    expect(() => verifyPdfSeal(Buffer.from(input))).toThrow(message);
  });

  it('rejects malformed CMS structure and authenticated attributes', async () => {
    const sequence = (value: forge.asn1.Asn1[]) => asn1(
      forge.asn1.Class.UNIVERSAL,
      forge.asn1.Type.SEQUENCE,
      true,
      value,
    );
    const context = (value: forge.asn1.Asn1[]) => asn1(
      forge.asn1.Class.CONTEXT_SPECIFIC,
      0,
      true,
      value,
    );
    const set = (value: forge.asn1.Asn1[]) => asn1(
      forge.asn1.Class.UNIVERSAL,
      forge.asn1.Type.SET,
      true,
      value,
    );
    const digestOid = asn1(
      forge.asn1.Class.UNIVERSAL,
      forge.asn1.Type.OID,
      false,
      forge.asn1.oidToDer('1.2.840.113549.1.9.4').getBytes(),
    );
    const cases: Array<[forge.asn1.Asn1, string]> = [
      [asn1(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.INTEGER, false, '\u0001'), 'constructed'],
      [sequence([]), 'wrapper is absent'],
      [sequence([digestOid, context([])]), 'SignedData is absent'],
      [cmsRoot([]), 'certificate or signer information is absent'],
      [cmsRoot([context([]), set([])]), 'CMS signer is absent'],
    ];
    const pem = await credentials();
    const certificate = forge.pki.certificateFromPem(pem.certificate);
    cases.push([
      cmsRoot([
        context([forge.pki.certificateToAsn1(certificate)]),
        set([sequence([])]),
      ]),
      'authenticated attributes or signature are absent',
    ]);
    cases.push(
      [await malformedSignerCms([sequence([])]), 'messageDigest is absent'],
      [await malformedSignerCms([sequence([digestOid])]), 'value set is absent'],
      [await malformedSignerCms([sequence([digestOid, set([])])]), 'value is absent'],
      [await malformedSignerCms([sequence([set([])])]), 'primitive ASN.1 value'],
    );
    for (const [cms, message] of cases) {
      expect(() => verifyPdfSeal(cmsPdf(cms))).toThrow(message);
    }
  });

  it('skips, warns and records seal evidence without blocking signing', async () => {
    expect(createSignPdfSeal(null)).toEqual({ configured: false });
    const disabled = await sealingDeps('declared');
    disabled.tenantSettings.get = async () => null;
    await expect(preparePdfSeal(
      { tenantId: 'tenant-1', documentId: document.id },
      disabled,
    )).resolves.toBeNull();

    const absent = await sealingDeps('declared');
    absent.pdfSeal = { configured: false };
    await expect(preparePdfSeal(
      { tenantId: 'tenant-1', documentId: document.id },
      absent,
    )).resolves.toBeNull();
    expect(absent.warnings.warn).toHaveBeenCalledWith(
      expect.stringContaining('environment variables are absent'),
      expect.any(Object),
    );

    const failed = await sealingDeps('declared');
    await expect(attemptPdfSeal(
      {
        tenantId: 'tenant-1',
        document,
        bytes: new Uint8Array([1, 2, 3]),
        dateMode: 'declared',
        contributorAccountIds: ['user-anna'],
      },
      failed,
    )).resolves.toBeNull();
    expect(failed.warnings.warn).toHaveBeenCalledWith(
      expect.stringContaining('preserving the uploaded PDF'),
      expect.objectContaining({ reason: expect.stringContaining('PDF') }),
    );

    const exploded = await sealingDeps('declared');
    exploded.pdfSeal = {
      configured: true,
      seal: async () => { throw new Error('fixture failure'); },
    };
    await expect(attemptPdfSeal(
      {
        tenantId: 'tenant-1',
        document,
        bytes: await samplePdf(),
        dateMode: 'declared',
        contributorAccountIds: ['user-anna'],
      },
      exploded,
    )).rejects.toThrow('fixture failure');

    const oversized = await sealingDeps('declared');
    oversized.pdfSeal = {
      configured: true,
      seal: async () => ({
        kind: 'sealed',
        bytes: new Uint8Array(MAX_DOCUMENT_FILE_BYTES + 1),
        subject: 'Fixture',
      }),
    };
    await expect(attemptPdfSeal(
      {
        tenantId: 'tenant-1',
        document,
        bytes: await samplePdf(),
        dateMode: 'declared',
        contributorAccountIds: ['user-anna'],
      },
      oversized,
    )).resolves.toBeNull();
    expect(oversized.warnings.warn).toHaveBeenCalledWith(
      expect.stringContaining('preserving the uploaded PDF'),
      expect.objectContaining({ reason: 'size-limit' }),
    );

    const record = vi.fn(async () => {});
    failed.signatureRecords.recordSeal = record;
    await recordPdfSeal({
      tenantId: 'tenant-1',
      documentId: document.id,
      fileId: '33333333-3333-4333-8333-333333333333',
      signedBy: 'user-1',
      metadata: {
        subject: 'Fixture',
        declaredAt: '2026-08-09T14:15:16.000Z',
        appliedAt: '2026-08-09T14:15:16.789Z',
      },
    }, failed);
    expect(record).toHaveBeenCalledOnce();
    failed.signatureRecords.recordSeal = async () => { throw new Error('db failure'); };
    await expect(recordPdfSeal({
      tenantId: 'tenant-1',
      documentId: document.id,
      fileId: '33333333-3333-4333-8333-333333333333',
      signedBy: 'user-1',
      metadata: {
        subject: 'Fixture',
        declaredAt: '2026-08-09T14:15:16.000Z',
        appliedAt: '2026-08-09T14:15:16.789Z',
      },
    }, failed)).rejects.toThrow('db failure');
  });
});
