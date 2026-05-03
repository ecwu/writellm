import React from 'react';
import { createRoot } from 'react-dom/client';
import '@xyflow/react/dist/style.css';
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

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
