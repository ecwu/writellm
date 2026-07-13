const encoder = new TextEncoder();

export const smallRangedPdfFixture = () => validPdfFixture();
export const tamperedPdfFixture = () => {
  const bytes = validPdfFixture();
  const tampered = new Uint8Array(bytes);
  tampered[0] = 0;
  return tampered;
};
export const pdfByteRanges = (bytes: Uint8Array) => ({
  first: bytes.slice(0, Math.min(16, bytes.byteLength)),
  middle: bytes.slice(
    Math.max(0, Math.floor(bytes.byteLength / 2) - 8),
    Math.floor(bytes.byteLength / 2) + 8,
  ),
  final: bytes.slice(Math.max(0, bytes.byteLength - 16)),
});

/** A deterministic sparse boundary fixture that does not allocate 200 MB in test memory. */
export async function createBoundaryPdfFixture(path: string, size = 200 * 1024 * 1024) {
  const { open } = await import('node:fs/promises');
  const handle = await open(path, 'w');
  try {
    await handle.write(encoder.encode('%PDF-1.7\n'), 0, 9, 0);
    await handle.truncate(size);
    const end = encoder.encode('\n%%EOF');
    await handle.write(end, 0, end.byteLength, size - end.byteLength);
  } finally {
    await handle.close();
  }
  return { path, size };
}

function pdf(body: string, pages = 1): Uint8Array {
  const pageObjects = Array.from({ length: pages }, (_, index) => `${index + 3} 0 R`).join(' ');
  return encoder.encode(
    `%PDF-1.7\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count ${pages}/Kids[${pageObjects}]>>endobj\n${body}\n%%EOF`,
  );
}

export const validPdfFixture = () =>
  pdf('3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj');
export const scannedPdfFixture = () =>
  pdf('3 0 obj<</Type/Page/Parent 2 0 R/Resources<</XObject<</Im0 4 0 R>>>>>>endobj');
export const tableImagePdfFixture = () =>
  pdf(
    '3 0 obj<</Type/Page/Parent 2 0 R/Contents 4 0 R>>endobj\n4 0 obj<</Length 10>>stream\nTABLE IMG\nendstream\nendobj',
  );
export const encryptedPdfFixture = () =>
  pdf('3 0 obj<</Type/Page/Parent 2 0 R>>endobj\ntrailer<</Encrypt 4 0 R>>');
export const corruptPdfFixture = () => encoder.encode('%PDF-1.7\ntruncated');
export const sameNameSameSizePdfFixtures = () => {
  const first = validPdfFixture();
  const second = new Uint8Array(first);
  second[second.length - 1] = second[second.length - 1] === 70 ? 71 : 70;
  return { displayName: 'same.pdf', first, second };
};
export const exactDuplicatePdfFixtures = () => {
  const first = validPdfFixture();
  return { first, second: new Uint8Array(first) };
};
export const fiveHundredBlockPdfFixture = () =>
  pdf(
    Array.from(
      { length: 500 },
      (_, index) => `${index + 3} 0 obj<</Type/Page/Parent 2 0 R/Contents(${index})>>endobj`,
    ).join('\n'),
    500,
  );
