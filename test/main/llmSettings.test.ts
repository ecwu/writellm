import { describe, expect, test } from 'bun:test';
import { assertOutboundDataAllowed } from '../../src/main/llmSettings.js';

describe('outbound-data policy snapshots', () => {
  test('allows an authorized remote worker request without accessing Electron storage', () => {
    expect(() => assertOutboundDataAllowed(
      'https://provider.example.test/v1',
      'embedding',
      { externalProcessingEnabled: true }
    )).not.toThrow();
  });

  test('continues to block unauthorized remote worker requests', () => {
    expect(() => assertOutboundDataAllowed(
      'https://provider.example.test/v1',
      'rerank',
      { externalProcessingEnabled: false }
    )).toThrow('External rerank processing is disabled.');
  });

  test('permits loopback processing even when external processing is disabled', () => {
    expect(() => assertOutboundDataAllowed(
      'http://127.0.0.1:11434/v1',
      'chat',
      { externalProcessingEnabled: false }
    )).not.toThrow();
  });
});
