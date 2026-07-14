import { request as httpsRequest } from 'node:https';
import type { MinerUFileUpload } from './mineru-adapter.js';

export const uploadFileWithProgress: MinerUFileUpload = (url, bytes, signal, onProgress) =>
  new Promise((resolve, reject) => {
    const request = httpsRequest(url, {
      method: 'PUT',
      headers: { 'Content-Length': String(bytes.byteLength) },
    });
    let progressUpdates = Promise.resolve();
    let completed = 0;
    let settled = false;
    const cleanup = () => {
      signal.removeEventListener('abort', abort);
    };
    const abort = () => request.destroy(new Error('UPLOAD_ABORTED'));
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      void progressUpdates.then(() => reject(error));
    };
    signal.addEventListener('abort', abort, { once: true });
    request.on('response', (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('error', fail);
      response.on('end', () => {
        if (settled) return;
        settled = true;
        cleanup();
        void progressUpdates.then(() =>
          resolve(
            new Response(Buffer.concat(chunks), {
              status: response.statusCode ?? 500,
              statusText: response.statusMessage,
              headers: Object.entries(response.headers).flatMap(([name, value]) => {
                if (value === undefined) return [];
                return Array.isArray(value) ? value.map((item) => [name, item]) : [[name, value]];
              }),
            }),
          ),
        );
      });
    });
    request.on('error', fail);
    if (signal.aborted) {
      abort();
      return;
    }
    const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const chunkSize = 256 * 1024;
    for (let offset = 0; offset < buffer.byteLength; offset += chunkSize) {
      const chunk = buffer.subarray(offset, Math.min(buffer.byteLength, offset + chunkSize));
      request.write(chunk, () => {
        completed += chunk.byteLength;
        const current = completed;
        progressUpdates = progressUpdates.then(() => onProgress(current, buffer.byteLength));
      });
    }
    request.end();
  });
