const { app, BrowserWindow, protocol } = require('electron')

const scheme = 'writellm-pdf-smoke'
protocol.registerSchemesAsPrivileged([
  { scheme, privileges: { standard: true, secure: true, supportFetchAPI: true } }
])

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
)

void (async () => {
  await app.whenReady()
  process.stderr.write('pdf-smoke:ready\n')
  let window
  try {
    window = new BrowserWindow({
      show: false,
      width: 900,
      height: 1200,
      webPreferences: {
        partition: 'writellm-pdf-smoke',
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        javascript: false
      }
    })
    window.webContents.session.protocol.handle(scheme, () =>
      Promise.resolve(
        new Response(new Uint8Array(png), { headers: { 'content-type': 'image/png' } })
      )
    )
    const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
      @page { size: A4; margin: 20mm; }
      html { font-family: "PingFang SC", "Songti SC", serif; }
      h1 { break-before: page; } img { width: 40px; height: 40px; }
    </style></head><body>
      <h1 id="first">第一章 Mixed Latin</h1>
      <p>可选择的中文与 English text.</p>
      <a href="#second">Internal link</a>
      <a href="https://example.com/research">External link</a>
      <img src="${scheme}://asset/pixel" alt="Pixel alternative">
      <h1 id="second">第二章 Conclusion</h1><p>Final page content.</p>
    </body></html>`
    await window.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`)
    process.stderr.write('pdf-smoke:loaded\n')
    const pdf = await window.webContents.printToPDF({
      printBackground: true,
      displayHeaderFooter: true,
      preferCSSPageSize: true,
      generateTaggedPDF: true,
      generateDocumentOutline: true,
      pageSize: 'A4',
      margins: { top: 0, right: 0, bottom: 0, left: 0 },
      headerTemplate: '<span></span>',
      footerTemplate:
        '<div style="width:100%;font-size:8px;text-align:center"><span class="pageNumber"></span> / <span class="totalPages"></span></div>'
    })
    process.stderr.write('pdf-smoke:printed\n')
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const loading = getDocument({ data: new Uint8Array(pdf) })
    const document = await loading.promise
    const text = []
    const annotationUrls = []
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const content = await page.getTextContent()
      text.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '))
      const annotations = await page.getAnnotations()
      annotationUrls.push(
        ...annotations.flatMap((annotation) =>
          typeof annotation.url === 'string'
            ? [annotation.url]
            : annotation.dest !== undefined
              ? ['internal']
              : []
        )
      )
    }
    const outline = (await document.getOutline()) ?? []
    const result = {
      pdfHeader: pdf.subarray(0, 5).toString('ascii'),
      byteSize: pdf.byteLength,
      pageCount: document.numPages,
      text: text.join(' '),
      outline: outline.map((item) => item.title),
      annotations: annotationUrls
    }
    const normalizedText = result.text.normalize('NFKC').replace(/\s/gu, '')
    if (
      result.pdfHeader !== '%PDF-' ||
      !normalizedText.includes('第一章') ||
      !result.text.includes('English') ||
      result.outline.length < 2 ||
      !result.annotations.includes('internal') ||
      !result.annotations.some((value) => value.startsWith('https://example.com/'))
    ) {
      throw new Error(`PDF runtime verification failed: ${JSON.stringify(result)}`)
    }
    process.stdout.write(`${JSON.stringify(result)}\n`)
    await loading.destroy()
  } finally {
    if (window && !window.isDestroyed()) window.destroy()
    app.quit()
  }
})().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`)
  app.exit(1)
})
