import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import { AppearanceProvider } from './appearance/AppearanceProvider';

const root = document.getElementById('root');
if (!root) {
  throw new Error('Missing root element.');
}

const requiredBridges = [
  'writellm',
  'writellmAppearance',
  'writellmWritingOrientation',
  'writellmChapters',
  'writellmProviderSettings',
] as const;
const missingBridges = requiredBridges.filter((name) => !(name in window));
const application = missingBridges.length ? (
  <main className="launch-shell">
    <section className="ui-card launch-card" role="alert" aria-labelledby="runtime-error-title">
      <p className="eyebrow">WriteLLM v2</p>
      <h1 id="runtime-error-title">Application update incomplete</h1>
      <p className="summary">
        The desktop bridge did not load. Quit and restart WriteLLM to finish applying the update.
      </p>
    </section>
  </main>
) : (
  <AppearanceProvider>
    <App />
  </AppearanceProvider>
);

createRoot(root).render(<StrictMode>{application}</StrictMode>);
