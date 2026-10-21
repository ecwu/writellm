import type {
  IpcEndpointDefinition,
  IpcEndpointInput,
  IpcEndpointOutput
} from '../shared/contracts/ipc-endpoints'

export interface IpcRendererInvoker {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
}

/** Parse both sides of a typed endpoint while keeping Electron IPC out of shared contracts. */
export async function invokeIpcEndpoint<Endpoint extends IpcEndpointDefinition>(
  ipc: IpcRendererInvoker,
  endpoint: Endpoint,
  input?: IpcEndpointInput<Endpoint>
): Promise<IpcEndpointOutput<Endpoint>> {
  const parsedInput = endpoint.input.parse(input) as IpcEndpointInput<Endpoint>
  const rawOutput =
    parsedInput === undefined
      ? await ipc.invoke(endpoint.channel)
      : await ipc.invoke(endpoint.channel, parsedInput)
  return endpoint.output.parse(rawOutput) as IpcEndpointOutput<Endpoint>
}
