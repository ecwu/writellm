import { migration0001 } from './0001-project-foundation'
import { migration0002 } from './0002-manuscript-bootstrap'

export const projectMigrations = [migration0001, migration0002] as const
