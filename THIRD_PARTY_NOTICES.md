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
