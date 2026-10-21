import type { IpcMainInvokeEvent } from 'electron'
import { authorizeSender } from './authorize-sender'
import type {
  IpcEndpointDefinition,
  IpcEndpointParsedInput,
  IpcEndpointOutput
} from '../../shared/contracts/ipc-endpoints'

export interface TypedIpcMain {
  handle(
    channel: string,
    listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
  ): void
  removeHandler(channel: string): void
}

export interface ProjectSessionAuthorizer {
  assertActiveSession(projectSessionId: string): unknown
  assertMutationSession(projectSessionId: string): unknown
}

export interface RegisterEndpointOptions<Endpoint extends IpcEndpointDefinition> {
  developmentUrl?: string
  manager?: ProjectSessionAuthorizer
  /** Keep legacy async rejection behavior for handlers that previously used an async listener. */
  alwaysAsync?: boolean
  /** Preserve a domain's established safe error boundary for this endpoint. */
  onError?: (error: unknown) => never
  handle(
    input: IpcEndpointParsedInput<Endpoint>,
    event: IpcMainInvokeEvent
  ): IpcEndpointOutput<Endpoint> | Promise<IpcEndpointOutput<Endpoint>>
}

function assertSession<Endpoint extends IpcEndpointDefinition>(
  endpoint: Endpoint,
  input: IpcEndpointParsedInput<Endpoint>,
  manager: ProjectSessionAuthorizer | undefined
): void {
  if (endpoint.session === 'none') return
  if (manager === undefined) {
    throw new Error(`IPC endpoint ${endpoint.channel} requires a project session authorizer`)
  }
  if (
    input === null ||
    typeof input !== 'object' ||
    !('projectSessionId' in input) ||
    typeof input.projectSessionId !== 'string'
  ) {
    throw new Error(`IPC endpoint ${endpoint.channel} requires projectSessionId input`)
  }
  if (endpoint.session === 'mutation') manager.assertMutationSession(input.projectSessionId)
  else manager.assertActiveSession(input.projectSessionId)
}

/** Register one endpoint with the shared sender, input, session, and output boundary. */
export function registerIpcEndpoint<Endpoint extends IpcEndpointDefinition>(
  ipc: TypedIpcMain,
  endpoint: Endpoint,
  options: RegisterEndpointOptions<Endpoint>
): () => void {
  ipc.handle(endpoint.channel, (event, rawInput) => {
    const invoke = () => {
      try {
        authorizeSender(event.senderFrame, options.developmentUrl)
        const input = endpoint.input.parse(rawInput) as IpcEndpointParsedInput<Endpoint>
        assertSession(endpoint, input, options.manager)
        const output = options.handle(input, event)
        const parsedOutput =
          output instanceof Promise
            ? output.then((value) => endpoint.output.parse(value))
            : endpoint.output.parse(output)
        if (parsedOutput instanceof Promise && options.onError !== undefined) {
          return parsedOutput.catch(options.onError)
        }
        return parsedOutput
      } catch (error) {
        if (options.onError !== undefined) return options.onError(error)
        throw error
      }
    }
    if (!options.alwaysAsync) return invoke()
    try {
      return Promise.resolve(invoke())
    } catch (error) {
      return Promise.reject(error)
    }
  })
  return () => ipc.removeHandler(endpoint.channel)
}
