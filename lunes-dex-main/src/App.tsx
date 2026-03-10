import Header from 'pages/header'
import React from 'react'
import { BrowserRouter, useLocation } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import { SpotProvider } from 'context/SpotContext'
import AppRoutes from 'routers'
import ErrorBoundary from 'components/ErrorBoundary'

// Header wrapper to conditionally show header
const HeaderWrapper: React.FC = () => {
  const location = useLocation()
  // Hide header on landing page
  if (location.pathname === '/') {
    return null
  }
  return <Header />
}

const App = () => {
  return (
    <HelmetProvider>
      <BrowserRouter>
        <SpotProvider>
          <ErrorBoundary>
            <HeaderWrapper />
            <AppRoutes />
          </ErrorBoundary>
        </SpotProvider>
      </BrowserRouter>
    </HelmetProvider>
  )
}

export default App
