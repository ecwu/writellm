import { describe, expect, test } from 'bun:test';
import { ipcChannels } from '../../src/shared/ipc.js';
import { validateIpcArguments } from '../../src/main/ipcValidation.js';
import { isTrustedRendererUrl } from '../../src/main/security.js';

describe('trusted Electron renderer policy', () => {
  const config = {
    devServerUrl: 'http://127.0.0.1:5173',
    productionRendererDirectory: '/Applications/WriteLLM/dist'
  };

  test('allows only the configured development origin or packaged renderer directory', () => {
    expect(isTrustedRendererUrl('http://127.0.0.1:5173/', config)).toBeTrue();
    expect(isTrustedRendererUrl('http://127.0.0.1:5173/assets/main.js', config)).toBeTrue();
    expect(isTrustedRendererUrl('http://127.0.0.1:5174/', config)).toBeFalse();
    expect(isTrustedRendererUrl('https://127.0.0.1:5173/', config)).toBeFalse();
    expect(isTrustedRendererUrl('file:///Applications/WriteLLM/dist/index.html', config)).toBeTrue();
    expect(isTrustedRendererUrl('file:///Applications/WriteLLM/dist/assets/main.js', config)).toBeTrue();
    expect(isTrustedRendererUrl('file:///Applications/WriteLLM/other/index.html', config)).toBeFalse();
  });
});

describe('IPC runtime payload validation', () => {
  test('parses valid generation input and rejects unknown or unsafe fields', () => {
    const [payload] = validateIpcArguments(ipcChannels.createGenerationTask, [{
      sectionId: 'section_1',
      mode: 'rewrite_section',
      prompt: 'Strengthen the argument.',
      targetStart: 0,
      targetEnd: 12
    }]);
    expect(payload).toMatchObject({ sectionId: 'section_1', mode: 'rewrite_section' });

    expect(() => validateIpcArguments(ipcChannels.createGenerationTask, [{
      sectionId: 'section_1',
      mode: 'rewrite_section',
      prompt: 'Strengthen the argument.',
      privileged: true
    }])).toThrow();
    expect(() => validateIpcArguments(ipcChannels.getWorkspaceAssetDataUrl, ['../../secrets.txt'])).not.toThrow();
  });

  test('accepts only a bounded Pi run scope and rejects legacy retrieval controls', () => {
    const [payload] = validateIpcArguments(ipcChannels.startPiRun, [{
      sectionId: 'section_1',
      focusSectionId: 'section_1',
      mode: 'rewrite_selection',
      prompt: 'Clarify the selected argument.',
      targetStart: 2,
      targetEnd: 18
    }]);
    expect(payload).toMatchObject({ sectionId: 'section_1', mode: 'rewrite_selection' });
    expect(() => validateIpcArguments(ipcChannels.startPiRun, [{
      sectionId: 'section_1',
      mode: 'rewrite_section',
      prompt: 'Rewrite it.',
      retrievalMode: 'sourcev2'
    }])).toThrow();
  });

  test('rejects malformed settings and prototype-bearing transport objects before dispatch', () => {
    expect(() => validateIpcArguments(ipcChannels.updateLlmSettings, [{
      provider: 'openai-compatible',
      baseURL: 'https://api.example.test/v1',
      model: 'test-model',
      unexpected: 'field'
    }])).toThrow();

    const nonPlainPayload = Object.create(null) as { sectionId: string; markdown: string };
    nonPlainPayload.sectionId = 'section_1';
    nonPlainPayload.markdown = 'Draft';
    expect(() => validateIpcArguments(ipcChannels.updateSectionMarkdown, ['section_1', nonPlainPayload])).toThrow();
  });
});
