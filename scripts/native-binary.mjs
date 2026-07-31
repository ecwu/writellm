export function inspectNativeBinary(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.byteLength < 24) {
    throw new Error('Native binary is truncated')
  }

  if (buffer[0] === 0x7f && buffer.subarray(1, 4).toString('ascii') === 'ELF') {
    const littleEndian = buffer[5] === 1
    const machine = littleEndian ? buffer.readUInt16LE(18) : buffer.readUInt16BE(18)
    return { format: 'elf', arch: elfArchitecture(machine) }
  }

  const littleMagic = buffer.readUInt32LE(0)
  const bigMagic = buffer.readUInt32BE(0)
  if (littleMagic === 0xfeedfacf || bigMagic === 0xfeedfacf) {
    const littleEndian = littleMagic === 0xfeedfacf
    const cpuType = littleEndian ? buffer.readUInt32LE(4) : buffer.readUInt32BE(4)
    return { format: 'mach-o', arch: machArchitecture(cpuType) }
  }

  if (buffer.subarray(0, 2).toString('ascii') === 'MZ') {
    if (buffer.byteLength < 64) throw new Error('PE binary is truncated')
    const headerOffset = buffer.readUInt32LE(0x3c)
    if (headerOffset + 6 > buffer.byteLength) throw new Error('PE header is truncated')
    if (buffer.subarray(headerOffset, headerOffset + 4).toString('binary') !== 'PE\u0000\u0000') {
      throw new Error('PE signature is invalid')
    }
    return { format: 'pe', arch: peArchitecture(buffer.readUInt16LE(headerOffset + 4)) }
  }

  throw new Error('Unsupported native binary format')
}

export function assertNativeBinaryArchitecture(buffer, expectedArch, label) {
  const inspected = inspectNativeBinary(buffer)
  if (inspected.arch !== expectedArch) {
    throw new Error(`${label} architecture is ${inspected.arch}; expected ${expectedArch}`)
  }
  return inspected
}

function elfArchitecture(machine) {
  if (machine === 62) return 'x64'
  if (machine === 183) return 'arm64'
  throw new Error(`Unsupported ELF machine ${machine}`)
}

function machArchitecture(cpuType) {
  if (cpuType === 0x01000007) return 'x64'
  if (cpuType === 0x0100000c) return 'arm64'
  throw new Error(`Unsupported Mach-O CPU type ${cpuType}`)
}

function peArchitecture(machine) {
  if (machine === 0x8664) return 'x64'
  if (machine === 0xaa64) return 'arm64'
  throw new Error(`Unsupported PE machine ${machine}`)
}
