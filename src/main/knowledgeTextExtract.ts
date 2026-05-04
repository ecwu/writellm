import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { TextItem, TextMarkedContent } from 'pdfjs-dist/types/src/display/api.js';

const require = createRequire(import.meta.url);
const PDFJS_ROOT = path.dirname(require.resolve('pdfjs-dist/package.json'));
const STANDARD_FONT_DATA_URL = `${path.join(PDFJS_ROOT, 'standard_fonts')}${path.sep}`;

export async function extractKnowledgeFileText(
  filePath: string,
  fileExt = path.extname(filePath).toLowerCase()
): Promise<string> {
  if (fileExt === '.txt' || fileExt === '.md') {
    return readFile(filePath, 'utf8');
  }
  if (fileExt === '.pdf') {
    return extractPdfText(filePath);
  }
  throw new Error(`Unsupported knowledge file type: ${fileExt || '(none)'}`);
}

export async function extractKnowledgeFileTextSample(
  filePath: string,
  fileExt: string,
  maxChars: number
): Promise<string> {
  if (fileExt === '.txt' || fileExt === '.md') {
    return (await readFile(filePath, 'utf8')).slice(0, maxChars);
  }
  if (fileExt === '.pdf') {
    return extractPdfText(filePath, maxChars);
  }
  throw new Error(`Unsupported knowledge file type: ${fileExt || '(none)'}`);
}

async function extractPdfText(filePath: string, maxChars = Number.POSITIVE_INFINITY): Promise<string> {
  const bytes = await readFile(filePath);
  const document = await getDocument({
    data: new Uint8Array(bytes),
    useWorkerFetch: false,
    useWasm: false,
    standardFontDataUrl: STANDARD_FONT_DATA_URL,
    stopAtErrors: false
  }).promise;
  const pages: string[] = [];
  let totalChars = 0;

  try {
    for (let pageNumber = 1; pageNumber <= document.numPages && totalChars < maxChars; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item: TextItem | TextMarkedContent) => ('str' in item ? item.str : ''))
        .join(' ')
        .replace(/[ \t]+/g, ' ')
        .trim();
      if (pageText) {
        pages.push(pageText);
        totalChars += pageText.length + 2;
      }
    }
  } finally {
    await document.destroy();
  }
  return pages.join('\n\n').slice(0, maxChars);
}
