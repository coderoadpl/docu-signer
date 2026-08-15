import {
  StandardFonts,
  rgb,
  type PDFDocument,
  type PDFFont,
  type PDFPage,
  type RGB,
} from 'pdf-lib';

import type { SignersBoxModel } from './signers-box.js';

type Accent = 'acute' | 'dot' | 'ogonek' | 'slash';

interface PdfText {
  value: string;
  accents: Array<{ index: number; accent: Accent }>;
}

const pdfText = (value: string): PdfText => {
  const safe: string[] = [];
  const accents: Array<{ index: number; accent: Accent }> = [];
  for (const character of Array.from(value)) {
    if (character === 'Ł' || character === 'ł') {
      accents.push({ index: safe.length, accent: 'slash' });
      safe.push(character === 'Ł' ? 'L' : 'l');
      continue;
    }
    const normalized = character.normalize('NFD');
    const base = normalized[0] ?? '';
    if (/^[\x20-\x7E]$/u.test(base)) {
      const index = safe.length;
      safe.push(base);
      for (const mark of normalized.slice(1)) {
        if (mark === '\u0301') accents.push({ index, accent: 'acute' });
        if (mark === '\u0307') accents.push({ index, accent: 'dot' });
        if (mark === '\u0328') accents.push({ index, accent: 'ogonek' });
      }
      continue;
    }
    safe.push(
      ['·', '—', '–', '…', '’', '“', '”'].includes(character)
        ? character
        : '-',
    );
  }
  return { value: safe.join(''), accents };
};

const textWidth = (
  text: PdfText,
  font: PDFFont,
  size: number,
  characterSpacing = 0,
): number =>
  font.widthOfTextAtSize(text.value, size) +
  Math.max(0, text.value.length - 1) * characterSpacing;

const drawAccent = (
  page: PDFPage,
  accent: Accent,
  x: number,
  y: number,
  width: number,
  size: number,
  color: RGB,
) => {
  const lineWidth = Math.max(0.35, size * 0.055);
  if (accent === 'acute') {
    page.drawLine({
      start: { x: x + width * 0.5, y: y + size * 0.84 },
      end: { x: x + width * 0.72, y: y + size * 1.05 },
      thickness: lineWidth,
      color,
    });
  }
  if (accent === 'dot') {
    page.drawCircle({
      x: x + width * 0.55,
      y: y + size * 0.98,
      size: Math.max(0.45, size * 0.055),
      color,
    });
  }
  if (accent === 'ogonek') {
    page.drawLine({
      start: { x: x + width * 0.62, y: y + size * 0.08 },
      end: { x: x + width * 0.5, y: y - size * 0.17 },
      thickness: lineWidth,
      color,
    });
    page.drawLine({
      start: { x: x + width * 0.5, y: y - size * 0.17 },
      end: { x: x + width * 0.65, y: y - size * 0.22 },
      thickness: lineWidth,
      color,
    });
  }
  if (accent === 'slash') {
    page.drawLine({
      start: { x: x + width * 0.08, y: y + size * 0.27 },
      end: { x: x + width * 0.88, y: y + size * 0.67 },
      thickness: lineWidth,
      color,
    });
  }
};

const drawText = (input: {
  page: PDFPage;
  value: string;
  font: PDFFont;
  size: number;
  x: number;
  y: number;
  color: RGB;
  characterSpacing?: number;
}) => {
  const encoded = pdfText(input.value);
  const spacing = input.characterSpacing ?? 0;
  let cursor = input.x;
  Array.from(encoded.value).forEach((character, index) => {
    input.page.drawText(character, {
      x: cursor,
      y: input.y,
      size: input.size,
      font: input.font,
      color: input.color,
    });
    const width = input.font.widthOfTextAtSize(character, input.size);
    for (const item of encoded.accents.filter((accent) => accent.index === index)) {
      drawAccent(
        input.page,
        item.accent,
        cursor,
        input.y,
        width,
        input.size,
        input.color,
      );
    }
    cursor += width + spacing;
  });
};

const drawRightAlignedText = (input: Omit<Parameters<typeof drawText>[0], 'x'> & {
  right: number;
}): number => {
  const encoded = pdfText(input.value);
  const width = textWidth(
    encoded,
    input.font,
    input.size,
    input.characterSpacing,
  );
  drawText({ ...input, x: input.right - width });
  return width;
};

const fittedText = (
  value: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string => {
  if (textWidth(pdfText(value), font, size) <= maxWidth) return value;
  const suffix = '...';
  let fitted = value;
  while (
    fitted.length > 0 &&
    textWidth(pdfText(`${fitted}${suffix}`), font, size) > maxWidth
  ) {
    fitted = fitted.slice(0, -1);
  }
  return `${fitted.trimEnd()}${suffix}`;
};

export const drawSignersBox = async (
  pdf: PDFDocument,
  model: SignersBoxModel,
): Promise<void> => {
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.getPage(0);
  const x = page.getWidth() - model.margin - model.width;
  const y = page.getHeight() - model.margin - model.height;
  const right = x + model.width - model.paddingX;
  const navy = rgb(0.12, 0.23, 0.34);
  const border = rgb(0.58, 0.64, 0.7);
  const separator = rgb(0.87, 0.89, 0.91);
  const gray = rgb(0.4, 0.43, 0.47);
  const subjectGray = rgb(0.54, 0.57, 0.61);
  const black = rgb(0.07, 0.07, 0.07);
  page.drawRectangle({
    x,
    y,
    width: model.width,
    height: model.height,
    color: rgb(1, 1, 1),
    borderColor: border,
    borderWidth: 0.7,
  });
  let top = y + model.height - model.paddingTop;
  if (model.sealCertificateSubject) {
    const subject = fittedText(
      model.sealCertificateSubject,
      regular,
      5.2,
      model.width - model.paddingX * 2,
    );
    drawRightAlignedText({
      page,
      value: subject,
      font: regular,
      size: 5.2,
      right,
      y: top - 5.2,
      color: subjectGray,
      characterSpacing: 0.28,
    });
    top -= model.subjectHeight;
  }
  const iconRadius = 7;
  const iconX = right - iconRadius;
  const iconY = top - 8;
  const headerRight = iconX - iconRadius - 6;
  drawRightAlignedText({
    page,
    value: model.header,
    font: bold,
    size: 7.2,
    right: headerRight,
    y: iconY - 2.5,
    color: navy,
    characterSpacing: 0.45,
  });
  page.drawCircle({
    x: iconX,
    y: iconY,
    size: iconRadius,
    borderColor: navy,
    borderWidth: 1,
  });
  page.drawCircle({
    x: iconX,
    y: iconY,
    size: 4.7,
    borderColor: navy,
    borderWidth: 0.65,
  });
  page.drawLine({
    start: { x: iconX - 2.1, y: iconY - 0.2 },
    end: { x: iconX - 0.5, y: iconY - 1.8 },
    thickness: 1.15,
    color: navy,
  });
  page.drawLine({
    start: { x: iconX - 0.5, y: iconY - 1.8 },
    end: { x: iconX + 2.7, y: iconY + 2.1 },
    thickness: 1.15,
    color: navy,
  });
  top -= model.headerHeight;
  page.drawLine({
    start: { x: x + model.paddingX, y: top + 3 },
    end: { x: right, y: top + 3 },
    thickness: 0.55,
    color: separator,
  });
  model.entries.forEach((entry, index) => {
    const baseline = top - index * model.rowHeight - 7.5;
    const name = fittedText(entry.name, bold, 8.3, model.width * 0.52);
    const nameWidth = drawRightAlignedText({
      page,
      value: name,
      font: bold,
      size: 8.3,
      right,
      y: baseline,
      color: black,
    });
    const separatorRight = right - nameWidth - 2.5;
    const separatorWidth = drawRightAlignedText({
      page,
      value: '·',
      font: regular,
      size: 8,
      right: separatorRight,
      y: baseline,
      color: gray,
    });
    drawRightAlignedText({
      page,
      value: entry.signedAt,
      font: regular,
      size: 8,
      right: separatorRight - separatorWidth - 2.5,
      y: baseline,
      color: gray,
    });
  });
};
