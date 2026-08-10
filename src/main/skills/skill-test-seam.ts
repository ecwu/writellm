import { readFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type { Logger } from 'pino'
import { z } from 'zod'
import {
  skillCommitSchema,
  skillDirectorySchema,
  skillRelativePathSchema,
  skillRepositorySchema
} from '../../shared/contracts/skills'
import type { WindowPresentation } from '../bootstrap/window-presentation'
import type { SkillService } from './skill-service'

export const E2E_SKILL_FIXTURE_PATH_ENV = 'WRITELLM_E2E_SKILL_FIXTURE_PATH'

const fixtureSchema = z
  .object({
    repository: skillRepositorySchema,
    directory: skillDirectorySchema,
    commit: skillCommitSchema,
    license: z.string().trim().min(1).max(100).nullable(),
    files: z.array(skillRelativePathSchema).min(1).max(32)
  })
  .strict()

export async function installSkillE2eFixture(options: {
  service: SkillService
  windowPresentation: WindowPresentation
  log: Pick<Logger, 'info'>
}): Promise<void> {
  const configured = process.env[E2E_SKILL_FIXTURE_PATH_ENV]
  if (configured === undefined) return
  if (options.windowPresentation !== 'silent-e2e' || !isAbsolute(configured)) {
    throw new Error(`${E2E_SKILL_FIXTURE_PATH_ENV} requires silent E2E mode and an absolute path`)
  }
  const root = resolve(configured)
  const fixture = fixtureSchema.parse(
    JSON.parse(await readFile(join(root, 'fixture.json'), 'utf8'))
  )
  const files = await Promise.all(
    fixture.files.map(async (path) => {
      const resolved = resolve(root, path)
      const child = relative(root, resolved)
      if (child.startsWith('..') || isAbsolute(child))
        throw new Error('E2E skill fixture file escapes')
      return { path, bytes: await readFile(resolved) }
    })
  )
  await options.service.installE2eFixture({ ...fixture, files })
  options.log.info(
    { event: 'skill.e2e_fixture.installed', fileCount: files.length },
    'Installed silent E2E writing skill fixture'
  )
}
