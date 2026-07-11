import { useEffect, useState } from 'react';
import type { RuntimeInfo } from '../shared/ipc';

type RuntimeState =
  | { status: 'loading' }
  | { status: 'ready'; info: RuntimeInfo }
  | { status: 'error'; message: string };

export function App() {
  const [runtime, setRuntime] = useState<RuntimeState>({ status: 'loading' });

  useEffect(() => {
    void window.writellm.getRuntimeInfo()
      .then((info) => setRuntime({ status: 'ready', info }))
      .catch((error: unknown) => {
        setRuntime({
          status: 'error',
          message: error instanceof Error ? error.message : 'The desktop bridge is unavailable.'
        });
      });
  }, []);

  return (
    <main className="foundation-shell">
      <section aria-labelledby="app-title">
        <p className="eyebrow">Foundation</p>
        <h1 id="app-title">WriteLLM v2</h1>
        <p className="summary">The legacy product has been retired. Product design starts here.</p>
        {runtime.status === 'loading' ? <p>Checking the desktop runtime…</p> : null}
        {runtime.status === 'ready' ? (
          <p className="runtime-status">
            Desktop bridge ready · {runtime.info.platform} · v{runtime.info.appVersion}
          </p>
        ) : null}
        {runtime.status === 'error' ? <p role="alert">Runtime error: {runtime.message}</p> : null}
      </section>
    </main>
  );
}
