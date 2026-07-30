import { migration0001 } from './0001-application-state'
import { migration0002 } from './0002-agent-model-catalogs'
import { migration0003 } from './0003-agent-model-preferences'

export const appMigrations = [migration0001, migration0002, migration0003] as const
