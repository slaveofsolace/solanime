import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    if (import.meta.env.DEV) console.error('Page render failed', error, info.componentStack);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <section className="status-panel" role="alert">
        <h1>This page could not be displayed</h1>
        <p>Your saved list has not been erased. Reload the page to try again.</p>
        <div className="button-row">
          <button
            className="button button--primary"
            type="button"
            onClick={() => window.location.reload()}
          >
            Reload page
          </button>
          <Link className="button" to="/">
            Back to home
          </Link>
        </div>
      </section>
    );
  }
}
export default function PageErrorBoundary({ children }: { children: ReactNode }) {
  const location = useLocation();
  return <Boundary key={location.pathname}>{children}</Boundary>;
}
