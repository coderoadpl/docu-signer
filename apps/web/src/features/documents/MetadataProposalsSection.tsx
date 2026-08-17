import {
  Alert,
  Button,
  List,
  ListItem,
  Paper,
  Stack,
  Typography,
} from '@mui/material';

import type {
  DocumentDetail,
  DocumentMetadataProposalListItem,
  DocumentType,
} from '#core/domain/index.js';

import { formatPolishDate } from '../../lib/format-date.js';
import { documentTypeLabel } from './documents.logic.js';

const textValue = (value: string | null): string => value ?? 'Brak';
const tagsValue = (value: string[]): string => value.length > 0 ? value.join(', ') : 'Brak';

const proposalDiff = (
  document: DocumentDetail,
  proposal: DocumentMetadataProposalListItem,
  documentTypes: readonly DocumentType[],
) => {
  const changes = proposal.changes;
  return [
    changes.title === undefined
      ? null
      : { label: 'Tytuł', current: document.title, proposed: changes.title },
    changes.docType === undefined
      ? null
      : {
          label: 'Typ',
          current: documentTypeLabel(documentTypes, document.docType),
          proposed: documentTypeLabel(documentTypes, changes.docType),
        },
    changes.person === undefined
      ? null
      : {
          label: 'Strona',
          current: textValue(document.person),
          proposed: textValue(changes.person),
        },
    changes.documentDate === undefined
      ? null
      : {
          label: 'Data podpisania',
          current: formatPolishDate(document.documentDate),
          proposed: formatPolishDate(changes.documentDate),
        },
    changes.periodStart === undefined
      ? null
      : {
          label: 'Okres od',
          current: document.periodStart ? formatPolishDate(document.periodStart) : 'Brak',
          proposed: changes.periodStart ? formatPolishDate(changes.periodStart) : 'Brak',
        },
    changes.periodEnd === undefined
      ? null
      : {
          label: 'Okres do',
          current: document.periodEnd ? formatPolishDate(document.periodEnd) : 'Brak',
          proposed: changes.periodEnd ? formatPolishDate(changes.periodEnd) : 'Brak',
        },
    changes.tags === undefined
      ? null
      : {
          label: 'Tagi',
          current: tagsValue(document.tags),
          proposed: tagsValue(changes.tags),
        },
  ].filter((entry): entry is { label: string; current: string; proposed: string } => entry !== null);
};

export const MetadataProposalsSection = ({
  document,
  documentTypes,
  proposals,
  error,
  canApprove,
  pending,
  actionError,
  onApprove,
  onReject,
}: {
  document: DocumentDetail;
  documentTypes: readonly DocumentType[];
  proposals: DocumentMetadataProposalListItem[];
  error?: string;
  canApprove: boolean;
  pending: boolean;
  actionError?: string;
  onApprove: (proposalId: string) => void;
  onReject: (proposalId: string) => void;
}) =>
  proposals.length === 0 && !error ? null : (
    <Paper component="section" variant="outlined" sx={{ mt: 3, p: 3 }}>
      <Typography variant="h2" component="h2">
        Proponowane zmiany
      </Typography>
      {error ? (
        <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>
      ) : (
        <List disablePadding sx={{ mt: 1 }}>
          {proposals.map((proposal) => (
            <ListItem key={proposal.id} disableGutters divider sx={{ alignItems: 'flex-start', py: 2 }}>
              <Stack sx={{ width: '100%', gap: 1.25 }}>
                <Typography variant="body2" color="text.secondary">
                  {proposal.creator.name}
                </Typography>
                {proposalDiff(document, proposal, documentTypes).map((entry) => (
                  <Stack key={entry.label} direction={{ xs: 'column', sm: 'row' }} sx={{ gap: 0.5 }}>
                    <Typography variant="subtitle2" sx={{ minWidth: '8.5rem' }}>
                      {entry.label}
                    </Typography>
                    <Typography variant="body2">
                      {entry.current} → {entry.proposed}
                    </Typography>
                  </Stack>
                ))}
                {canApprove ? (
                  <Stack direction="row" sx={{ gap: 1 }}>
                    <Button
                      size="small"
                      variant="contained"
                      disabled={pending}
                      onClick={() => onApprove(proposal.id)}
                    >
                      Zatwierdź
                    </Button>
                    <Button
                      size="small"
                      color="error"
                      disabled={pending}
                      onClick={() => onReject(proposal.id)}
                    >
                      Odrzuć
                    </Button>
                  </Stack>
                ) : null}
              </Stack>
            </ListItem>
          ))}
        </List>
      )}
      {actionError ? <Alert severity="error" sx={{ mt: 2 }}>{actionError}</Alert> : null}
    </Paper>
  );
