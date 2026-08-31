# Third-Party Notices

## models.dev Provider metadata and logos

WriteLLM includes a reviewed local snapshot of Provider names, API endpoints, and SVG logos from
[models.dev](https://models.dev/) and the
[anomalyco/models.dev](https://github.com/anomalyco/models.dev) repository.

The models.dev source repository is distributed under the MIT License. Provider names and logos
may be trademarks of their respective owners. They are shown only to identify configured AI
service providers; no endorsement or affiliation is implied.

The snapshot date and SHA-256 digest of every included SVG are recorded in
`src/shared/models-dev-provider-logos.generated.ts`. Updates are performed explicitly with
`npm run sync:provider-logos`; the application never downloads these logos at runtime.

## citeproc-js

WriteLLM includes `citeproc` 2.4.63 through the Citation.js CSL formatting adapter. citeproc-js is
Copyright Frank G. Bennett, Jr. and contributors and is distributed under the Common Public
Attribution License Version 1.0 (CPAL-1.0) distribution option. Source and license information are
available from [Juris-M/citeproc-js](https://github.com/Juris-M/citeproc-js). This distribution
notice identifies the application CSL formatter as powered by citeproc-js through Citation.js.
