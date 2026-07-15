import { migration0001 } from './0001-project-foundation'
import { migration0002 } from './0002-manuscript-bootstrap'
import { migration0003 } from './0003-persistent-jobs'
import { migration0004 } from './0004-job-state-hardening'
import { migration0005 } from './0005-job-runtime-close'
import { migration0006 } from './0006-manuscript-revisions'
import { migration0007 } from './0007-editor-materialization'

export const projectMigrations = [
  migration0001,
  migration0002,
  migration0003,
  migration0004,
  migration0005,
  migration0006,
  migration0007
] as const
