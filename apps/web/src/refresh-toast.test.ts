import { afterEach, describe, expect, it, vi } from 'vitest';

import { refreshToastStore } from './refresh-toast.js';

afterEach(() => refreshToastStore.dismiss());

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
