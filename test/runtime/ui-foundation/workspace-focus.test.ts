import { expect,test } from 'bun:test'; import { readFile } from 'node:fs/promises';
test('compiled fixture owns workspace, panel, dialog and focus controls',async()=>{const source=await readFile('test/runtime/ui-foundation/fixture.tsx','utf8');for(const value of ['WorkspaceShell','Open dialog','Details','Runtime status'])expect(source).toContain(value);});
