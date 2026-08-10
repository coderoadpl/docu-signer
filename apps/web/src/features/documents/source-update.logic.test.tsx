import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { SourceUpdateRequest } from '#core/domain/index.js';

import { renderWithProviders } from '../../test/render.js';
import { SourceUpdateDialog } from './SourceUpdateDialog.js';
import {
  sourceUpdateCanSubmit,
  sourceUpdateNeedsReplay,
  sourceUpdateReadyToComplete,
} from './source-update.logic.js';

const request = (decision: 'pending' | 'accepted' | 'rejected'): SourceUpdateRequest => ({
  id: '11111111-1111-4111-8111-111111111111',
  tenantId: 'tenant-default',
  documentId: '22222222-2222-4222-8222-222222222222',
  requestedBy: 'user-owner',
  newSourceFileId: '33333333-3333-4333-8333-333333333333',
  mode: 'transfer',
  status: 'pending',
  approvals: [
    {
      id: '44444444-4444-4444-8444-444444444444',
      approverId: 'user-signer',
      decision,
    },
  ],
});

describe('source update dialog choice logic', () => {
  it('requires a file and mode and permits transfer only for PDF files', () => {
    const pdf = new File([new Uint8Array([1])], 'nowe.pdf', {
      type: 'application/pdf',
    });
    const image = new File([new Uint8Array([1])], 'nowe.png', {
      type: 'image/png',
    });
    expect(sourceUpdateCanSubmit(undefined, undefined)).toBe(false);
    expect(sourceUpdateCanSubmit(pdf, undefined)).toBe(false);
    expect(sourceUpdateCanSubmit(image, 'transfer')).toBe(false);
    expect(sourceUpdateCanSubmit(image, 'delete-signed')).toBe(true);
    expect(sourceUpdateCanSubmit(pdf, 'transfer')).toBe(true);
  });

  it('submits the selected file and required radio choice', async () => {
    const submit = vi.fn();
    renderWithProviders(
      <SourceUpdateDialog
        open
        pending={false}
        onClose={vi.fn()}
        onSubmit={submit}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Uaktualnij źródło' });
    expect(within(dialog).getByRole('button', { name: 'Uaktualnij' })).toBeDisabled();
    const picker = within(dialog)
      .getByRole('button', { name: 'Wybierz nowe źródło' })
      .querySelector('input');
    if (!(picker instanceof HTMLInputElement)) throw new Error('Missing source picker');
    const pdf = new File([new Uint8Array([1])], 'nowe.pdf', {
      type: 'application/pdf',
    });
    await userEvent.upload(picker, pdf);
    await userEvent.click(within(dialog).getByRole('radio', { name: /Przenieś podpisy/u }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Uaktualnij' }));
    expect(submit).toHaveBeenCalledWith(pdf, 'transfer');
  });
});

describe('source update replay trigger', () => {
  it('triggers replay only for an accepted transfer with stored records', () => {
    expect(sourceUpdateReadyToComplete(request('pending'))).toBe(false);
    expect(sourceUpdateNeedsReplay(request('pending'), 1)).toBe(false);
    expect(sourceUpdateReadyToComplete(request('accepted'))).toBe(true);
    expect(sourceUpdateNeedsReplay(request('accepted'), 0)).toBe(false);
    expect(sourceUpdateNeedsReplay(request('accepted'), 2)).toBe(true);
    expect(
      sourceUpdateNeedsReplay(
        { ...request('accepted'), mode: 'delete-signed' },
        2,
      ),
    ).toBe(false);
    expect(
      sourceUpdateReadyToComplete({ ...request('accepted'), status: 'rejected' }),
    ).toBe(false);
  });
});
