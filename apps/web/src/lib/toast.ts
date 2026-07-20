import type { ApiErrorCode } from "@marlen/shared";
import { toast as sonnerToast } from "sonner";
import { ApiError } from "@/lib/api";
import i18n from "@/lib/i18n";
import { appNavigate } from "@/lib/nav";
import { errorMessage } from "@/lib/utils";

/**
 * Where each user-fixable ApiErrorCode is resolved in the app. An error toast
 * whose cause carries one of these codes gets a click-through action that
 * navigates there (via the navigate handle App registers, lib/nav.ts).
 */
const ERROR_CODE_ACTIONS: Record<ApiErrorCode, { path: string; label: () => string }> = {
  pipedream_not_configured: { path: "/settings", label: () => i18n.t("errors.openSettings") },
};

function actionFor(error: unknown): { label: string; onClick: () => void } | undefined {
  if (!(error instanceof ApiError) || !error.code) return undefined;
  const target = ERROR_CODE_ACTIONS[error.code];
  return {
    label: target.label(),
    onClick: () => appNavigate(target.path),
  };
}

export const toast = {
  /** Pass the thrown value itself (not errorMessage(err)) so fixable errors keep their action. */
  error: (error: unknown) => {
    const message = typeof error === "string" ? error : errorMessage(error);
    sonnerToast.error(message, { action: actionFor(error) });
  },
  success: (message: string) => sonnerToast.success(message),
  info: (message: string) => sonnerToast.info(message),
};
