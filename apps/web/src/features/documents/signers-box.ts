export interface SignersBoxSigner {
  accountId: string;
  name: string;
}

export interface SignersBoxPriorSigner extends SignersBoxSigner {
  declaredAt: string;
}

interface SignersBoxEntry extends SignersBoxSigner {
  signedAt: string;
}

interface SignerBoxRecord {
  fileId: string;
  signerBoxEntries: readonly SignersBoxPriorSigner[] | null;
}

export interface SignersBoxBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SignersBoxModel {
  width: number;
  height: number;
  margin: number;
  paddingX: number;
  paddingTop: number;
  paddingBottom: number;
  subjectHeight: number;
  headerHeight: number;
  rowHeight: number;
  header: string;
  sealCertificateSubject?: string;
  entries: SignersBoxEntry[];
}

const SIGNERS_BOX_GEOMETRY = {
  width: 210,
  margin: 14,
  paddingX: 10,
  paddingTop: 8,
  paddingBottom: 7,
  subjectHeight: 10,
  headerHeight: 22,
  rowHeight: 12,
} as const;

export const signersBoxBounds = (
  pageWidth: number,
  pageHeight: number,
  model: SignersBoxModel,
): SignersBoxBounds => ({
  x: pageWidth - model.margin - model.width,
  y: pageHeight - model.margin - model.height,
  width: model.width,
  height: model.height,
});

export const formatSignersBoxDate = (
  documentDate: string,
  wallClock: Date,
): string => {
  const [year, month, day] = documentDate.split('-');
  if (!year || !month || !day) throw new Error('Invalid document signing date');
  const hours = String(wallClock.getHours()).padStart(2, '0');
  const minutes = String(wallClock.getMinutes()).padStart(2, '0');
  return `${day}.${month}.${year} ${hours}:${minutes}`;
};

export const formatSignersBoxDeclaredAt = (declaredAt: string): string => {
  const [documentDate] = declaredAt.split('T');
  const wallClock = new Date(declaredAt);
  if (!documentDate || Number.isNaN(wallClock.getTime())) {
    throw new Error('Invalid declared signing date');
  }
  return formatSignersBoxDate(documentDate, wallClock);
};

export const priorSignersBoxEntries = (
  recordsNewestFirst: readonly SignerBoxRecord[],
  targetFileId: string,
): SignersBoxPriorSigner[] | null => {
  const chronological = [...recordsNewestFirst].reverse();
  const targetIndex = chronological.findLastIndex(
    (record) => record.fileId === targetFileId,
  );
  if (targetIndex < 0) return null;
  const history = chronological.slice(0, targetIndex + 1);
  if (
    history.some(
      (record) =>
        record.signerBoxEntries === null || record.signerBoxEntries.length === 0,
    )
  ) {
    return null;
  }
  return history.flatMap((record) => record.signerBoxEntries ?? []);
};

export const buildSignersBox = (input: {
  documentDate: string;
  wallClock: Date;
  signers: readonly SignersBoxSigner[];
  priorSigners?: readonly SignersBoxPriorSigner[];
  sealCertificateSubject?: string;
}): SignersBoxModel | null => {
  const seen = new Set<string>();
  const signedAt = formatSignersBoxDate(input.documentDate, input.wallClock);
  const currentEntries = input.signers.flatMap((signer) => {
    if (seen.has(signer.accountId)) return [];
    seen.add(signer.accountId);
    return [{ ...signer, signedAt }];
  });
  const entries = [
    ...(input.priorSigners ?? []).map((signer) => ({
      accountId: signer.accountId,
      name: signer.name,
      signedAt: formatSignersBoxDeclaredAt(signer.declaredAt),
    })),
    ...currentEntries,
  ];
  if (entries.length === 0) return null;
  const subject = input.sealCertificateSubject?.trim();
  const subjectHeight = subject ? SIGNERS_BOX_GEOMETRY.subjectHeight : 0;
  return {
    width: SIGNERS_BOX_GEOMETRY.width,
    height:
      SIGNERS_BOX_GEOMETRY.paddingTop +
      subjectHeight +
      SIGNERS_BOX_GEOMETRY.headerHeight +
      entries.length * SIGNERS_BOX_GEOMETRY.rowHeight +
      SIGNERS_BOX_GEOMETRY.paddingBottom,
    margin: SIGNERS_BOX_GEOMETRY.margin,
    paddingX: SIGNERS_BOX_GEOMETRY.paddingX,
    paddingTop: SIGNERS_BOX_GEOMETRY.paddingTop,
    paddingBottom: SIGNERS_BOX_GEOMETRY.paddingBottom,
    subjectHeight,
    headerHeight: SIGNERS_BOX_GEOMETRY.headerHeight,
    rowHeight: SIGNERS_BOX_GEOMETRY.rowHeight,
    header: 'PODPISANO ELEKTRONICZNIE',
    ...(subject ? { sealCertificateSubject: subject.toLocaleUpperCase('pl-PL') } : {}),
    entries,
  };
};
