import { expect,test } from 'bun:test';import { draftFromSummary } from '../../../src/renderer/features/provider-settings/provider-settings-state';
test('never restores a secret into the renderer draft',()=>{expect(draftFromSummary({revision:'r',config:null,harnessProfile:null,secretState:'configured',validation:{status:'not-run'},available:false}).secret).toBe('');});
