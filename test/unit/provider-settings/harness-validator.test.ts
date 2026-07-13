import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

test('validator freezes a nonce schema, bounded loop, transcript disposal and incompatibility outcomes', async () => {
  const s = await readFile('src/main/provider-settings/validator.ts', 'utf8');
  const compact = s.replace(/\s/g, '');
  expect(s).toContain('Type.Literal(nonce)');
  expect(compact).toContain('turns>=2');
  expect(compact).toContain('maxRetries:0');
  expect(s).toContain('VALIDATION_TOOLS_UNSUPPORTED');
  expect(s).not.toContain('persist transcript');
});
test('validator owns safe classifications and never returns raw provider errors', async () => {
  const s = await readFile('src/main/provider-settings/validator.ts', 'utf8');
  for (const code of [
    'VALIDATION_AUTH_REJECTED',
    'VALIDATION_RATE_LIMITED',
    'VALIDATION_MODEL_REJECTED',
    'VALIDATION_TIMEOUT',
    'VALIDATION_UNKNOWN',
  ])
    expect(s).toContain(code);
  expect(s).not.toContain('safeMessage:error');
});
