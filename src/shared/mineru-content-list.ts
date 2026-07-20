const CONTENT_LIST_NAME = /^(?:content_list|.+_content_list)\.json$/i

export function chooseMineruContentListPath(paths: readonly string[]): string | undefined {
  return paths
    .filter((path) => CONTENT_LIST_NAME.test(basename(path)))
    .sort((left, right) => contentListPriority(left) - contentListPriority(right))[0]
}

function contentListPriority(path: string): number {
  return basename(path).toLowerCase() === 'content_list.json' ? 0 : 1
}

function basename(path: string): string {
  return path.split('/').at(-1) ?? path
}
