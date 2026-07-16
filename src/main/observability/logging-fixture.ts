import { createPortLogger } from '../../workers/shared/port-logger'

process.parentPort.once('message', (event) => {
  const port = event.ports[0]
  if (port === undefined) throw new Error('Logging fixture did not receive a MessagePort')
  const log = createPortLogger(
    port,
    { processRole: 'background-worker', subsystem: 'worker', component: 'logging-fixture' },
    { operationId: 'logging-fixture' }
  )
  log('info', 'worker.fixture.started', 'Logging fixture started')
  process.stderr.write('logging fixture stderr\n')
})
