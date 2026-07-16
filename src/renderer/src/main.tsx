import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'

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
      <App />
    </QueryClientProvider>
  </StrictMode>
)
