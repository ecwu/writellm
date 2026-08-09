import { describe, expect, it } from 'vitest'
import { isUnsupportedDirectorySyncError } from './durable-sync'

describe('durable sync', () => {
  it('treats Windows directory fsync EPERM as unsupported without hiding POSIX permission errors', () => {
    const error = Object.assign(new Error('operation not permitted'), { code: 'EPERM' })

    expect(isUnsupportedDirectorySyncError(error, 'win32')).toBe(true)
    expect(isUnsupportedDirectorySyncError(error, 'darwin')).toBe(false)
    expect(isUnsupportedDirectorySyncError(error, 'linux')).toBe(false)
  })

  it.each(['EINVAL', 'ENOTSUP', 'EBADF'])('accepts portable unsupported code %s', (code) => {
    expect(
      isUnsupportedDirectorySyncError(Object.assign(new Error('unsupported'), { code }), 'linux')
    ).toBe(true)
  })
})
