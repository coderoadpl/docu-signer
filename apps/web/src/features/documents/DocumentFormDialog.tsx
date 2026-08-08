import { useEffect, useState, type FormEvent } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
} from '@mui/material';

import { documentTypeSchema } from '#core/domain/index.js';

import {
  DOCUMENT_TYPE_LABELS,
  emptyDocumentForm,
  type DocumentFormValues,
} from './documents.logic.js';

export const DocumentFormDialog = ({
  open,
  title,
  submitLabel,
  initialValues,
  pending,
  error,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  submitLabel: string;
  initialValues?: DocumentFormValues;
  pending: boolean;
  error?: string | undefined;
  onClose: () => void;
  onSubmit: (values: DocumentFormValues) => void;
}) => {
  const [values, setValues] = useState<DocumentFormValues>(
    initialValues ?? emptyDocumentForm(),
  );

  useEffect(() => {
    if (open) setValues(initialValues ?? emptyDocumentForm());
  }, [initialValues, open]);

  const field = (name: keyof DocumentFormValues, value: string) =>
    setValues((current) => ({ ...current, [name]: value }));

  return (
    <Dialog open={open} onClose={pending ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Stack
          component="form"
          id="document-form"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            onSubmit(values);
          }}
          sx={{ gap: 2, pt: 1 }}
        >
          <TextField
            required
            label="Tytuł"
            value={values.title}
            onChange={(event) => field('title', event.target.value)}
          />
          <FormControl required>
            <InputLabel id="document-type-label">Typ</InputLabel>
            <Select
              labelId="document-type-label"
              label="Typ"
              value={values.docType}
              onChange={(event) =>
                field('docType', documentTypeSchema.parse(event.target.value))
              }
            >
              {Object.entries(DOCUMENT_TYPE_LABELS).map(([value, label]) => (
                <MenuItem key={value} value={value}>
                  {label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField
            required
            label="Data dokumentu"
            type="date"
            value={values.documentDate}
            onChange={(event) => field('documentDate', event.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <TextField
            label="Osoba"
            value={values.person}
            onChange={(event) => field('person', event.target.value)}
          />
          <TextField
            label="Tagi"
            helperText="Oddziel tagi przecinkami"
            value={values.tags}
            onChange={(event) => field('tags', event.target.value)}
          />
          {error ? <Alert>{error}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={pending}>
          Anuluj
        </Button>
        <Button
          type="submit"
          form="document-form"
          variant="contained"
          disabled={pending}
        >
          {pending ? 'Zapisywanie…' : submitLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
