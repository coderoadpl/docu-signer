import { useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  FormLabel,
  Radio,
  RadioGroup,
  Stack,
  Typography,
} from '@mui/material';

import {
  sourceUpdateModeSchema,
  type SourceUpdateMode,
} from '#core/domain/index.js';

import { sourceUpdateCanSubmit } from './source-update.logic.js';

export const SourceUpdateDialog = ({
  open,
  pending,
  error,
  onClose,
  onSubmit,
}: {
  open: boolean;
  pending: boolean;
  error?: string | undefined;
  onClose: () => void;
  onSubmit: (file: File, mode: SourceUpdateMode) => void;
}) => {
  const [file, setFile] = useState<File>();
  const [mode, setMode] = useState<SourceUpdateMode>();
  const close = () => {
    setFile(undefined);
    setMode(undefined);
    onClose();
  };
  return (
    <Dialog open={open} onClose={pending ? undefined : close} fullWidth maxWidth="sm">
      <DialogTitle>Uaktualnij źródło</DialogTitle>
      <DialogContent>
        <Stack sx={{ gap: 3, pt: 1 }}>
          <Button component="label" variant="outlined" disabled={pending}>
            {file ? file.name : 'Wybierz nowe źródło'}
            <input
              hidden
              type="file"
              accept="application/pdf,image/*"
              onChange={(event) => setFile(event.target.files?.[0])}
            />
          </Button>
          <FormControl required>
            <FormLabel>Sposób obsługi podpisów</FormLabel>
            <RadioGroup
              value={mode ?? ''}
              onChange={(event) => setMode(sourceUpdateModeSchema.parse(event.target.value))}
            >
              <FormControlLabel
                value="delete-signed"
                control={<Radio />}
                label={
                  <Stack>
                    <Typography>Usuń podpisany</Typography>
                    <Typography variant="body2" color="text.secondary">
                      Podpisane cyfrowo pliki zostaną usunięte.
                    </Typography>
                  </Stack>
                }
              />
              <FormControlLabel
                value="transfer"
                control={<Radio />}
                label={
                  <Stack>
                    <Typography>Przenieś podpisy</Typography>
                    <Typography variant="body2" color="text.secondary">
                      Zapisane podpisy zostaną naniesione na nowe źródło.
                    </Typography>
                  </Stack>
                }
              />
            </RadioGroup>
          </FormControl>
          {mode === 'transfer' && file && file.type !== 'application/pdf' ? (
            <Alert severity="warning">Przeniesienie podpisów wymaga pliku PDF.</Alert>
          ) : null}
          {error ? <Alert severity="error">{error}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={close} disabled={pending}>Anuluj</Button>
        <Button
          variant="contained"
          disabled={!sourceUpdateCanSubmit(file, mode) || pending}
          onClick={() => {
            if (file && mode) onSubmit(file, mode);
          }}
        >
          {pending ? 'Aktualizowanie…' : 'Uaktualnij'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
