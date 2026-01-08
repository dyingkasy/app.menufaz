import React from 'react';
import { logClientError } from '../services/logging';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    logClientError({
      message: error.message || 'React render error',
      stack: error.stack,
      context: { componentStack: info.componentStack }
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-white dark:bg-slate-900 text-slate-800 dark:text-white flex items-center justify-center p-6">
          <div className="max-w-md text-center">
            <h1 className="text-2xl font-bold mb-2">Algo deu errado</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Já registramos o erro e estamos trabalhando para resolver.
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
