import { Component, Fragment, ReactNode } from 'react';
import { Result, Button } from 'antd';

interface Props { children: ReactNode; }
interface State { hasError: boolean; retryKey: number; error?: unknown; }

function isDynamicImportError(error: unknown) {
  const message = String((error as { message?: unknown })?.message || error || '');
  return [
    'Failed to fetch dynamically imported module',
    'Importing a module script failed',
    'error loading dynamically imported module',
    'ERR_NETWORK_CHANGED',
    'ChunkLoadError',
  ].some((item) => message.includes(item));
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, retryKey: 0 };

  static getDerivedStateFromError(error: unknown) {
    return { hasError: true, error };
  }

  private handleRetry = () => {
    if (isDynamicImportError(this.state.error)) {
      window.location.reload();
      return;
    }
    this.setState((state) => ({ hasError: false, retryKey: state.retryKey + 1, error: undefined }));
  };

  render() {
    if (this.state.hasError) {
      return (
        <Result
          status="error"
          title="页面加载出错"
          extra={<Button type="primary" onClick={this.handleRetry}>重试</Button>}
        />
      );
    }
    return <Fragment key={this.state.retryKey}>{this.props.children}</Fragment>;
  }
}
