import type { IpcMainInvokeEvent } from 'electron'
import type { z } from 'zod'
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

export interface ProjectSessionAuthorizer<Context = unknown> {
  assertActiveSession(projectSessionId: string): Context
  assertMutationSession(projectSessionId: string): Context
}

/** The project context a handler receives after the declared session check. */
export type IpcEndpointContext<
  Endpoint extends IpcEndpointDefinition,
  Context
> = Endpoint['session'] extends 'none' ? undefined : Context

/** Handlers may return pre-validation data; the registration parses it with the output schema. */
export type IpcEndpointHandlerResult<Endpoint extends IpcEndpointDefinition> =
  | z.input<Endpoint['output']>
  | IpcEndpointOutput<Endpoint>
  // biome-ignore lint/suspicious/noConfusingVoidType: async handlers for undefined outputs return Promise<void>.
  | (undefined extends z.input<Endpoint['output']> ? void : never)

export type IpcEndpointHandler<Endpoint extends IpcEndpointDefinition, Context = unknown> = (
  input: IpcEndpointParsedInput<Endpoint>,
  context: IpcEndpointContext<Endpoint, Context>,
  event: IpcMainInvokeEvent
) => IpcEndpointHandlerResult<Endpoint> | Promise<IpcEndpointHandlerResult<Endpoint>>

export interface RegisterEndpointOptions<Endpoint extends IpcEndpointDefinition, Context> {
  developmentUrl?: string
  manager?: ProjectSessionAuthorizer<Context>
  /**
   * Wrap session authorization, the handler, and output validation. Domains use this for
   * lifecycle logging so session rejections report the same operation event as handler failures.
   */
  around?: (
    input: IpcEndpointParsedInput<Endpoint>,
    run: () => Promise<IpcEndpointOutput<Endpoint>>
  ) => Promise<IpcEndpointOutput<Endpoint>>
  /** Preserve a domain's established safe error boundary for this endpoint. */
  onError?: (error: unknown) => never
  handle: IpcEndpointHandler<Endpoint, Context>
}

function authorizeSession<Endpoint extends IpcEndpointDefinition, Context>(
  endpoint: Endpoint,
  input: IpcEndpointParsedInput<Endpoint>,
  manager: ProjectSessionAuthorizer<Context> | undefined
): IpcEndpointContext<Endpoint, Context> {
  if (endpoint.session === 'none') return undefined as IpcEndpointContext<Endpoint, Context>
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
  const context =
    endpoint.session === 'mutation'
      ? manager.assertMutationSession(input.projectSessionId)
      : manager.assertActiveSession(input.projectSessionId)
  return context as IpcEndpointContext<Endpoint, Context>
}

/**
 * Register one endpoint with the shared sender, input, session, and output boundary. This is the
 * only place a migrated endpoint parses its input and output or checks its declared session.
 * Every invocation is asynchronous, so failures always surface as rejections.
 */
export function registerIpcEndpoint<Endpoint extends IpcEndpointDefinition, Context = unknown>(
  ipc: TypedIpcMain,
  endpoint: Endpoint,
  options: RegisterEndpointOptions<Endpoint, Context>
): () => void {
  ipc.handle(endpoint.channel, async (event, rawInput) => {
    try {
      authorizeSender(event.senderFrame, options.developmentUrl)
      const input = endpoint.input.parse(rawInput) as IpcEndpointParsedInput<Endpoint>
      const run = async (): Promise<IpcEndpointOutput<Endpoint>> => {
        const context = authorizeSession(endpoint, input, options.manager)
        const output = await options.handle(input, context, event)
        return endpoint.output.parse(output) as IpcEndpointOutput<Endpoint>
      }
      return await (options.around === undefined ? run() : options.around(input, run))
    } catch (error) {
      if (options.onError !== undefined) return options.onError(error)
      throw error
    }
  })
  return () => ipc.removeHandler(endpoint.channel)
}

/**
 * Bind the shared registration options for one IPC domain. The returned function only accepts
 * endpoint definitions, so a domain cannot register a channel without a declared contract.
 */
export function createEndpointRegistrar<Context>(
  ipc: TypedIpcMain,
  defaults: {
    developmentUrl?: string
    manager?: ProjectSessionAuthorizer<Context>
    onError?: (channel: string, error: unknown) => never
    wrap?: <T>(event: IpcMainInvokeEvent, input: unknown, run: () => Promise<T>) => Promise<T>
  }
) {
  return <Endpoint extends IpcEndpointDefinition>(
    endpoint: Endpoint,
    handle: IpcEndpointHandler<Endpoint, Context>,
    extra: Pick<RegisterEndpointOptions<Endpoint, Context>, 'around'> = {}
  ): (() => void) =>
    registerIpcEndpoint(ipc, endpoint, {
      developmentUrl: defaults.developmentUrl,
      manager: defaults.manager,
      ...extra,
      ...(defaults.onError === undefined
        ? {}
        : { onError: (error: unknown) => defaults.onError?.(endpoint.channel, error) as never }),
      handle:
        defaults.wrap === undefined
          ? handle
          : (input, context, event) =>
              defaults.wrap?.(event, input, async () => handle(input, context, event)) as Promise<
                IpcEndpointHandlerResult<Endpoint>
              >
    })
}
