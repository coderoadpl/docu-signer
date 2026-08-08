import { useEffect, useRef, useState, type FormEvent } from 'react';
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
  const [fieldErrors, setFieldErrors] = useState<{
    title?: string;
    documentDate?: string;
  }>({});
  const titleInput = useRef<HTMLInputElement>(null);
  const dateInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setValues(initialValues ?? emptyDocumentForm());
      setFieldErrors({});
    }
  }, [initialValues, open]);

  const field = (name: keyof DocumentFormValues, value: string) => {
    setValues((current) => ({ ...current, [name]: value }));
    if (name === 'title' || name === 'documentDate') {
      setFieldErrors((current) => ({ ...current, [name]: undefined }));
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const errors = {
      ...(values.title.trim() ? {} : { title: 'Tytuł jest wymagany' }),
      ...(values.documentDate
        ? {}
        : { documentDate: 'Data dokumentu jest wymagana' }),
    };
    setFieldErrors(errors);
    if (errors.title) {
      titleInput.current?.focus();
      return;
    }
    if (errors.documentDate) {
      dateInput.current?.focus();
      return;
    }
    onSubmit(values);
  };

  return (
    <Dialog open={open} onClose={pending ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Stack
          component="form"
          id="document-form"
          noValidate
          onSubmit={submit}
          sx={{ gap: 2, pt: 1 }}
        >
          <TextField
            id="document-title"
            label="Tytuł"
            value={values.title}
            onChange={(event) => field('title', event.target.value)}
            error={Boolean(fieldErrors.title)}
            helperText={fieldErrors.title}
            inputRef={titleInput}
            slotProps={{
              htmlInput: {
                'aria-describedby': fieldErrors.title
                  ? 'document-title-helper-text'
                  : undefined,
              },
              formHelperText: { id: 'document-title-helper-text' },
            }}
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
            id="document-date"
            label="Data dokumentu"
            type="date"
            value={values.documentDate}
            onChange={(event) => field('documentDate', event.target.value)}
            error={Boolean(fieldErrors.documentDate)}
            helperText={fieldErrors.documentDate}
            inputRef={dateInput}
            slotProps={{
              inputLabel: { shrink: true },
              htmlInput: {
                'aria-describedby': fieldErrors.documentDate
                  ? 'document-date-helper-text'
                  : undefined,
              },
              formHelperText: { id: 'document-date-helper-text' },
            }}
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
          {error ? <Alert severity="error">{error}</Alert> : null}
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
