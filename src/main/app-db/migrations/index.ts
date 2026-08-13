import { migration0001 } from './0001-application-state'
import { migration0002 } from './0002-agent-model-catalogs'
import { migration0003 } from './0003-agent-model-preferences'
import { migration0004 } from './0004-credential-bindings'
import { migration0005 } from './0005-agent-skills'
import { migration0006 } from './0006-recent-project-path-uniqueness'
import { migration0007 } from './0007-publication-presets'
import { migration0008 } from './0008-project-templates'

export const appMigrations = [
  migration0001,
  migration0002,
  migration0003,
  migration0004,
  migration0005,
  migration0006,
  migration0007,
  migration0008
] as const
