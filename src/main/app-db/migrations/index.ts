import { migration0001 } from './0001-application-state'
import { migration0002 } from './0002-agent-model-catalogs'
import { migration0003 } from './0003-agent-model-preferences'
import { migration0004 } from './0004-credential-bindings'

export const appMigrations = [migration0001, migration0002, migration0003, migration0004] as const
