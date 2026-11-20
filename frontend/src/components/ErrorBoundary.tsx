import React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Global crash barrier. Without this, an uncaught render error anywhere in
 * the tree (a bad chart config, a null dereference in a panel) unmounts the
 * ENTIRE app — React blanks the page rather than leaving a broken UI on
 * screen. This catches that, logs it, and offers a reload instead of a blank
 * white page.
 *
 * Deliberately a class component: `componentDidCatch` / `getDerivedStateFromError`
 * are still the only way to catch a render-phase error in React 18 — there is
 * no hook equivalent.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary] Unhandled render error:", error, info.componentStack);
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-app-bg text-app-text font-app flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-app-surface border border-app-border rounded-2xl p-6 text-center space-y-4 shadow-xl">
            <div className="w-12 h-12 rounded-full bg-rose-950/50 border border-rose-800 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-6 h-6 text-rose-400" aria-hidden="true" />
            </div>
            <div className="space-y-1.5">
              <h1 className="text-base font-bold text-app-text">Something went wrong</h1>
              <p className="text-xs text-app-muted leading-relaxed">
                The app hit an unexpected error and couldn't continue. Your data on the server is
                unaffected — reloading will bring you back to a working state.
              </p>
            </div>
            {this.state.error.message && (
              <p className="text-[11px] font-mono text-app-muted bg-app-bg/60 border border-app-border rounded-lg px-3 py-2 break-words text-left">
                {this.state.error.message}
              </p>
            )}
            <button
              type="button"
              onClick={this.handleReload}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-app-primary hover:brightness-110 text-white text-xs font-semibold shadow-md transition-all active:scale-[0.98] min-h-[44px]"
            >
              <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Reload</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
