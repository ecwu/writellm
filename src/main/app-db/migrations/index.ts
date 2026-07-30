import { migration0001 } from './0001-application-state'
import { migration0002 } from './0002-agent-model-catalogs'

export const appMigrations = [migration0001, migration0002] as const
