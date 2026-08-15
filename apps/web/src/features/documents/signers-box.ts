export interface SignersBoxSigner {
  accountId: string;
  name: string;
}

interface SignersBoxEntry extends SignersBoxSigner {
  signedAt: string;
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

export const formatSignersBoxDate = (
  documentDate: string,
  wallClock: Date,
): string => {
  const [year, month, day] = documentDate.split('-');
  if (!year || !month || !day) throw new Error('Invalid document signing date');
  return `${day}.${month}.${year} ${wallClock.toISOString().slice(11, 16)}`;
};

export const buildSignersBox = (input: {
  documentDate: string;
  wallClock: Date;
  signers: readonly SignersBoxSigner[];
  sealCertificateSubject?: string;
}): SignersBoxModel | null => {
  const seen = new Set<string>();
  const signedAt = formatSignersBoxDate(input.documentDate, input.wallClock);
  const entries = input.signers.flatMap((signer) => {
    if (seen.has(signer.accountId)) return [];
    seen.add(signer.accountId);
    return [{ ...signer, signedAt }];
  });
  if (entries.length === 0) return null;
  const subject = input.sealCertificateSubject?.trim();
  const subjectHeight = subject ? 10 : 0;
  const headerHeight = 22;
  const rowHeight = 12;
  const paddingTop = 8;
  const paddingBottom = 7;
  return {
    width: 210,
    height:
      paddingTop +
      subjectHeight +
      headerHeight +
      entries.length * rowHeight +
      paddingBottom,
    margin: 14,
    paddingX: 10,
    paddingTop,
    paddingBottom,
    subjectHeight,
    headerHeight,
    rowHeight,
    header: 'PODPISANO ELEKTRONICZNIE',
    ...(subject ? { sealCertificateSubject: subject.toLocaleUpperCase('pl-PL') } : {}),
    entries,
  };
};
