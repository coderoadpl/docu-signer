import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Autocomplete,
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
  suggestDocumentDate,
  type DocumentFormValues,
} from './documents.logic.js';

export const DocumentFormDialog = ({
  open,
  title,
  submitLabel,
  initialValues,
  personOptions = [],
  tagOptions = [],
  pending,
  error,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  submitLabel: string;
  initialValues?: DocumentFormValues;
  personOptions?: string[];
  tagOptions?: string[];
  pending: boolean;
  error?: string | undefined;
  onClose: () => void;
  onSubmit: (values: DocumentFormValues) => void;
}) => {
  const [values, setValues] = useState<DocumentFormValues>(
    initialValues ?? emptyDocumentForm(),
  );
  const [tagInput, setTagInput] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{
    title?: string;
    documentDate?: string;
    periodEnd?: string;
  }>({});
  const titleInput = useRef<HTMLInputElement>(null);
  const dateInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setValues(initialValues ?? emptyDocumentForm());
      setTagInput('');
      setFieldErrors({});
    }
  }, [initialValues, open]);

  const field = (name: Exclude<keyof DocumentFormValues, 'tags'>, value: string) => {
    setValues((current) =>
      name === 'periodStart' || name === 'periodEnd'
        ? suggestDocumentDate(current, name, value)
        : { ...current, [name]: value },
    );
    if (name === 'title' || name === 'documentDate' || name === 'periodEnd') {
      setFieldErrors((current) => ({ ...current, [name]: undefined }));
    }
  };
  const tagValues = (tags: string[]) =>
    Array.from(new Set(tags.map((tag) => tag.trim()).filter(Boolean)));
  const updateTags = (tags: string[]) =>
    setValues((current) => ({ ...current, tags: tagValues(tags) }));
  const updateTagInput = (input: string) => {
    const parts = input.split(',');
    if (parts.length === 1) {
      setTagInput(input);
      return;
    }
    updateTags([...values.tags, ...parts.slice(0, -1)]);
    setTagInput(parts.at(-1) ?? '');
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const errors = {
      ...(values.title.trim() ? {} : { title: 'Tytuł jest wymagany' }),
      ...(values.documentDate
        ? {}
        : { documentDate: 'Data podpisania jest wymagana' }),
      ...(values.periodStart && values.periodEnd && values.periodStart > values.periodEnd
        ? { periodEnd: 'Data końcowa nie może być wcześniejsza niż początkowa' }
        : {}),
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
    if (errors.periodEnd) return;
    onSubmit({ ...values, tags: tagValues([...values.tags, tagInput]) });
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
            label="Data podpisania"
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
          <Accordion variant="outlined" disableGutters>
            <AccordionSummary>Okres</AccordionSummary>
            <AccordionDetails>
              <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ gap: 2 }}>
                <TextField
                  label="Od"
                  type="date"
                  value={values.periodStart}
                  onChange={(event) => field('periodStart', event.target.value)}
                  slotProps={{ inputLabel: { shrink: true } }}
                  sx={{ flex: 1 }}
                />
                <TextField
                  label="Do"
                  type="date"
                  value={values.periodEnd}
                  onChange={(event) => field('periodEnd', event.target.value)}
                  error={Boolean(fieldErrors.periodEnd)}
                  helperText={fieldErrors.periodEnd}
                  slotProps={{ inputLabel: { shrink: true } }}
                  sx={{ flex: 1 }}
                />
              </Stack>
            </AccordionDetails>
          </Accordion>
          <Autocomplete
            freeSolo
            options={personOptions}
            value={values.person}
            onChange={(_event, value) => field('person', value ?? '')}
            onInputChange={(_event, value) => field('person', value)}
            renderInput={(params) => <TextField {...params} label="Osoba" />}
          />
          <Autocomplete
            multiple
            freeSolo
            options={tagOptions}
            value={values.tags}
            inputValue={tagInput}
            onChange={(_event, value) => {
              updateTags(value);
              setTagInput('');
            }}
            onInputChange={(_event, value) => updateTagInput(value)}
            renderInput={(params) => <TextField {...params} label="Tagi" />}
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
