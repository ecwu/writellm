import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import { AppearanceProvider } from './appearance/AppearanceProvider';
import { Card, CardContent, CardHeader } from './components/ui/card';

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
  <main className="grid min-h-svh place-items-center p-8">
    <Card className="w-full max-w-3xl" role="alert" aria-labelledby="runtime-error-title">
      <CardHeader>
        <p className="text-xs font-medium text-muted-foreground">WriteLLM v2</p>
        <h1 id="runtime-error-title" className="text-xl font-medium">
          Application update incomplete
        </h1>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        The desktop bridge did not load. Quit and restart WriteLLM to finish applying the update.
      </CardContent>
    </Card>
  </main>
) : (
  <AppearanceProvider>
    <App />
  </AppearanceProvider>
);

createRoot(root).render(<StrictMode>{application}</StrictMode>);
