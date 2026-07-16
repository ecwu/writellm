import type { MineruUtilityRequest, MineruUtilityResponse } from '../../shared/contracts/mineru'
import type { MineruProviderConfig } from '../../shared/contracts/providers'

export type MineruAllocatedResult = Pick<
  Extract<MineruUtilityResponse, { type: 'allocated' }>,
  'remoteTaskId' | 'uploadUrl' | 'traceId'
>
export type MineruPolledResult = Omit<
  Extract<MineruUtilityResponse, { type: 'polled' }>,
  'type' | 'requestId'
>
export type MineruDownloadedResult = Omit<
  Extract<MineruUtilityResponse, { type: 'downloaded' }>,
  'type' | 'requestId'
>
export type MineruNormalizedResult = Omit<
  Extract<MineruUtilityResponse, { type: 'normalized' }>,
  'type' | 'requestId'
>

export interface MineruGateway {
  allocate(
    config: MineruProviderConfig,
    credential: string,
    input: { parseTaskId: string; fileName: string },
    signal: AbortSignal
  ): Promise<MineruAllocatedResult>
  upload(
    input: { uploadUrl: string; sourcePath: string; expectedBytes: number },
    signal: AbortSignal
  ): Promise<void>
  poll(
    config: MineruProviderConfig,
    credential: string,
    input: { parseTaskId: string; remoteTaskId: string },
    signal: AbortSignal
  ): Promise<MineruPolledResult>
  download(
    input: { downloadUrl: string; destinationPath: string; maxBytes: number },
    signal: AbortSignal
  ): Promise<MineruDownloadedResult>
  normalize(
    input: Omit<MineruRequestForOperation<'normalize'>, 'operation' | 'requestId'>,
    signal: AbortSignal
  ): Promise<MineruNormalizedResult>
}

export type MineruSuccessResponse = Exclude<MineruUtilityResponse, { type: 'error' }>
export type MineruRequestForOperation<T extends MineruUtilityRequest['operation']> = Extract<
  MineruUtilityRequest,
  { operation: T }
>
