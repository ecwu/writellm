import { Agent, type AgentEvent, type AgentMessage, type AgentTool } from '@earendil-works/pi-agent-core';
import type { AgentToolResult } from '@earendil-works/pi-agent-core';
import type {
  PiRunEvent,
  PiRunFailureCategory,
  PiRunStatus,
  PiRunSummary,
  PiRunTerminalResult
} from '../../shared/types.js';
import { createId } from '../ids.js';
import { registerActiveWorkspaceWork } from '../workspaceLifecycle.js';
import { type PiModelAdapter } from './modelAdapter.js';
import {
  SourceToolError
} from './sourceService.js';
import {
  WRITE_LLM_TOOL_SAFETY_INSTRUCTIONS,
  WriteLlmToolError,
  type WriteLlmTools
} from './writeLlmTools.js';

const DEFAULT_RUN_TIMEOUT_MS = 120_000;
const MAX_TURNS = 6;
const MAX_EVENT_TEXT_CHARS = 4_000;
const MAX_BUFFERED_ASSISTANT_TEXT_CHARS = 40_000;
const MAX_EVENT_CAUSE_CHARS = 500;
const MAX_PUBLIC_REFS_PER_EVENT = 8;
// Pi can emit one message_update per token. Do not forward the raw stream: an
// assistant message that later calls a tool is an internal working message, not
// a user-facing draft. Buffer it in the privileged process, then project only a
// completed non-tool response in bounded chunks. The UI still receives ordered
// lifecycle and tool progress while the model is working.
const MESSAGE_DELTA_YIELD_INTERVAL = 128;
const TOOL_NAMES = new Set([
  'get_article_context',
  'read_section_snapshot',
  'source',
  'resolve_citation',
  'inspect_citation_coverage',
  'propose_patch'
]);

export type {
  PiRunEvent,
  PiRunFailureCategory,
  PiRunStatus,
  PiRunSummary,
  PiRunTerminalResult
} from '../../shared/types.js';

export class PiRunConflictError extends Error {
  constructor(sectionId: string) {
    super(`A Pi writing run is already active for section ${sectionId}.`);
    this.name = 'PiRunConflictError';
  }
}

export type StartPiRunInput = {
  runId?: string;
  workspacePath: string;
  sectionId: string;
  prompt: string;
  systemPrompt: string;
  adapter: PiModelAdapter;
  tools: WriteLlmTools;
};

type LifecycleRegistration = {
  complete(): void;
};

type ActiveWorkRegistrar = (
  workspacePath: string,
  cancel: (reason: Error) => void
) => LifecycleRegistration;

type AgentFactory = (options: ConstructorParameters<typeof Agent>[0]) => Agent;

export type PiAgentManagerOptions = {
  runTimeoutMs?: number;
  now?: () => string;
  createRunId?: () => string;
  registerActiveWork?: ActiveWorkRegistrar;
  createAgent?: AgentFactory;
};

export type StartedPiRun = {
  runId: string;
  completion: Promise<PiRunTerminalResult>;
};

type ManagedRun = {
  runId: string;
  workspacePath: string;
  sectionId: string;
  startedAt: string;
  agent: Agent;
  turnCount: number;
  sequence: number;
  failure?: PiRunTerminalResult['failure'];
  statusOverride?: Exclude<PiRunStatus, 'running' | 'succeeded' | 'failed'>;
  lifecycle: LifecycleRegistration;
  timeout: ReturnType<typeof setTimeout>;
  unsubscribe: () => void;
  cancellation: Promise<void>;
  resolveCancellation: () => void;
  pendingAssistantText: string[];
  pendingAssistantTextChars: number;
  deltaEventsSinceYield: number;
};

type ToolFailure = NonNullable<PiRunTerminalResult['failure']>;

/**
 * The sole runtime owner for live Pi runs. It deliberately stores only active
 * runs; terminal state is returned to the caller and then discarded.
 */
export class PiAgentManager {
  private readonly runs = new Map<string, ManagedRun>();
  private readonly sectionLocks = new Map<string, string>();
  private readonly listeners = new Set<(event: PiRunEvent) => void>();
  private readonly runTimeoutMs: number;
  private readonly now: () => string;
  private readonly createRunId: () => string;
  private readonly registerActiveWork: ActiveWorkRegistrar;
  private readonly createAgent: AgentFactory;

  constructor(options: PiAgentManagerOptions = {}) {
    this.runTimeoutMs = normalizeRunTimeout(options.runTimeoutMs);
    this.now = options.now ?? (() => new Date().toISOString());
    this.createRunId = options.createRunId ?? (() => createId('pi-run'));
    this.registerActiveWork = options.registerActiveWork ?? registerActiveWorkspaceWork;
    this.createAgent = options.createAgent ?? ((agentOptions) => new Agent(agentOptions));
  }

  subscribe(listener: (event: PiRunEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  listLiveRuns(workspacePath?: string): PiRunSummary[] {
    return [...this.runs.values()]
      .filter((run) => !workspacePath || run.workspacePath === workspacePath)
      .map((run) => ({
        runId: run.runId,
        workspacePath: run.workspacePath,
        sectionId: run.sectionId,
        status: 'running' as const,
        startedAt: run.startedAt,
        turnCount: run.turnCount
      }));
  }

  start(input: StartPiRunInput): StartedPiRun {
    validateStartInput(input);
    const lockKey = toSectionLockKey(input.workspacePath, input.sectionId);
    if (this.sectionLocks.has(lockKey)) {
      throw new PiRunConflictError(input.sectionId);
    }

    const runId = input.runId?.trim() || this.createRunId();
    if (this.runs.has(runId)) {
      throw new Error(`Pi writing run ${runId} is already active.`);
    }
    const startedAt = this.now();
    const wrappedTools = input.tools.tools.map((tool) => wrapTool(tool));
    const agent = this.createAgent({
      initialState: {
        systemPrompt: [input.systemPrompt.trim(), WRITE_LLM_TOOL_SAFETY_INSTRUCTIONS].filter(Boolean).join('\n\n'),
        model: input.adapter.model,
        tools: wrappedTools
      },
      streamFn: input.adapter.streamFn,
      getApiKey: input.adapter.getApiKey,
      toolExecution: 'sequential',
      afterToolCall: async ({ result }) => {
        const failure = readToolFailure(result);
        return failure ? { isError: true } : undefined;
      }
    });

    let run!: ManagedRun;
    const lifecycle = this.registerActiveWork(input.workspacePath, (reason) => {
      this.cancel(runId, reason.message);
    });
    const timeout = setTimeout(() => {
      this.cancel(runId, 'The 120-second Pi run budget was exhausted.', 'timed_out');
    }, this.runTimeoutMs);
    const unsubscribe = agent.subscribe((event) => this.handleAgentEvent(run, event));
    let resolveCancellation!: () => void;
    const cancellation = new Promise<void>((resolve) => {
      resolveCancellation = resolve;
    });
    run = {
      runId,
      workspacePath: input.workspacePath,
      sectionId: input.sectionId,
      startedAt,
      agent,
      turnCount: 0,
      sequence: 0,
      lifecycle,
      timeout,
      unsubscribe,
      cancellation,
      resolveCancellation,
      pendingAssistantText: [],
      pendingAssistantTextChars: 0,
      deltaEventsSinceYield: 0
    };
    this.runs.set(runId, run);
    this.sectionLocks.set(lockKey, runId);
    this.emit(run, {
      origin: 'writellm',
      type: 'run_started',
      data: { sectionId: input.sectionId, maxTurns: MAX_TURNS, runTimeoutMs: this.runTimeoutMs }
    });

    const completion = this.execute(run, input.prompt);
    return { runId, completion };
  }

  cancel(runId: string, cause = 'The Pi writing run was canceled.', status: 'canceled' | 'timed_out' | 'budget_exhausted' = 'canceled'): boolean {
    const run = this.runs.get(runId);
    if (!run) {
      return false;
    }
    run.statusOverride ??= status;
    run.failure ??= {
      category: status === 'timed_out' ? 'run_timeout' : status === 'budget_exhausted' ? 'turn_budget_exhausted' : 'canceled',
      retryable: status !== 'canceled',
      cause: boundedText(cause, MAX_EVENT_CAUSE_CHARS)
    };
    run.agent.abort();
    run.resolveCancellation();
    return true;
  }

  private async execute(run: ManagedRun, prompt: string): Promise<PiRunTerminalResult> {
    try {
      const promptCompletion = run.agent.prompt(prompt);
      await Promise.race([promptCompletion, run.cancellation]);
      const terminal = this.toTerminalResult(run);
      this.discardPendingAssistantText(run);
      this.emit(run, {
        origin: 'writellm',
        type: 'run_terminal',
        data: terminalEventData(terminal)
      });
      return terminal;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      run.failure ??= { category: 'agent_failure', retryable: true, cause: boundedText(message, MAX_EVENT_CAUSE_CHARS) };
      const terminal = this.toTerminalResult(run, 'failed');
      this.discardPendingAssistantText(run);
      this.emit(run, {
        origin: 'writellm',
        type: 'run_terminal',
        data: terminalEventData(terminal)
      });
      return terminal;
    } finally {
      clearTimeout(run.timeout);
      run.unsubscribe();
      run.lifecycle.complete();
      this.runs.delete(run.runId);
      this.sectionLocks.delete(toSectionLockKey(run.workspacePath, run.sectionId));
    }
  }

  private async handleAgentEvent(run: ManagedRun, event: AgentEvent): Promise<void> {
    if (!this.runs.has(run.runId)) {
      return;
    }
    if (event.type === 'turn_start') {
      run.turnCount += 1;
    }
    if (event.type === 'message_start' && event.message.role === 'assistant') {
      this.discardPendingAssistantText(run);
    }
    if (event.type === 'message_end') {
      const stopReason = assistantStopReason(event.message);
      if (stopReason === 'error') {
        run.failure ??= {
          category: 'agent_failure',
          retryable: true,
          cause: boundedText(assistantErrorMessage(event.message) || 'The model request failed.', MAX_EVENT_CAUSE_CHARS)
        };
      } else if (stopReason === 'aborted' && !run.statusOverride) {
        run.statusOverride = 'canceled';
        run.failure ??= {
          category: 'canceled',
          retryable: false,
          cause: 'The Pi writing run was canceled.'
        };
      }
      this.publishCompletedAssistantText(run, event.message);
    }
    if (event.type === 'turn_end' && run.turnCount >= MAX_TURNS && assistantHasToolCalls(event.message) && !run.statusOverride) {
      this.cancel(run.runId, `The ${MAX_TURNS}-turn Pi run budget was exhausted.`, 'budget_exhausted');
    }
    if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
      this.queueAssistantText(run, event.assistantMessageEvent.delta);
      run.deltaEventsSinceYield += 1;
      if (run.deltaEventsSinceYield >= MESSAGE_DELTA_YIELD_INTERVAL) {
        run.deltaEventsSinceYield = 0;
        await yieldToEventLoop();
      }
      return;
    }
    this.emit(run, projectAgentEvent(event));
  }

  private queueAssistantText(run: ManagedRun, delta: string): void {
    const remaining = MAX_BUFFERED_ASSISTANT_TEXT_CHARS - run.pendingAssistantTextChars;
    if (remaining <= 0) {
      return;
    }
    const boundedDelta = delta.slice(0, remaining);
    run.pendingAssistantText.push(boundedDelta);
    run.pendingAssistantTextChars += boundedDelta.length;
  }

  private publishCompletedAssistantText(run: ManagedRun, message: AgentMessage): void {
    const text = run.pendingAssistantText.join('');
    this.discardPendingAssistantText(run);
    if (!isUserFacingAssistantMessage(message) || !text) {
      return;
    }
    for (let offset = 0; offset < text.length; offset += MAX_EVENT_TEXT_CHARS) {
      this.emit(run, {
        origin: 'pi',
        type: 'message_delta',
        data: { role: 'assistant', visibility: 'final', text: text.slice(offset, offset + MAX_EVENT_TEXT_CHARS) }
      });
    }
  }

  private discardPendingAssistantText(run: ManagedRun): void {
    run.pendingAssistantText = [];
    run.pendingAssistantTextChars = 0;
  }

  private toTerminalResult(run: ManagedRun, fallback: Exclude<PiRunStatus, 'running'> = 'succeeded'): PiRunTerminalResult {
    const status = run.statusOverride ?? (run.failure ? 'failed' : fallback);
    return {
      runId: run.runId,
      workspacePath: run.workspacePath,
      sectionId: run.sectionId,
      status,
      startedAt: run.startedAt,
      completedAt: this.now(),
      turnCount: run.turnCount,
      failure: run.failure
    };
  }

  private emit(run: ManagedRun, event: Omit<PiRunEvent, 'runId' | 'sequence' | 'timestamp'>): void {
    const projected: PiRunEvent = {
      runId: run.runId,
      sequence: ++run.sequence,
      timestamp: this.now(),
      ...event
    };
    this.listeners.forEach((listener) => listener(projected));
  }
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function validateStartInput(input: StartPiRunInput): void {
  if (!input.workspacePath.trim() || !input.sectionId.trim()) {
    throw new Error('A workspace and section are required to start a Pi writing run.');
  }
  if (!input.prompt.trim()) {
    throw new Error('Tell the writing agent what to do before starting a run.');
  }
}

function normalizeRunTimeout(value: number | undefined): number {
  if (!Number.isFinite(value) || !value || value <= 0) {
    return DEFAULT_RUN_TIMEOUT_MS;
  }
  return Math.min(Math.trunc(value), DEFAULT_RUN_TIMEOUT_MS);
}

function toSectionLockKey(workspacePath: string, sectionId: string): string {
  return `${workspacePath}\u0000${sectionId}`;
}

function wrapTool(tool: AgentTool): AgentTool {
  return {
    ...tool,
    execute: async (toolCallId, params, signal, onUpdate): Promise<AgentToolResult<any>> => {
      try {
        return await tool.execute(toolCallId, params, signal, onUpdate);
      } catch (caught) {
        const failure = classifyToolFailure(caught);
        return {
          content: [{ type: 'text', text: failure.cause }],
          details: { failure }
        };
      }
    }
  };
}

function classifyToolFailure(caught: unknown): ToolFailure {
  if (caught instanceof SourceToolError) {
    return {
      category: caught.category,
      retryable: caught.retryable,
      cause: boundedText(caught.message, MAX_EVENT_CAUSE_CHARS)
    };
  }
  if (caught instanceof WriteLlmToolError) {
    return {
      category: caught.category,
      retryable: caught.retryable,
      cause: boundedText(caught.message, MAX_EVENT_CAUSE_CHARS)
    };
  }
  return {
    category: 'tool_execution_failed',
    retryable: true,
    cause: boundedText(caught instanceof Error ? caught.message : String(caught), MAX_EVENT_CAUSE_CHARS)
  };
}

function projectAgentEvent(event: AgentEvent): Omit<PiRunEvent, 'runId' | 'sequence' | 'timestamp'> {
  switch (event.type) {
    case 'agent_start':
    case 'agent_end':
    case 'turn_start':
      return { origin: 'pi', type: event.type };
    case 'turn_end':
      return {
        origin: 'pi',
        type: 'turn_end',
        data: { stopReason: assistantStopReason(event.message) }
      };
    case 'message_start':
    case 'message_end':
      return {
        origin: 'pi',
        type: event.type,
        data: projectMessage(event.message)
      };
    case 'message_update':
      return {
        origin: 'pi',
        type: 'message_delta',
        data: event.assistantMessageEvent.type === 'text_delta'
          ? { role: 'assistant', text: boundedText(event.assistantMessageEvent.delta, MAX_EVENT_TEXT_CHARS) }
          : { role: 'assistant' }
      };
    case 'tool_execution_start':
      return {
        origin: 'pi',
        type: 'tool_execution_start',
        data: { toolCallId: event.toolCallId, toolName: safeToolName(event.toolName) }
      };
    case 'tool_execution_end':
      return {
        origin: 'pi',
        type: 'tool_execution_end',
        data: projectToolResult(event.toolCallId, event.toolName, event.result, event.isError)
      };
  }
  return { origin: 'pi', type: 'agent_end' };
}

function projectMessage(message: AgentMessage): Record<string, unknown> {
  if (message.role === 'toolResult') {
    return { role: 'tool' };
  }
  return {
    role: message.role,
    stopReason: message.role === 'assistant' ? message.stopReason : undefined,
    hasToolCalls: message.role === 'assistant' ? assistantHasToolCalls(message) : undefined
  };
}

function projectToolResult(toolCallId: string, toolName: string, result: unknown, isError: boolean): Record<string, unknown> {
  const details = result && typeof result === 'object' && 'details' in result
    ? (result as { details?: unknown }).details
    : undefined;
  const failure = readToolFailure({ details });
  const safeDetails = details && typeof details === 'object' ? details as Record<string, unknown> : {};
  const publicRefs = Array.isArray(safeDetails.publicRefs)
    ? safeDetails.publicRefs.filter((value): value is string => typeof value === 'string').slice(0, MAX_PUBLIC_REFS_PER_EVENT)
    : [];
  const data: Record<string, unknown> = {
    toolCallId,
    toolName: safeToolName(toolName),
    status: isError || failure ? 'error' : 'success'
  };
  if (typeof safeDetails.sourceCount === 'number') {
    data.sourceCount = Math.max(0, Math.min(8, Math.trunc(safeDetails.sourceCount)));
  }
  if (publicRefs.length > 0) {
    data.publicRefs = publicRefs;
  }
  if (typeof safeDetails.proposalId === 'string') {
    data.proposalId = boundedText(safeDetails.proposalId, 160);
  }
  if (failure) {
    data.failure = failure;
  } else if (isError) {
    data.failure = { category: 'tool_execution_failed', retryable: false, cause: 'The tool request was rejected.' };
  }
  return data;
}

function readToolFailure(result: { details?: unknown }): ToolFailure | null {
  const details = result.details;
  if (!details || typeof details !== 'object' || !('failure' in details)) {
    return null;
  }
  const failure = (details as { failure?: unknown }).failure;
  if (!failure || typeof failure !== 'object') {
    return null;
  }
  const candidate = failure as Partial<ToolFailure>;
  if (typeof candidate.category !== 'string' || typeof candidate.retryable !== 'boolean' || typeof candidate.cause !== 'string') {
    return null;
  }
  return {
    category: candidate.category as PiRunFailureCategory,
    retryable: candidate.retryable,
    cause: boundedText(candidate.cause, MAX_EVENT_CAUSE_CHARS)
  };
}

function terminalEventData(result: PiRunTerminalResult): Record<string, unknown> {
  return {
    status: result.status,
    turnCount: result.turnCount,
    failure: result.failure
  };
}

function assistantStopReason(message: unknown): string | undefined {
  return message && typeof message === 'object' && 'role' in message && (message as { role?: unknown }).role === 'assistant' && 'stopReason' in message
    ? String((message as { stopReason?: unknown }).stopReason)
    : undefined;
}

function assistantErrorMessage(message: unknown): string | undefined {
  return message && typeof message === 'object' && 'role' in message && (message as { role?: unknown }).role === 'assistant' && 'errorMessage' in message
    ? typeof (message as { errorMessage?: unknown }).errorMessage === 'string'
      ? (message as { errorMessage: string }).errorMessage
      : undefined
    : undefined;
}

function assistantHasToolCalls(message: unknown): boolean {
  return message && typeof message === 'object' && 'role' in message && (message as { role?: unknown }).role === 'assistant' && 'content' in message && Array.isArray((message as { content?: unknown }).content)
    ? (message as { content: Array<{ type?: unknown }> }).content.some((part) => part?.type === 'toolCall')
    : false;
}

function isUserFacingAssistantMessage(message: AgentMessage): boolean {
  const stopReason = assistantStopReason(message);
  return message.role === 'assistant'
    && !assistantHasToolCalls(message)
    && stopReason !== 'error'
    && stopReason !== 'aborted';
}

function safeToolName(value: string): string {
  return TOOL_NAMES.has(value) ? value : 'unrecognized_tool';
}

function boundedText(value: string, maximum: number): string {
  const normalized = value.trim();
  return normalized.length > maximum ? `${normalized.slice(0, maximum - 1).trimEnd()}…` : normalized;
}
