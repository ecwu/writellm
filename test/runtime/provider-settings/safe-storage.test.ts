import { expect, test } from 'bun:test';
import { ElectronSecretProtector } from '../../../src/main/provider-settings/secret-protector';

test('runtime adapter awaits encryption/decryption and fails closed when protection is unavailable', async () => {
  const unavailable = new ElectronSecretProtector({
    isEncryptionAvailable: () => false,
    encryptString: async () => Buffer.from('forbidden'),
    decryptString: async () => 'forbidden',
  });
  await expect(unavailable.protect('sentinel')).rejects.toThrow();
  const available = new ElectronSecretProtector({
    isEncryptionAvailable: () => true,
    encryptString: async (v) => Buffer.from(`sealed:${v}`),
    decryptString: async (v) => v.toString().slice(7),
  });
  const ciphertext = await available.protect('sentinel');
  expect(ciphertext).not.toContain('sentinel');
  expect(await available.unprotect(ciphertext)).toBe('sentinel');
});
