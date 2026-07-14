import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import i18n from '@/i18n';
import { captureError } from '@/lib/telemetry';

interface Props {
  children: ReactNode;
}

interface State {
  crashed: boolean;
}

/** Catches render-time crashes, reports them, and offers a way out instead of a blank screen.
    Error boundaries have to be class components — there is no hook equivalent. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { crashed: false };

  static getDerivedStateFromError(): State {
    return { crashed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    captureError(error, { source: 'react', component_stack: info.componentStack });
  }

  render(): ReactNode {
    if (!this.state.crashed) return this.props.children;

    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-lg font-medium">{i18n.t('errors.crash.title')}</p>
        <p className="text-muted-foreground text-sm">{i18n.t('errors.crash.description')}</p>
        <Button onClick={() => window.location.reload()}>{i18n.t('errors.crash.reload')}</Button>
      </div>
    );
  }
}
