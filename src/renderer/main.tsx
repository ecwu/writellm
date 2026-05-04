import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@xyflow/react/dist/style.css';
import 'katex/dist/katex.min.css';
import './styles.css';
import './styles/workspace.css';
import './styles/canvas.css';
import './styles/outline.css';
import './styles/llm.css';
import './styles/inspector.css';
import './styles/sections.css';
import './styles/writing.css';
import './styles/knowledge.css';
import { App } from './App';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false
    },
    mutations: {
      retry: false
    }
  }
});

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
);
