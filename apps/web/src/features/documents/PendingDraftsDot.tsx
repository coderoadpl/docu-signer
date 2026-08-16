import { Tooltip } from '@mui/material';

import type { PendingDraftCounts } from '#core/domain/index.js';

import { PendingDraftStatusDot } from '../../theme.js';

const plural = (
  count: number,
  singular: string,
  few: string,
  many: string,
): string => {
  const lastTwo = count % 100;
  const last = count % 10;
  const form = count === 1 ? singular : last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14) ? few : many;
  return `${count} ${form}`;
};

const pendingDraftsTooltip = (counts: PendingDraftCounts): string =>
  [
    counts.metadataProposals > 0
      ? plural(counts.metadataProposals, 'propozycja zmian', 'propozycje zmian', 'propozycji zmian')
      : '',
    counts.comments > 0
      ? plural(counts.comments, 'komentarz-szkic', 'komentarze-szkice', 'komentarzy-szkiców')
      : '',
    counts.links > 0
      ? plural(counts.links, 'powiązanie-szkic', 'powiązania-szkice', 'powiązań-szkiców')
      : '',
  ]
    .filter(Boolean)
    .join(', ');

export const PendingDraftsDot = ({ counts }: { counts: PendingDraftCounts }) => {
  const label = pendingDraftsTooltip(counts);
  if (!label) return null;
  return (
    <Tooltip title={label} describeChild>
      <PendingDraftStatusDot
        aria-label={label}
        sx={{
          flex: '0 0 auto',
          ml: 0.75,
          verticalAlign: 'middle',
        }}
      />
    </Tooltip>
  );
};
