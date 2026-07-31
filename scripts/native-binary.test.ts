import { describe, expect, it } from 'vitest'
import { assertNativeBinaryArchitecture, inspectNativeBinary } from './native-binary.mjs'

describe('native package architecture inspection', () => {
  it('recognizes x64 and arm64 Mach-O, ELF, and PE binaries', () => {
    const machArm = Buffer.alloc(24)
    machArm.writeUInt32LE(0xfeedfacf, 0)
    machArm.writeUInt32LE(0x0100000c, 4)
    expect(inspectNativeBinary(machArm)).toEqual({ format: 'mach-o', arch: 'arm64' })

    const elfX64 = Buffer.alloc(24)
    elfX64.set([0x7f, 0x45, 0x4c, 0x46])
    elfX64[5] = 1
    elfX64.writeUInt16LE(62, 18)
    expect(inspectNativeBinary(elfX64)).toEqual({ format: 'elf', arch: 'x64' })

    const peX64 = Buffer.alloc(96)
    peX64.write('MZ')
    peX64.writeUInt32LE(64, 0x3c)
    peX64.write('PE\u0000\u0000', 64, 'binary')
    peX64.writeUInt16LE(0x8664, 68)
    expect(inspectNativeBinary(peX64)).toEqual({ format: 'pe', arch: 'x64' })
  })

  it('fails closed for mismatched, truncated, and unsupported binaries', () => {
    const machX64 = Buffer.alloc(24)
    machX64.writeUInt32LE(0xfeedfacf, 0)
    machX64.writeUInt32LE(0x01000007, 4)
    expect(() => assertNativeBinaryArchitecture(machX64, 'arm64', 'fixture')).toThrow(
      'architecture is x64'
    )
    expect(() => inspectNativeBinary(Buffer.alloc(4))).toThrow('truncated')
    expect(() => inspectNativeBinary(Buffer.alloc(24))).toThrow('Unsupported')
  })
})
