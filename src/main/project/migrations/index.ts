import { migration0001 } from './0001-project-foundation'
import { migration0002 } from './0002-manuscript-bootstrap'
import { migration0003 } from './0003-persistent-jobs'
import { migration0004 } from './0004-job-state-hardening'
import { migration0005 } from './0005-job-runtime-close'
import { migration0006 } from './0006-manuscript-revisions'
import { migration0007 } from './0007-editor-materialization'
import { migration0008 } from './0008-knowledge-imports'
import { migration0009 } from './0009-model-requests'
import { migration0010 } from './0010-mineru-parse-workflow'
import { migration0011 } from './0011-knowledge-normalization'
import { migration0012 } from './0012-checkpoint-19-5-boundaries'
import { migration0013 } from './0013-manuscript-revision-controls'
import { migration0014 } from './0014-artifact-cleanup-requests'
import { migration0015 } from './0015-job-state-schema-hardening'
import { migration0016 } from './0016-agent-sessions'
import { migration0017 } from './0017-mutation-proposal-results'
import { migration0018 } from './0018-section-tombstones'
import { migration0019 } from './0019-section-proposal-refresh'
import { migration0020 } from './0020-agent-approval-and-limits'
import { migration0021 } from './0021-agent-harness-protocol-v2'
import { migration0022 } from './0022-rich-media-and-image-generation'
import { migration0023 } from './0023-agent-provider-selection'
import { migration0024 } from './0024-writing-skills'
import { migration0025 } from './0025-agent-thinking-level'
import { migration0026 } from './0026-agent-session-skill-selection'
import { migration0027 } from './0027-agent-event-schema-v3'
import { migration0028 } from './0028-citation-counts-v2'
import { migration0029 } from './0029-review-issues'
import { migration0030 } from './0030-agent-writing-tasks'
import { migration0031 } from './0031-agent-writing-task-runs'
import { migration0032 } from './0032-agent-change-set-commands'
import { migration0033 } from './0033-figure-metadata'
import { migration0034 } from './0034-manuscript-asset-metadata'
import { migration0035 } from './0035-manuscript-asset-variants'
import { migration0036 } from './0036-manuscript-annotations'
import { migration0037 } from './0037-inline-math-schema-v4'
import { migration0038 } from './0038-native-block-math-diagram-schema-v5'
import { migration0039 } from './0039-agent-interaction-modes'
import { migration0040 } from './0040-agent-request-traces'
import { migration0041 } from './0041-reference-authority'
import { migration0042 } from './0042-agent-request-retry'

export const projectMigrations = [
  migration0001,
  migration0002,
  migration0003,
  migration0004,
  migration0005,
  migration0006,
  migration0007,
  migration0008,
  migration0009,
  migration0010,
  migration0011,
  migration0012,
  migration0013,
  migration0014,
  migration0015,
  migration0016,
  migration0017,
  migration0018,
  migration0019,
  migration0020,
  migration0021,
  migration0022,
  migration0023,
  migration0024,
  migration0025,
  migration0026,
  migration0027,
  migration0028,
  migration0029,
  migration0030,
  migration0031,
  migration0032,
  migration0033,
  migration0034,
  migration0035,
  migration0036,
  migration0037,
  migration0038,
  migration0039,
  migration0040,
  migration0041,
  migration0042
] as const
