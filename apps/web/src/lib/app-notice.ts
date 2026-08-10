export interface AppNotice {
  message: string;
}

let current: AppNotice | null = null;
const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) listener();
};

export const appNoticeStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  snapshot(): AppNotice | null {
    return current;
  },
  show(message: string): void {
    current = { message };
    emit();
  },
  dismiss(): void {
    if (current === null) return;
    current = null;
    emit();
  },
};
