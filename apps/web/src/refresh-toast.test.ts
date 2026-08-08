import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '#core/client/index.js';

import { refreshToastStore } from './refresh-toast.js';

const { queryClient } = await import('./query-client.js');

const failingQuery = async (error: Error): Promise<never> => {
  throw error;
};

afterEach(() => {
  queryClient.clear();
  refreshToastStore.dismiss();
});

describe('refreshToastStore', () => {
  it('starts with no toast', () => {
    expect(refreshToastStore.snapshot()).toBeNull();
  });

  it('notifies subscribers on show and dismiss, and stops after unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = refreshToastStore.subscribe(listener);

    refreshToastStore.show('stale');
    expect(refreshToastStore.snapshot()).toEqual({ message: 'stale' });
    expect(listener).toHaveBeenCalledTimes(1);

    refreshToastStore.dismiss();
    expect(refreshToastStore.snapshot()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    refreshToastStore.show('again');
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('treats dismiss as a no-op when already empty', () => {
    const listener = vi.fn();
    const unsubscribe = refreshToastStore.subscribe(listener);

    refreshToastStore.dismiss();

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });
});

describe('queryClient retry policy behavior', () => {
  it.each(['validation', 'unauthorized'] as const)('does not retry %s failures', async (code) => {
    const queryFn = vi.fn(() =>
      failingQuery(new ApiError({ code, message: `${code} failure` })),
    );

    await expect(
      queryClient.fetchQuery({ queryKey: ['no-retry', code], queryFn, retryDelay: 0 }),
    ).rejects.toThrow(`${code} failure`);
    expect(queryFn).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['internal', new ApiError({ code: 'internal', message: 'Internal failure' })],
    ['network', new Error('Network failure')],
  ])('stops retrying %s failures after three retries', async (label, error) => {
    const queryFn = vi.fn(() => failingQuery(error));

    await expect(
      queryClient.fetchQuery({ queryKey: ['retry', label], queryFn, retryDelay: 0 }),
    ).rejects.toThrow(error.message);
    expect(queryFn).toHaveBeenCalledTimes(4);
  });
});

describe('queryClient error policy', () => {
  it('shows one API message when a stale-data refresh fails', async () => {
    const listener = vi.fn();
    const unsubscribe = refreshToastStore.subscribe(listener);
    queryClient.setQueryData(['stale'], { value: 'kept' });

    await expect(
      queryClient.fetchQuery({
        queryKey: ['stale'],
        queryFn: () =>
          failingQuery(new ApiError({ code: 'validation', message: 'Refresh rejected' })),
        retryDelay: 0,
        staleTime: 0,
      }),
    ).rejects.toThrow('Refresh rejected');

    expect(refreshToastStore.snapshot()).toEqual({ message: 'Refresh rejected' });
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('does not toast an initial-load failure', async () => {
    await expect(
      queryClient.fetchQuery({
        queryKey: ['initial'],
        queryFn: () => failingQuery(new Error('Offline')),
        retry: false,
      }),
    ).rejects.toThrow('Offline');

    expect(refreshToastStore.snapshot()).toBeNull();
  });
});
