# Toolchain compatibility

Verified 2026-07-12 with Bun 1.3.14, React/React DOM 19.2.7, TypeScript 7.0.2, Vite 8.1.4, Tailwind CSS and `@tailwindcss/vite` 4.3.2.

The no-product-code compatibility probe was the existing production graph: `bun run build`, followed by `bun run typecheck`. Vite compiled React, the Electron/preload TypeScript compilation completed, and the production renderer emitted successfully. Exact versions are recorded in `package.json` and `bun.lock`; no floating version is a repeatable input.
