import type { ErrorInfo, ReactNode } from "react";
import { Component } from "react";

import { Button } from "@chief/ui/components/button";

export class ConversationErrorBoundary extends Component<
  { children: ReactNode; resetKey: string },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[Chief] Conversation render failed", error, info);
  }

  componentDidUpdate(previousProps: Readonly<{ resetKey: string }>) {
    if (this.state.error && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-6">
        <div className="bg-muted/40 w-full max-w-md rounded-xl px-6 py-7 text-center shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_7%,transparent)]">
          <h2 className="text-base font-medium">Conversation paused</h2>
          <p className="text-muted-foreground mx-auto mt-2 max-w-sm text-sm leading-6">
            This conversation could not be displayed. The rest of your workspace
            is still available, and no work was lost.
          </p>
          <Button
            className="mt-5"
            variant="outline"
            onClick={() => this.setState({ error: null })}
          >
            Try conversation again
          </Button>
        </div>
      </div>
    );
  }
}
