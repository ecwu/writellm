import { randomBytes, randomUUID } from 'node:crypto';

export function createId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

export function createShortRef(length = 7): string {
  return randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
}

export function nowIso(): string {
  return new Date().toISOString();
}
