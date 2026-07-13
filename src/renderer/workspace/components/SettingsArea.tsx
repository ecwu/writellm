import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ProviderSettingsPanel } from '../../features/provider-settings/ProviderSettingsPanel';
import { SourceServiceSettingsPanel } from '../../features/sources/SourceServiceSettingsPanel';

export function SettingsArea({ onClose }: { onClose(): void }) {
  return (
    <main
      className="workspace-settings-area absolute inset-0 z-20 grid min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-background"
      aria-labelledby="workspace-settings-title"
    >
      <header className="workspace-settings-header flex min-h-16 items-center gap-4 border-b px-4">
        <Button type="button" variant="ghost" onClick={onClose}>
          <ArrowLeft aria-hidden="true" focusable="false" />
          Back to workspace
        </Button>
        <div>
          <h1 id="workspace-settings-title" data-settings-heading tabIndex={-1}>
            Settings
          </h1>
          <p>Application-level configuration. These settings are shared across projects.</p>
        </div>
      </header>
      <ScrollArea
        className="workspace-settings-scroll min-h-0"
        aria-label="Application settings content"
      >
        <div className="workspace-settings-content mx-auto grid w-full max-w-5xl gap-6 p-6">
          <ProviderSettingsPanel />
          <SourceServiceSettingsPanel />
        </div>
      </ScrollArea>
    </main>
  );
}
