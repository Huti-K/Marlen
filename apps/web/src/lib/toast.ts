export interface ToastItem {
  id: string;
  variant: "error" | "success";
  message: string;
}

const AUTO_DISMISS_MS = 6000;

let toasts: ToastItem[] = [];
const listeners = new Set<(toasts: ToastItem[]) => void>();

function emit() {
  for (const listener of listeners) listener(toasts);
}

function push(variant: ToastItem["variant"], message: string) {
  const id = crypto.randomUUID();
  toasts = [...toasts, { id, variant, message }];
  emit();
  setTimeout(() => dismissToast(id), AUTO_DISMISS_MS);
}

export function dismissToast(id: string) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function subscribeToasts(listener: (toasts: ToastItem[]) => void): () => void {
  listeners.add(listener);
  listener(toasts);
  return () => listeners.delete(listener);
}

export const toast = {
  error: (message: string) => push("error", message),
  success: (message: string) => push("success", message),
};
