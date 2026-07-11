import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export type ProviderSecrets = {
  chatApiKey: string;
  embeddingApiKey: string;
  rerankApiKey: string;
  visionApiKey: string;
  mineruApiKey: string;
};

type EncryptedSecretStore = {
  version: 1;
  secrets: Partial<Record<keyof ProviderSecrets, string>>;
};

type ElectronMain = typeof import('electron');

const loadElectron = createRequire(import.meta.url);

function getElectronMain(): ElectronMain {
  return loadElectron('electron') as ElectronMain;
}

function getElectronApp(): ElectronMain['app'] {
  const app = getElectronMain().app;
  if (!app) {
    throw new Error('Electron application storage is unavailable in this runtime.');
  }
  return app;
}

const emptySecrets = (): ProviderSecrets => ({
  chatApiKey: '',
  embeddingApiKey: '',
  rerankApiKey: '',
  visionApiKey: '',
  mineruApiKey: ''
});

export function readProviderSecrets(): ProviderSecrets {
  const filePath = secretStorePath();
  if (!existsSync(filePath)) {
    return emptySecrets();
  }
  assertSecureSecretStorage();
  const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as EncryptedSecretStore;
  if (parsed.version !== 1 || !parsed.secrets || typeof parsed.secrets !== 'object') {
    throw new Error('Secure credential store is invalid. Re-enter provider credentials in Settings.');
  }
  const next = emptySecrets();
  (Object.keys(next) as Array<keyof ProviderSecrets>).forEach((key) => {
    const encoded = parsed.secrets[key];
    if (typeof encoded !== 'string' || !encoded) {
      return;
    }
    next[key] = getSafeStorage().decryptString(Buffer.from(encoded, 'base64'));
  });
  return next;
}

export function writeProviderSecrets(secrets: ProviderSecrets): void {
  const entries = Object.entries(secrets).filter(([, value]) => value.trim()) as Array<[keyof ProviderSecrets, string]>;
  if (entries.length === 0) {
    writeSecretStore({ version: 1, secrets: {} });
    return;
  }
  assertSecureSecretStorage();
  const encrypted: EncryptedSecretStore = { version: 1, secrets: {} };
  entries.forEach(([key, value]) => {
    encrypted.secrets[key] = getSafeStorage().encryptString(value).toString('base64');
  });
  writeSecretStore(encrypted);
}

export function secureStorageStatus(): { available: boolean; reason: string | null } {
  const safeStorage = getElectronMain().safeStorage;
  if (!safeStorage) {
    return { available: false, reason: 'Electron secure storage is unavailable in this runtime.' };
  }
  if (!safeStorage.isEncryptionAvailable()) {
    return { available: false, reason: 'The operating-system secret store is unavailable.' };
  }
  if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') {
    return { available: false, reason: 'No supported Linux secret service is available.' };
  }
  return { available: true, reason: null };
}

function assertSecureSecretStorage(): void {
  const status = secureStorageStatus();
  if (!status.available) {
    throw new Error(`Provider credentials require secure operating-system storage. ${status.reason}`);
  }
}

function getSafeStorage(): NonNullable<ElectronMain['safeStorage']> {
  const safeStorage = getElectronMain().safeStorage;
  if (!safeStorage) {
    throw new Error('Electron secure storage is unavailable in this runtime.');
  }
  return safeStorage;
}

function secretStorePath(): string {
  const directory = getElectronApp().getPath('userData');
  mkdirSync(directory, { recursive: true });
  return path.join(directory, 'writellm-provider-secrets.json');
}

function writeSecretStore(store: EncryptedSecretStore): void {
  writeFileSync(secretStorePath(), `${JSON.stringify(store, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}
