import { expect, test } from 'bun:test';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os'; import path from 'node:path';
import { ProviderSettingsRepository } from '../../../src/main/provider-settings/repository';

const protector={available:async()=>true,protect:async(s:string)=>Buffer.from(s).toString('base64'),unprotect:async(s:string)=>Buffer.from(s,'base64').toString()};
const config={providerKind:'openai-compatible' as const,baseUrl:'https://example.test/v1/',modelId:'writer',contextWindow:4096,maxOutputTokens:512,reasoning:false};
test('save, edit and restart remain application-global and leave project bytes unchanged',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'provider-flow-')); const app=path.join(root,'userData'); const project=path.join(root,'project.txt'); await writeFile(project,'project-sentinel');
 let n=0; const repo=new ProviderSettingsRepository(app,protector,()=>new Date(0).toISOString(),()=>`r${++n}`); await repo.initialize();
 const first=await repo.save(null,config,'secret'); expect(first.ok).toBe(true); const second=await repo.save('r1',{...config,modelId:'writer-2'}); expect(second.ok).toBe(true);
 const reopened=new ProviderSettingsRepository(app,protector); await reopened.initialize(); expect(reopened.summary()).toMatchObject({revision:'r2',config:{modelId:'writer-2'},secretState:'configured'});
 expect(await readFile(project,'utf8')).toBe('project-sentinel');
});
