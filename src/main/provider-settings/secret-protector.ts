export interface SecretProtector {
  protect(secret: string): Promise<string>;
  unprotect(ciphertext: string): Promise<string>;
  available(): Promise<boolean>;
}
export type SafeStorageLike = {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer | Promise<Buffer>;
  decryptString(value: Buffer): string | Promise<string>;
};
export class ElectronSecretProtector implements SecretProtector {
  constructor(private readonly storage: SafeStorageLike) {}
  async available() {
    return this.storage.isEncryptionAvailable();
  }
  async protect(secret: string) {
    if (!(await this.available())) throw new Error('secure-storage-unavailable');
    return (await this.storage.encryptString(secret)).toString('base64');
  }
  async unprotect(ciphertext: string) {
    if (!(await this.available())) throw new Error('secure-storage-unavailable');
    return this.storage.decryptString(Buffer.from(ciphertext, 'base64'));
  }
}
