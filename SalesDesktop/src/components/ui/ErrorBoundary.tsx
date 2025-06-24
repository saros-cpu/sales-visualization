import { Component, ReactNode } from 'react';
import { Result, Button } from 'antd';

interface Props { children: ReactNode; }
interface State { hasError: boolean; }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError) {
      return (
        <Result
          status="error"
          title="页面加载出错"
          extra={<Button type="primary" onClick={() => this.setState({ hasError: false })}>重试</Button>}
        />
      );
    }
    return this.props.children;
  }
}
