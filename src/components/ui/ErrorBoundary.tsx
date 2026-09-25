import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(_error: Error, _info: ErrorInfo) {
    /* Do not send health data to browser logs. */
  }
  render() {
    return this.state.failed ? (
      <main className="standalone">
        <h1>Nešto je pošlo po zlu.</h1>
        <p>Osvježite stranicu kako biste ponovno otvorili aplikaciju.</p>
        <button className="primary" onClick={() => window.location.reload()}>
          Pokušaj ponovno
        </button>
      </main>
    ) : (
      this.props.children
    );
  }
}
