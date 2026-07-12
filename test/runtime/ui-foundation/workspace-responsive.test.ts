import { expect,test } from 'bun:test'; import { readFile } from 'node:fs/promises';
test('workspace CSS covers constrained, zoom-like and reduced-motion layouts',async()=>{const css=await readFile('src/renderer/styles.css','utf8');for(const value of ['max-width:860px','min-resolution:1.75dppx','prefers-reduced-motion','minmax(0,1fr)'])expect(css).toContain(value);});
