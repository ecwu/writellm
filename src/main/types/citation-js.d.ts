declare module '@citation-js/core' {
  export class Cite {
    constructor(data: unknown, options?: unknown)
    format(template: 'data', options: { format: 'object' }): unknown
  }
}

declare module '@citation-js/plugin-bibtex'
