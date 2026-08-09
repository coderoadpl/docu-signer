import { type KeyboardEvent, useMemo } from 'react';
import { Box, Paper } from '@mui/material';
import { alpha, useTheme, type Theme } from '@mui/material/styles';

import { type DocumentType, type DocumentWithFiles } from '#core/domain/index.js';

import { formatPolishDate } from '../../lib/format-date.js';
import {
  DOCUMENT_TYPE_LABELS,
  SIGNATURE_STATUS_LABELS,
  createTimelineScale,
  groupDocumentsForTimeline,
  timelineMonthTicks,
} from './documents.logic.js';

const LEFT_GUTTER = 148;
const RIGHT_GUTTER = 28;
const TOP_GUTTER = 52;
const GROUP_LABEL_Y = 20;
const BAND_Y = 28;
const DOC_START_Y = 58;
const DOC_ROW_HEIGHT = 30;
const GROUP_BOTTOM = 20;
const GROUP_GAP = 18;

const documentColor = (docType: DocumentType, theme: Theme): string => {
  if (docType === 'umowa-uod') return theme.palette.primary.main;
  if (docType === 'uchwala') return '#7a5c8f';
  if (docType === 'protokol') return '#2f855a';
  if (docType === 'rachunek') return '#b36b1f';
  return theme.palette.text.secondary;
};

const groupHeight = (documentCount: number): number =>
  DOC_START_Y + Math.max(1, documentCount) * DOC_ROW_HEIGHT + GROUP_BOTTOM;

const clamp = (value: number, max: number): number => Math.max(0, Math.min(max, value));

const diamondPoints = (x: number, y: number, radius: number): string =>
  `${x},${y - radius} ${x + radius},${y} ${x},${y + radius} ${x - radius},${y}`;

const documentTooltip = (
  document: {
    title: string;
    docType: DocumentType;
    start: string;
    end: string;
    instant: boolean;
    signed: boolean;
  },
): string => {
  const dates = document.instant
    ? formatPolishDate(document.start)
    : `${formatPolishDate(document.start)} - ${formatPolishDate(document.end)}`;
  return `${document.title}\n${DOCUMENT_TYPE_LABELS[document.docType]}\n${dates}\n${
    SIGNATURE_STATUS_LABELS[document.signed ? 'signed' : 'needs-signature']
  }`;
};

export const DocumentTimelineView = ({
  documents,
  onOpenDocument,
}: {
  documents: DocumentWithFiles[];
  onOpenDocument: (documentId: string) => void;
}) => {
  const theme = useTheme();
  const groups = useMemo(() => groupDocumentsForTimeline(documents), [documents]);
  const intervals = useMemo(() => groups.flatMap((group) => group.intervals), [groups]);
  const scale = useMemo(() => createTimelineScale(intervals), [intervals]);
  const ticks = useMemo(() => timelineMonthTicks(scale), [scale]);
  const positionedGroups = useMemo(
    () =>
      groups.reduce<Array<{ group: (typeof groups)[number]; y: number }>>((items, group) => {
        const previous = items.at(-1);
        const y = previous
          ? previous.y + groupHeight(previous.group.documents.length) + GROUP_GAP
          : TOP_GUTTER;
        return [...items, { group, y }];
      }, []),
    [groups],
  );
  const contentWidth = LEFT_GUTTER + scale.width + RIGHT_GUTTER;
  const contentHeight =
    TOP_GUTTER +
    groups.reduce((height, group) => height + groupHeight(group.documents.length) + GROUP_GAP, 0);

  const activate = (documentId: string) => onOpenDocument(documentId);
  const keyActivate = (event: KeyboardEvent<SVGGElement>, documentId: string) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    activate(documentId);
  };

  return (
    <Paper variant="outlined" sx={{ mt: 3, overflow: 'hidden' }}>
      <Box sx={{ overflowX: 'auto' }}>
        <Box
          component="svg"
          role="img"
          aria-label="Os czasu dokumentów"
          viewBox={`0 0 ${contentWidth} ${contentHeight}`}
          sx={{
            display: 'block',
            minWidth: `${contentWidth}px`,
            width: '100%',
            height: `${contentHeight}px`,
          }}
          style={{ backgroundColor: theme.palette.background.paper }}
        >
          <rect width={contentWidth} height={contentHeight} fill={theme.palette.background.paper} />
          {ticks.map((tick) => {
            const x = LEFT_GUTTER + clamp(scale.x(tick.date), scale.width);
            return (
              <g key={tick.date}>
                <line
                  x1={x}
                  x2={x}
                  y1={28}
                  y2={contentHeight - 8}
                  stroke={theme.palette.divider}
                  strokeDasharray="2 6"
                />
                <text
                  x={x + 4}
                  y={24}
                  fill={theme.palette.text.secondary}
                  fontSize="12"
                >
                  {tick.label}
                </text>
              </g>
            );
          })}
          {positionedGroups.map(({ group, y }) => {
            return (
              <g key={group.person} aria-label={`Sekcja osoby ${group.person}`}>
                <text
                  x={20}
                  y={y + GROUP_LABEL_Y}
                  fill={theme.palette.text.primary}
                  fontSize="14"
                  fontWeight="600"
                >
                  {group.person}
                </text>
                <line
                  x1={LEFT_GUTTER}
                  x2={LEFT_GUTTER + scale.width}
                  y1={y + BAND_Y + 6}
                  y2={y + BAND_Y + 6}
                  stroke={theme.palette.divider}
                />
                {group.intervals.map((interval) => {
                  const x = LEFT_GUTTER + scale.x(interval.start);
                  const width = Math.max(8, scale.x(interval.end) - scale.x(interval.start));
                  return (
                    <rect
                      key={`${group.person}-${interval.start}-${interval.end}`}
                      data-testid={`timeline-band-${group.person}`}
                      x={x}
                      y={y + BAND_Y}
                      width={width}
                      height={12}
                      rx={6}
                      fill={alpha(theme.palette.primary.main, 0.18)}
                      stroke={alpha(theme.palette.primary.main, 0.36)}
                    />
                  );
                })}
                {group.documents.map((document, index) => {
                  const rowY = y + DOC_START_Y + index * DOC_ROW_HEIGHT;
                  const startX = LEFT_GUTTER + scale.x(document.start);
                  const endX = LEFT_GUTTER + scale.x(document.end);
                  const width = Math.max(12, endX - startX);
                  const color = documentColor(document.docType, theme);
                  const markerX = document.instant ? startX + 16 : startX + width + 12;
                  const label = `Otwórz dokument ${document.title}, ${
                    SIGNATURE_STATUS_LABELS[document.signed ? 'signed' : 'needs-signature']
                  }`;
                  return (
                    <g
                      key={document.id}
                      role="button"
                      tabIndex={0}
                      aria-label={label}
                      onClick={() => activate(document.id)}
                      onKeyDown={(event) => keyActivate(event, document.id)}
                      cursor="pointer"
                    >
                      <title>{documentTooltip(document)}</title>
                      {document.instant ? (
                        <polygon
                          points={diamondPoints(startX, rowY, 7)}
                          fill={color}
                          stroke={theme.palette.background.paper}
                          strokeWidth={1.5}
                          data-testid={`timeline-document-${document.id}`}
                        />
                      ) : (
                        <rect
                          x={startX}
                          y={rowY - 5}
                          width={width}
                          height={10}
                          rx={5}
                          fill={color}
                          data-testid={`timeline-document-${document.id}`}
                        />
                      )}
                      <text
                        x={markerX + 12}
                        y={rowY + 4}
                        fill={theme.palette.text.primary}
                        fontSize="13"
                      >
                        {document.title}
                      </text>
                      <g
                        role="img"
                        aria-label={`Status podpisu ${document.title}: ${
                          SIGNATURE_STATUS_LABELS[document.signed ? 'signed' : 'needs-signature']
                        }`}
                        data-testid={`timeline-status-${document.id}`}
                      >
                        <circle
                          cx={markerX}
                          cy={rowY}
                          r={7}
                          fill={
                            document.signed
                              ? theme.palette.success.main
                              : theme.palette.background.paper
                          }
                          stroke={
                            document.signed
                              ? theme.palette.success.main
                              : theme.palette.text.secondary
                          }
                          strokeWidth={1.6}
                        />
                        {document.signed ? (
                          <path
                            d={`M${markerX - 3.5} ${rowY}l2.2 2.2 4.4-5`}
                            fill="none"
                            stroke={theme.palette.success.contrastText}
                            strokeWidth={1.8}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        ) : null}
                      </g>
                    </g>
                  );
                })}
              </g>
            );
          })}
        </Box>
      </Box>
    </Paper>
  );
};
