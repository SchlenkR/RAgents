import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "./ui";

interface RenderBoundaryProps {
  children: ReactNode;
  title: string;
  resetKeys: readonly unknown[];
}

interface RenderBoundaryState {
  error: Error | undefined;
  resetKeys: readonly unknown[];
}

export class RenderBoundary extends Component<RenderBoundaryProps, RenderBoundaryState> {
  state: RenderBoundaryState = { error: undefined, resetKeys: this.props.resetKeys };

  static getDerivedStateFromProps(props: RenderBoundaryProps, state: RenderBoundaryState): Partial<RenderBoundaryState> | null {
    return props.resetKeys.length !== state.resetKeys.length || props.resetKeys.some((key, index) => !Object.is(key, state.resetKeys[index]))
      ? { error: undefined, resetKeys: props.resetKeys }
      : null;
  }

  static getDerivedStateFromError(cause: unknown): Partial<RenderBoundaryState> {
    return { error: cause instanceof Error ? cause : new Error(String(cause)) };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(this.props.title, error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <div className="flex min-h-0 flex-1 flex-col items-start gap-3 overflow-auto p-workspace-inset">
      <h2 className="text-sm font-medium">{this.props.title}</h2>
      <p className="text-sm text-destructive" role="alert">{this.state.error.message}</p>
      <Button onClick={() => this.setState({ error: undefined })} size="sm" variant="outline">Retry</Button>
      <Button onClick={() => window.location.reload()} size="sm" variant="outline">Reload</Button>
    </div>;
  }
}
