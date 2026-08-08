import { useState, type FormEvent } from 'react';
import { Alert, Box, Button, FormControl, FormLabel, OutlinedInput, Stack, Typography } from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { normalizeSlug } from '#core/domain/index.js';

import { actions } from '../../api.js';

/**
 * Create-tenant form (US-017). The slug preview reuses the SAME `normalizeSlug`
 * value-object the server validates against — no duplicated canonicalization —
 * so what the user sees is what the tenant slug becomes. On success both the
 * `me` and `tenants` caches are invalidated so the switcher and onboarding
 * reflect the new owner row immediately.
 */
export const CreateTenantForm = ({ onCreated }: { onCreated?: (slug: string) => void }) => {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const slug = normalizeSlug(name);

  const create = useMutation({
    ...actions.createTenant,
    onSuccess: async (data) => {
      setName('');
      await queryClient.invalidateQueries(actions.tenantsInvalidates());
      await queryClient.invalidateQueries(actions.meInvalidates());
      onCreated?.(data.tenant.slug);
    },
  });

  return (
    <Box
      component="form"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        if (name.trim()) create.mutate({ name: name.trim(), slug });
      }}
    >
      <Stack useFlexGap spacing="0.75rem">
        <FormControl fullWidth>
          <FormLabel htmlFor="create-tenant-name">tenant name</FormLabel>
          <OutlinedInput
            id="create-tenant-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Acme Sp. z o.o."
            inputProps={{ 'aria-label': 'New tenant name' }}
          />
        </FormControl>
        <Typography variant="caption" data-testid="slug-preview">
          slug: <strong>{slug || '—'}</strong>
        </Typography>
        <Button type="submit" variant="contained" disabled={create.isPending || slug.length === 0}>
          {create.isPending ? 'creating…' : 'create tenant'}
        </Button>
      </Stack>
      {create.isError ? <Alert sx={{ mt: '0.6rem' }}>{create.error.message}</Alert> : null}
    </Box>
  );
};
