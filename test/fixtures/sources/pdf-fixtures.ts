const encoder = new TextEncoder();

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
