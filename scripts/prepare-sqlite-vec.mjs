import { copyFile, mkdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { arch, platform } from 'node:process'
import { getLoadablePath } from 'sqlite-vec'

const source = getLoadablePath()
const destinationDirectory = join('resources', 'native', 'sqlite-vec', `${platform}-${arch}`)
await mkdir(destinationDirectory, { recursive: true })
await copyFile(source, join(destinationDirectory, basename(source)))
