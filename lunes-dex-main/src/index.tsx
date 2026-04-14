import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import GlobalStyles from 'styles/globals'
import { ThemeProvider } from 'styled-components'
import theme from 'theme'
import { AppProvider } from './context/useContext'
import { SDKProvider } from './context/SDKContext'
import { ToastProvider } from './components/feedback/ToastProvider'

if (import.meta.env.PROD) {
  const noop = () => undefined
  console.log = noop
  console.info = noop
  console.warn = noop
  console.debug = noop
  console.error = noop
}

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement)
root.render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <SDKProvider>
        <AppProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
          <GlobalStyles />
        </AppProvider>
      </SDKProvider>
    </ThemeProvider>
  </React.StrictMode>
)
