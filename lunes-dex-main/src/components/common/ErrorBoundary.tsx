import React, { Component, ErrorInfo, ReactNode } from 'react'
import styled from 'styled-components'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

const ErrorContainer = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 50vh;
  padding: 2rem;
  gap: 1rem;
  text-align: center;
`

const ErrorTitle = styled.h2`
  font-size: 1.5rem;
  color: #ef4444;
`

const ErrorMessage = styled.p`
  font-size: 0.875rem;
  color: #9ca3af;
  max-width: 30rem;
`

const RetryButton = styled.button`
  padding: 0.5rem 1.25rem;
  border-radius: 0.5rem;
  background: #8e61ff;
  color: white;
  font-size: 0.875rem;
  cursor: pointer;
  border: none;

  &:hover {
    opacity: 0.85;
  }
`

class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[ErrorBoundary] Caught error:', error, info.componentStack)
    }
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback

      return (
        <ErrorContainer>
          <ErrorTitle>Something went wrong</ErrorTitle>
          <ErrorMessage>
            {this.state.error?.message ??
              'An unexpected error occurred. Please try again.'}
          </ErrorMessage>
          <RetryButton onClick={this.handleRetry}>Try Again</RetryButton>
        </ErrorContainer>
      )
    }

    return this.props.children
  }
}

export default ErrorBoundary
