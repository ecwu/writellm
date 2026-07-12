import { expect, test } from 'bun:test';
import { providerSettingsChannels } from '../../../src/shared/provider-settings';

test('provider bridge is exactly five named methods and channels', async () => {
  const preload = await Bun.file('src/preload/preload.cts').text();
  for (const method of [
    'getProviderSummary',
    'saveProviderSettings',
    'replaceProviderSecret',
    'removeProviderSecret',
    'validateProvider',
  ])
    expect(preload).toContain(method);
  expect(Object.keys(providerSettingsChannels)).toHaveLength(5);
  expect(preload).not.toContain('send:');
});
