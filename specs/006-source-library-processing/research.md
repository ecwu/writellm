# Research: PDF 资料导入与处理

本轮只记录主流候选与一手资料，不作最终选型。需在 PoC 中验证 Electron 43/Bun ESM-CJS、跨平台打包、许可证、native/module 大小、维护状态和离线替代。

## 候选

候选：pdf-parse、pdfjs-dist/unpdf、MuPDF.js、Apache Tika；embedding 可来自 provider、Transformers.js 或 ONNX helper；job 可在 main/worker/utility process。

https://mozilla.github.io/pdf.js/
https://www.npmjs.com/package/pdf-parse
https://github.com/unjs/unpdf
https://mupdfjs.readthedocs.io/
https://tika.apache.org/

Decision: NEEDS DECISION；最终版本、升级策略、fallback 和 ADR 链接留空。
