import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
    children: ReactNode;
    fallback?: ReactNode;
    onError?: (error: Error, errorInfo: ErrorInfo) => void;
    onReset?: () => void;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

/**
 * React Error Boundary to catch render crashes in the canvas editor.
 * Shows a friendly recovery UI instead of a blank white screen.
 */
export class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
        console.error('ErrorBoundary caught:', error, errorInfo);
        this.props.onError?.(error, errorInfo);
    }

    handleReset = () => {
        this.setState({ hasError: false, error: null });
        this.props.onReset?.();
    };

    render() {
        if (this.state.hasError) {
            if (this.props.fallback) {
                return this.props.fallback;
            }

            return (
                <div className="h-full flex flex-col items-center justify-center gap-4 p-8 text-center bg-background">
                    <div className="text-4xl">⚠️</div>
                    <h2 className="text-xl font-semibold">Something went wrong</h2>
                    <p className="text-sm text-muted-foreground max-w-md">
                        The editor encountered an error. This can happen with very large files.
                        Try going back to the dashboard and reopening or using a smaller file.
                    </p>
                    <p className="text-xs text-destructive/70 font-mono max-w-md truncate">
                        {this.state.error?.message}
                    </p>
                    <div className="flex gap-3 mt-2">
                        <button
                            onClick={this.handleReset}
                            className="px-4 py-2 text-sm rounded-md border border-border bg-secondary hover:bg-secondary/80 transition-colors"
                        >
                            Try Again
                        </button>
                        <button
                            onClick={() => {
                                this.handleReset();
                                // Navigate back to dashboard by clearing all state
                                window.location.reload();
                            }}
                            className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                        >
                            Back to Dashboard
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
