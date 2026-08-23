import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { ProviderSettingsSnapshot } from '../../../shared/contracts/providers'
import {
  AboutDiagnosticsSettings,
  GeneralSettings,
  KeyboardShortcutsSettings,
  keyboardShortcuts,
  settingsSections
} from './settings-command'

const secureSnapshot = {
  credentialBackend: {
    platform: 'darwin',
    backend: 'keychain',
    encryptionAvailable: true,
    securePersistence: true,
    persistenceAllowed: true,
    warning: null
  }
} as ProviderSettingsSnapshot

describe('SettingsCommand', () => {
  it('keeps every settings destination in one ordered peer list', () => {
    expect(settingsSections.map(({ id, label }) => [id, label])).toEqual([
      ['general', 'General'],
      ['agent', 'Agent API'],
      ['skills', 'Writing Skills'],
      ['embedding', 'Embedding API'],
      ['rerank', 'Reranking API'],
      ['mineru', 'MinerU API'],
      ['image', 'Image API'],
      ['publication', 'Publication'],
      ['shortcuts', 'Keyboard Shortcuts'],
      ['about', 'About & Diagnostics']
    ])
  })

  it('organizes General into the three authorized continuous sections', () => {
    const html = renderToStaticMarkup(
      <GeneralSettings
        theme='system'
        accent='neutral'
        approvalMode='manual'
        citationDisplayMode='full'
        closeAction={<button type='button'>Close</button>}
        onTheme={vi.fn()}
        onAccent={vi.fn()}
        onApprovalMode={vi.fn()}
        onCitationDisplayMode={vi.fn()}
      />
    )

    const appearanceIndex = html.indexOf('Appearance')
    const writingIndex = html.indexOf('Writing')
    const agentDefaultsIndex = html.indexOf('Agent defaults')
    expect(appearanceIndex).toBeGreaterThan(-1)
    expect(writingIndex).toBeGreaterThan(appearanceIndex)
    expect(agentDefaultsIndex).toBeGreaterThan(writingIndex)
    expect(html).toContain('Theme mode')
    expect(html).toContain('UI accent')
    expect(html).toContain('Citation display')
    expect(html).toContain('Default approval')
    expect(html).not.toContain('Credential security')
    expect(html).not.toContain('Diagnostics')
  })

  it('renders the fixed shortcut guide from the shared display list', () => {
    const html = renderToStaticMarkup(
      <KeyboardShortcutsSettings closeAction={<button type='button'>Close</button>} />
    )

    expect(keyboardShortcuts).toHaveLength(10)
    for (const shortcut of keyboardShortcuts) {
      expect(html).toContain(shortcut.action)
      expect(html).toContain(shortcut.shortcut)
      expect(html).toContain(shortcut.context)
    }
    expect(html).toContain('Shortcuts are fixed and cannot be customized.')
  })

  it('renders app information, secure credential status, and diagnostic actions', () => {
    const html = renderToStaticMarkup(
      <AboutDiagnosticsSettings
        appInfo={{ name: 'WriteLLM', version: '1.2.3' }}
        snapshot={secureSnapshot}
        closeAction={<button type='button'>Close</button>}
        onOpenLogs={vi.fn()}
        onExportDiagnostics={vi.fn()}
      />
    )

    expect(html).toContain('WriteLLM')
    expect(html).toContain('Version 1.2.3')
    expect(html).toContain('Credential security')
    expect(html).toContain('Secure · keychain')
    expect(html).toContain('Open logs')
    expect(html).toContain('Export diagnostics')
    expect(html).not.toContain('Secure credential storage unavailable')
  })

  it('surfaces the existing warning for a non-secure credential backend', () => {
    const warning = 'Secure storage is unavailable on this system.'
    const html = renderToStaticMarkup(
      <AboutDiagnosticsSettings
        appInfo={{ name: 'WriteLLM', version: '1.2.3' }}
        snapshot={{
          ...secureSnapshot,
          credentialBackend: {
            ...secureSnapshot.credentialBackend,
            backend: 'memory',
            securePersistence: false,
            persistenceAllowed: false,
            warning
          }
        }}
        closeAction={<button type='button'>Close</button>}
        onOpenLogs={vi.fn()}
        onExportDiagnostics={vi.fn()}
      />
    )

    expect(html).toContain('Not secure · memory')
    expect(html).toContain('Secure credential storage unavailable')
    expect(html).toContain(warning)
  })
})
