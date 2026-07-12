import { expect,test } from 'bun:test';import { readFile } from 'node:fs/promises';
test('validation boundary maps provider failures to app-owned diagnostics',async()=>{const s=await readFile('src/main/provider-settings/validator.ts','utf8');for(const token of ['401','403','429','404','422','timeout'])expect(s).toContain(token);expect(s).not.toContain('errorMessage as');});
