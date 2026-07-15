import { migration0001 } from './0001-project-foundation'
import { migration0002 } from './0002-manuscript-bootstrap'
import { migration0003 } from './0003-persistent-jobs'

export const projectMigrations = [migration0001, migration0002, migration0003] as const
