import * as React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/utils";

/** Function component so the fallback can use useTranslation — the boundary below it can't. */
function ErrorFallback({ error, onReset }: { error: unknown; onReset: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="grid h-dvh place-items-center bg-background px-6">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <h1 className="text-lg font-semibold tracking-tight text-foreground">
          {t("errorBoundary.title")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("errorBoundary.description")}</p>
        <pre className="w-full overflow-x-auto rounded-lg bg-surface-2 px-3 py-2 text-left font-mono text-xs text-muted-foreground">
          {errorMessage(error)}
        </pre>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onReset}>
            {t("errorBoundary.tryAgain")}
          </Button>
          <Button onClick={() => window.location.reload()}>{t("errorBoundary.reload")}</Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Catches render-time throws anywhere below it so one broken component can't
 * white-screen the whole app. Class component because React still has no hook
 * equivalent for getDerivedStateFromError/componentDidCatch.
 */
interface ErrorBoundaryState {
  // Tracked separately from `error`: a component throwing a falsy value would
  // otherwise look identical to "nothing has gone wrong", and the boundary
  // would re-render the children that just threw, forever.
  hasError: boolean;
  error: unknown;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: unknown, errorInfo: React.ErrorInfo) {
    // Client-side only — this is the browser, the server's pino logger doesn't reach here.
    console.error(error, errorInfo.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <ErrorFallback
          error={this.state.error}
          onReset={() => this.setState({ hasError: false, error: null })}
        />
      );
    }
    return this.props.children;
  }
}
