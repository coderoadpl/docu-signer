import forge from 'node-forge';
import { PDFHexString } from 'pdf-lib';

import {
  pdfSealVerificationSchema,
  type PdfSealVerification,
} from '#core/domain/index.js';
import type { PdfSealVerificationPort } from '#core/server/index.js';

export type { PdfSealVerification } from '#core/domain/index.js';

const children = (node: forge.asn1.Asn1): forge.asn1.Asn1[] => {
  if (!Array.isArray(node.value)) throw new Error('Expected constructed ASN.1 value');
  return node.value;
};

const bytes = (node: forge.asn1.Asn1): string => {
  if (typeof node.value !== 'string') throw new Error('Expected primitive ASN.1 value');
  return node.value;
};

const oid = (node: forge.asn1.Asn1): string => forge.asn1.derToOid(bytes(node));

const messageDigestOid = '1.2.840.113549.1.9.4';
const signingTimeOid = '1.2.840.113549.1.9.5';

const exactDer = (padded: Buffer): Buffer => {
  if (padded.length < 2) throw new Error('CMS value is empty');
  const firstLength = padded.readUInt8(1);
  if ((firstLength & 0x80) === 0) return padded.subarray(0, firstLength + 2);
  const lengthBytes = firstLength & 0x7f;
  if (lengthBytes === 0 || lengthBytes > 6 || padded.length < 2 + lengthBytes) {
    throw new Error('CMS length is invalid');
  }
  let contentLength = 0;
  for (let index = 0; index < lengthBytes; index += 1) {
    contentLength = contentLength * 256 + padded.readUInt8(2 + index);
  }
  return padded.subarray(0, 2 + lengthBytes + contentLength);
};

const subjectName = (certificate: forge.pki.Certificate): string => {
  const commonName = certificate.subject.getField('CN');
  if (!commonName || typeof commonName.value !== 'string') {
    throw new Error('Seal certificate has no common name');
  }
  return forge.util.decodeUtf8(commonName.value);
};

const signedAttribute = (
  attributes: forge.asn1.Asn1[],
  targetOid: string,
): forge.asn1.Asn1 | undefined =>
  attributes.find((attribute) => {
    const parts = children(attribute);
    return parts[0] ? oid(parts[0]) === targetOid : false;
  });

const attributeValue = (attribute: forge.asn1.Asn1): forge.asn1.Asn1 => {
  const values = children(attribute);
  const set = values[1];
  if (!set) throw new Error('CMS attribute value set is absent');
  const value = children(set)[0];
  if (!value) throw new Error('CMS attribute value is absent');
  return value;
};

const signingTime = (attributes: forge.asn1.Asn1[]): Date => {
  const attribute = signedAttribute(
    attributes,
    signingTimeOid,
  );
  if (!attribute) throw new Error('CMS signingTime is absent');
  const value = attributeValue(attribute);
  if (value.type === forge.asn1.Type.UTCTIME) return forge.asn1.utcTimeToDate(bytes(value));
  if (value.type === forge.asn1.Type.GENERALIZEDTIME) {
    return forge.asn1.generalizedTimeToDate(bytes(value));
  }
  throw new Error('CMS signingTime has an unsupported encoding');
};

const pdfTextEntry = (source: string, key: 'Name' | 'Reason'): string | null => {
  const matches = [...source.matchAll(new RegExp(`/${key}\\s*<([0-9a-f\\s]+)>`, 'giu'))];
  const encoded = matches.at(-1)?.[1];
  return encoded === undefined
    ? null
    : PDFHexString.of(encoded.replaceAll(/\s/gu, '')).decodeText();
};

const pdfSignature = (pdf: Buffer) => {
  const source = pdf.toString('latin1');
  const matches = [...source.matchAll(
    /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/gu,
  )];
  const match = matches.at(-1);
  if (!match || match.index === undefined) throw new Error('PDF has no digital signature');
  const firstStart = Number(match[1]);
  const firstLength = Number(match[2]);
  const secondStart = Number(match[3]);
  const secondLength = Number(match[4]);
  const contentsMarker = source.indexOf('/Contents ', match.index);
  const contentsStart = source.indexOf('<', contentsMarker);
  const contentsEnd = source.indexOf('>', contentsStart);
  if (contentsMarker < 0 || contentsStart < 0 || contentsEnd < 0) {
    throw new Error('PDF signature contents are absent');
  }
  const objectStartMatches = [...source.slice(0, match.index).matchAll(/\d+\s+\d+\s+obj\b/gu)];
  const objectStart = objectStartMatches.at(-1)?.index ?? 0;
  const objectEnd = source.indexOf('endobj', contentsEnd);
  const dictionarySource = source.slice(objectStart, objectEnd < 0 ? contentsEnd : objectEnd);
  const byteRangeValid =
    firstStart === 0 &&
    firstLength === contentsStart &&
    secondStart === contentsEnd + 1 &&
    secondStart + secondLength === pdf.length;
  const signedBytes = Buffer.concat([
    pdf.subarray(firstStart, firstStart + firstLength),
    pdf.subarray(secondStart, secondStart + secondLength),
  ]);
  const cmsHex = source.slice(contentsStart + 1, contentsEnd);
  if (!/^[0-9a-f]+$/iu.test(cmsHex) || cmsHex.length % 2 !== 0) {
    throw new Error('PDF signature contents are not hexadecimal CMS');
  }
  return {
    byteRangeValid,
    signedBytes,
    cms: exactDer(Buffer.from(cmsHex, 'hex')),
    name: pdfTextEntry(dictionarySource, 'Name'),
    reason: pdfTextEntry(dictionarySource, 'Reason'),
  };
};

export const verifyPdfSeal = (input: Uint8Array): PdfSealVerification => {
  const pdf = Buffer.from(input);
  const signature = pdfSignature(pdf);
  const cms = forge.asn1.fromDer(signature.cms.toString('binary'));
  const root = children(cms);
  const wrappedSignedData = root[1];
  if (!wrappedSignedData) throw new Error('CMS SignedData wrapper is absent');
  const signedDataSequence = children(wrappedSignedData)[0];
  if (!signedDataSequence) throw new Error('CMS SignedData is absent');
  const signedData = children(signedDataSequence);
  const certificatesNode = signedData.find(
    (node) => node.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC && node.type === 0,
  );
  const signerInfosNode = signedData
    .filter((node) => node.type === forge.asn1.Type.SET)
    .at(-1);
  if (!certificatesNode || !signerInfosNode) {
    throw new Error('CMS certificate or signer information is absent');
  }
  const certificateNode = children(certificatesNode)[0];
  const signerInfo = children(signerInfosNode)[0];
  if (!certificateNode || !signerInfo) throw new Error('CMS signer is absent');
  const certificate = forge.pki.certificateFromAsn1(certificateNode);
  const signerParts = children(signerInfo);
  const attributesNode = signerParts.find(
    (node) => node.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC && node.type === 0,
  );
  const signatureNode = signerParts.find(
    (node) => node.tagClass === forge.asn1.Class.UNIVERSAL && node.type === forge.asn1.Type.OCTETSTRING,
  );
  if (!attributesNode || !signatureNode) {
    throw new Error('CMS authenticated attributes or signature are absent');
  }
  const attributes = children(attributesNode);
  const digestAttribute = signedAttribute(
    attributes,
    messageDigestOid,
  );
  if (!digestAttribute) throw new Error('CMS messageDigest is absent');
  const expectedDigest = bytes(attributeValue(digestAttribute));
  const contentDigest = forge.md.sha256.create();
  contentDigest.update(signature.signedBytes.toString('binary'));
  const digestValid = contentDigest.digest().getBytes() === expectedDigest;
  const attributesSet = forge.asn1.create(
    forge.asn1.Class.UNIVERSAL,
    forge.asn1.Type.SET,
    true,
    attributes,
  );
  const attributesDigest = forge.md.sha256.create();
  attributesDigest.update(forge.asn1.toDer(attributesSet).getBytes());
  if (!('verify' in certificate.publicKey)) {
    throw new Error('Seal certificate public key cannot verify RSA signatures');
  }
  let signatureValid = false;
  try {
    signatureValid = certificate.publicKey.verify(
      attributesDigest.digest().getBytes(),
      bytes(signatureNode),
    );
  } catch {
    signatureValid = false;
  }
  const byteRangeValid = signature.byteRangeValid;
  return pdfSealVerificationSchema.parse({
    subject: subjectName(certificate),
    name: signature.name,
    reason: signature.reason,
    declaredAt: signingTime(attributes).toISOString(),
    byteRangeValid,
    digestValid,
    signatureValid,
    integrity: byteRangeValid && digestValid && signatureValid,
  });
};

export const createPdfSealVerificationPort = (): PdfSealVerificationPort => ({
  verify: verifyPdfSeal,
});
