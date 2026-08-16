import forge from 'node-forge';
import {
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFSignature,
} from 'pdf-lib';

import { pdflibAddPlaceholder } from '@signpdf/placeholder-pdf-lib';
import { SignPdf } from '@signpdf/signpdf';
import { Signer, SUBFILTER_ETSI_CADES_DETACHED } from '@signpdf/utils';

import type { PdfSealPort } from '#core/server/index.js';

export type PdfSealCredentials =
  | { kind: 'pem'; certificate: string; privateKey: string }
  | { kind: 'p12'; base64: string; passphrase: string };

const signPdf = new SignPdf();

const asn1Children = (node: forge.asn1.Asn1): forge.asn1.Asn1[] => {
  if (!Array.isArray(node.value)) throw new Error('Expected constructed CMS value');
  return node.value;
};

const requiredNode = <T>(node: T | undefined, message: string): T => {
  if (!node) throw new Error(message);
  return node;
};

const p12Bags = (
  p12: forge.pkcs12.Pkcs12Pfx,
  type: string,
): forge.pkcs12.Bag[] => p12.safeContents
  .flatMap((content) => content.safeBags)
  .filter((bag) => bag.type === type);

const signingCertificateV2 = (
  certificate: forge.pki.Certificate,
): forge.asn1.Asn1 => {
  const certificateDer = forge.asn1.toDer(
    forge.pki.certificateToAsn1(certificate),
  ).getBytes();
  const digest = forge.md.sha256.create();
  digest.update(certificateDer);
  return forge.asn1.create(
    forge.asn1.Class.UNIVERSAL,
    forge.asn1.Type.SEQUENCE,
    true,
    [
      forge.asn1.create(
        forge.asn1.Class.UNIVERSAL,
        forge.asn1.Type.OID,
        false,
        forge.asn1.oidToDer('1.2.840.113549.1.9.16.2.47').getBytes(),
      ),
      forge.asn1.create(
        forge.asn1.Class.UNIVERSAL,
        forge.asn1.Type.SET,
        true,
        [forge.asn1.create(
          forge.asn1.Class.UNIVERSAL,
          forge.asn1.Type.SEQUENCE,
          true,
          [forge.asn1.create(
            forge.asn1.Class.UNIVERSAL,
            forge.asn1.Type.SEQUENCE,
            true,
            [forge.asn1.create(
              forge.asn1.Class.UNIVERSAL,
              forge.asn1.Type.SEQUENCE,
              true,
              [forge.asn1.create(
                forge.asn1.Class.UNIVERSAL,
                forge.asn1.Type.OCTETSTRING,
                false,
                digest.digest().getBytes(),
              )],
            )],
          )],
        )],
      ),
    ],
  );
};

const addCadesCertificateBinding = (
  cms: forge.asn1.Asn1,
  certificate: forge.pki.Certificate,
  privateKey: forge.pki.rsa.PrivateKey,
): void => {
  const wrapped = requiredNode(
    asn1Children(cms)[1],
    'CMS SignedData wrapper is absent',
  );
  const signedData = requiredNode(asn1Children(wrapped)[0], 'CMS SignedData is absent');
  const signerInfos = requiredNode(
    asn1Children(signedData).filter((node) => node.type === forge.asn1.Type.SET).at(-1),
    'CMS signer information is absent',
  );
  const signerInfo = requiredNode(asn1Children(signerInfos)[0], 'CMS signer is absent');
  const signerParts = asn1Children(signerInfo);
  const attributes = signerParts.find(
    (node) => node.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC && node.type === 0,
  );
  const signature = signerParts.find(
    (node) => node.tagClass === forge.asn1.Class.UNIVERSAL && node.type === forge.asn1.Type.OCTETSTRING,
  );
  if (!attributes || !signature) throw new Error('CMS signer attributes are absent');
  const attributeValues = asn1Children(attributes);
  attributeValues.push(signingCertificateV2(certificate));
  const attributeSet = forge.asn1.create(
    forge.asn1.Class.UNIVERSAL,
    forge.asn1.Type.SET,
    true,
    attributeValues,
  );
  const digest = forge.md.sha256.create();
  digest.update(forge.asn1.toDer(attributeSet).getBytes());
  signature.value = privateKey.sign(digest, 'RSASSA-PKCS1-V1_5');
};

const normalizeUtf8Names = (certificate: forge.pki.Certificate): void => {
  for (const attribute of [
    ...certificate.subject.attributes,
    ...certificate.issuer.attributes,
  ]) {
    if (
      Number(attribute.valueTagClass) === forge.asn1.Type.UTF8 &&
      typeof attribute.value === 'string'
    ) {
      attribute.value = forge.util.decodeUtf8(attribute.value);
    }
  }
};

class Utf8P12Signer extends Signer {
  readonly #p12: Buffer;
  readonly #passphrase: string;

  constructor(p12: Buffer, passphrase: string) {
    super();
    this.#p12 = p12;
    this.#passphrase = passphrase;
  }

  override async sign(pdfBuffer: Buffer, signingTime?: Date): Promise<Buffer> {
    const p12Asn1 = forge.asn1.fromDer(this.#p12.toString('binary'));
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, this.#passphrase);
    const certificateBagOid = '1.2.840.113549.1.12.10.1.3';
    const shroudedKeyBagOid = '1.2.840.113549.1.12.10.1.2';
    const keyBagOid = '1.2.840.113549.1.12.10.1.1';
    const certificateBags = p12Bags(p12, certificateBagOid);
    const keyBags = [
      ...p12Bags(p12, shroudedKeyBagOid),
      ...p12Bags(p12, keyBagOid),
    ];
    const privateKey = keyBags.find((bag) => bag.key)?.key;
    if (!privateKey) throw new Error('Seal P12 has no private key');

    const signedData = forge.pkcs7.createSignedData();
    signedData.content = forge.util.createBuffer(pdfBuffer.toString('binary'));
    let signerCertificate: forge.pki.Certificate | undefined;
    for (const bag of certificateBags) {
      const certificate = bag.cert;
      if (!certificate) continue;
      normalizeUtf8Names(certificate);
      signedData.addCertificate(certificate);
      if (
        'n' in certificate.publicKey &&
        privateKey.n.compareTo(certificate.publicKey.n) === 0 &&
        privateKey.e.compareTo(certificate.publicKey.e) === 0
      ) {
        signerCertificate = certificate;
      }
    }
    if (!signerCertificate) {
      throw new Error('Seal P12 has no certificate matching its private key');
    }
    const timeAttribute = { type: '1.2.840.113549.1.9.5', value: '' };
    Object.defineProperty(timeAttribute, 'value', {
      value: signingTime ?? new Date(),
      enumerable: true,
    });
    signedData.addSigner({
      key: privateKey,
      certificate: signerCertificate,
      digestAlgorithm: '2.16.840.1.101.3.4.2.1',
      authenticatedAttributes: [
        { type: '1.2.840.113549.1.9.3', value: '1.2.840.113549.1.7.1' },
        timeAttribute,
        { type: '1.2.840.113549.1.9.4' },
      ],
    });
    signedData.sign({ detached: true });
    const cms = signedData.toAsn1();
    addCadesCertificateBinding(cms, signerCertificate, privateKey);
    return Buffer.from(forge.asn1.toDer(cms).getBytes(), 'binary');
  }
}

const certificateSubject = (certificate: forge.pki.Certificate): string => {
  const commonName = certificate.subject.getField('CN');
  if (!commonName || typeof commonName.value !== 'string') {
    throw new Error('Seal certificate has no common name');
  }
  return forge.util.decodeUtf8(commonName.value);
};

const p12Certificate = (
  bytes: Buffer,
  passphrase: string,
): forge.pki.Certificate => {
  const asn1 = forge.asn1.fromDer(bytes.toString('binary'));
  const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, passphrase);
  const certificateBagOid = '1.2.840.113549.1.12.10.1.3';
  const certificateBags = p12Bags(p12, certificateBagOid);
  for (const bag of certificateBags) {
    if (bag.cert) return bag.cert;
  }
  throw new Error('Seal P12 has no certificate');
};

const signerAndSubject = (
  credentials: PdfSealCredentials,
): { signer: Signer; subject: string } => {
  if (credentials.kind === 'p12') {
    const bytes = Buffer.from(credentials.base64, 'base64');
    return {
      signer: new Utf8P12Signer(bytes, credentials.passphrase),
      subject: certificateSubject(p12Certificate(bytes, credentials.passphrase)),
    };
  }
  const certificate = forge.pki.certificateFromPem(credentials.certificate);
  const privateKey = forge.pki.privateKeyFromPem(credentials.privateKey);
  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(
    privateKey,
    certificate,
    '',
    { algorithm: '3des' },
  );
  const bytes = Buffer.from(forge.asn1.toDer(p12Asn1).getBytes(), 'binary');
  return {
    signer: new Utf8P12Signer(bytes, ''),
    subject: certificateSubject(certificate),
  };
};

export const pdfSealCertificateSubject = (
  credentials: PdfSealCredentials,
): string =>
  credentials.kind === 'p12'
    ? certificateSubject(
        p12Certificate(
          Buffer.from(credentials.base64, 'base64'),
          credentials.passphrase,
        ),
      )
    : certificateSubject(forge.pki.certificateFromPem(credentials.certificate));

export const createSignPdfSeal = (
  credentials: PdfSealCredentials | null,
): PdfSealPort => {
  if (!credentials) return { configured: false };
  return {
    configured: true,
    seal: async ({ bytes, signingTime, contributorNames }) => {
      try {
        const pdf = await PDFDocument.load(bytes);
        const prepared = signerAndSubject(credentials);
        const existingSignatureCount = pdf.getForm().getFields()
          .filter((field) => field instanceof PDFSignature)
          .length;
        pdflibAddPlaceholder({
          pdfDoc: pdf,
          reason: `Signed by: ${contributorNames.join(', ')}`,
          contactInfo: '',
          name: prepared.subject,
          location: 'Poland',
          signingTime,
          signatureLength: 16_384,
          subFilter: SUBFILTER_ETSI_CADES_DETACHED,
          widgetRect: [0, 0, 0, 0],
          appName: 'docu-signer',
        });
        const signatureField = pdf.getForm().getFields().at(-1);
        if (!(signatureField instanceof PDFSignature)) {
          throw new Error('Seal signature field was not created');
        }
        signatureField.acroField.setPartialName(`Pieczec-${existingSignatureCount + 1}`);
        const placeholderPdf = await PDFDocument.load(
          await pdf.save({ useObjectStreams: false }),
        );
        const placeholderField = placeholderPdf.getForm().getFields().at(-1);
        if (!(placeholderField instanceof PDFSignature)) {
          throw new Error('Seal signature field could not be loaded');
        }
        const signatureDictionary = placeholderField.acroField.V();
        if (!(signatureDictionary instanceof PDFDict)) {
          throw new Error('Seal signature dictionary could not be loaded');
        }
        signatureDictionary.set(
          PDFName.of('Reason'),
          PDFHexString.fromText(`Signed by: ${contributorNames.join(', ')}`),
        );
        signatureDictionary.set(
          PDFName.of('Name'),
          PDFHexString.fromText(prepared.subject),
        );
        const placeholder = await placeholderPdf.save({ useObjectStreams: false });
        const sealed = await signPdf.sign(
          Buffer.from(placeholder),
          prepared.signer,
          signingTime,
        );
        return {
          kind: 'sealed',
          bytes: new Uint8Array(sealed),
          subject: prepared.subject,
        };
      } catch (cause) {
        return { kind: 'failed', reason: String(cause) };
      }
    },
  };
};
