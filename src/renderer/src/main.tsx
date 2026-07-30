import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import { Toaster } from './components/ui/sonner'
import { ACTION_ERROR_TOAST_DURATION_MS } from './lib/notifications'
import { ThemeProvider } from './theme-provider'

window.addEventListener('error', (event) => {
  window.desktop.diagnostics.reportRendererError({
    event: 'renderer.error',
    message: event.message || 'Unknown renderer error',
    stack: event.error instanceof Error ? event.error.stack : undefined,
    source: event.filename || undefined,
    line: event.lineno,
    column: event.colno
  })
})

window.addEventListener('unhandledrejection', (event) => {
  const error =
    event.reason instanceof Error ? event.reason : new Error('Unhandled renderer rejection')
  window.desktop.diagnostics.reportRendererError({
    event: 'renderer.unhandled_rejection',
    message: error.message,
    stack: error.stack
  })
})

const rootElement = document.getElementById('root')
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
    mutations: { retry: 0 }
  }
})

if (!rootElement) {
  throw new Error('Renderer root element was not found')
}

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <App />
        <Toaster
          position='bottom-right'
          visibleToasts={3}
          closeButton
          richColors
          containerAriaLabel='Notifications'
          toastOptions={{ duration: ACTION_ERROR_TOAST_DURATION_MS }}
        />
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>
)
