import React, { Component, ErrorInfo, ReactNode } from 'react'
import styled from 'styled-components'

interface Props {
    children: ReactNode
    fallback?: ReactNode
}

interface State {
    hasError: boolean
    error?: Error
}

const ErrorContainer = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 400px;
  padding: 48px;
  text-align: center;
`

const ErrorIcon = styled.div`
  font-size: 48px;
  margin-bottom: 16px;
`

const ErrorTitle = styled.h2`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 20px;
  font-weight: 700;
  color: #FFFFFF;
  margin: 0 0 8px;
`

const ErrorMessage = styled.p`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 14px;
  color: #8A8A8E;
  margin: 0 0 24px;
  max-width: 400px;
`

const RetryButton = styled.button`
  background: #6C38FF;
  color: #FFFFFF;
  border: none;
  padding: 12px 32px;
  border-radius: 8px;
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 700;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);

  &:hover {
    background: #5228DB;
    transform: translateY(-1px);
  }
`

class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props)
        this.state = { hasError: false }
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error }
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('[ErrorBoundary]', error, errorInfo)
    }

    handleRetry = () => {
        this.setState({ hasError: false, error: undefined })
    }

    render() {
        if (this.state.hasError) {
            if (this.props.fallback) {
                return this.props.fallback
            }

            return (
                <ErrorContainer>
                    <ErrorIcon>⚠️</ErrorIcon>
                    <ErrorTitle>Something went wrong</ErrorTitle>
                    <ErrorMessage>
                        An unexpected error occurred. Please try again or refresh the page.
                    </ErrorMessage>
                    <RetryButton onClick={this.handleRetry}>
                        Try Again
                    </RetryButton>
                </ErrorContainer>
            )
        }

        return this.props.children
    }
}

export default ErrorBoundary
