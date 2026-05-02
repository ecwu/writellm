import { ipcMain } from 'electron';
import { ipcChannels } from '../shared/ipc.js';
import type {
  CreateArtifactPayload,
  CreateContainerPayload,
  CreateReviewCommentPayload,
  EdgeKind,
  GenerateLlmPayload,
  SaveLlmGenerationPayload,
  TextRange
} from '../shared/types.js';
import { exportLatex } from './exportLatex.js';
import { streamLlmText } from './llmRunner.js';
import { readLlmSettings, readPublicLlmSettings, updateLlmSettings } from './llmSettings.js';
import { createWorkspace, getActiveDb, getState, openWorkspace } from './workspace.js';

const llmRuns = new Map<string, AbortController>();

export function registerIpcHandlers(): void {
  ipcMain.handle(ipcChannels.createWorkspace, (_event, workspacePath: string) =>
    createWorkspace(workspacePath)
  );

  ipcMain.handle(ipcChannels.openWorkspace, (_event, workspacePath: string) =>
    openWorkspace(workspacePath)
  );

  ipcMain.handle(ipcChannels.getState, (_event, focusContainerId?: string) =>
    getState(focusContainerId)
  );

  ipcMain.handle(
    ipcChannels.createContainer,
    (_event, parentId: string | null, payload: CreateContainerPayload) => {
      getActiveDb().createContainer(parentId, payload.title, payload.intent);
      return getState(parentId ?? undefined);
    }
  );

  ipcMain.handle(
    ipcChannels.updateContainer,
    (_event, containerId: string, payload: Partial<CreateContainerPayload>) => {
      getActiveDb().updateContainer(containerId, payload);
      return getState(containerId);
    }
  );

  ipcMain.handle(ipcChannels.deleteContainer, (_event, containerId: string) => {
    const db = getActiveDb();
    const nextFocusId = db.getContainerParentId(containerId) ?? db.rootContainerId;
    db.deleteContainer(containerId);
    return getState(nextFocusId);
  });

  ipcMain.handle(
    ipcChannels.moveContainer,
    (_event, containerId: string, newParentId: string | null, index: number) => {
      getActiveDb().moveContainer(containerId, newParentId, index);
      return getState(newParentId ?? undefined);
    }
  );

  ipcMain.handle(
    ipcChannels.createSourceNote,
    (_event, containerId: string, payload: CreateArtifactPayload) => {
      getActiveDb().createSourceNote(containerId, payload.title, payload.content);
      return getState(containerId);
    }
  );

  ipcMain.handle(
    ipcChannels.createAuthorText,
    (_event, containerId: string, content: string, createdFromArtifactId?: string) => {
      getActiveDb().createAuthorText(containerId, content, createdFromArtifactId);
      return getState(containerId);
    }
  );

  ipcMain.handle(ipcChannels.deleteArtifact, (_event, artifactId: string) => {
    getActiveDb().deleteArtifact(artifactId);
    return getState();
  });

  ipcMain.handle(
    ipcChannels.updateArtifactContent,
    (_event, artifactId: string, content: string) => {
      getActiveDb().updateArtifactContent(artifactId, content);
      return getState();
    }
  );

  ipcMain.handle(
    ipcChannels.updateAuthorTextContent,
    (_event, authorTextId: string, content: string) => {
      getActiveDb().updateAuthorTextContent(authorTextId, content);
      return getState();
    }
  );

  ipcMain.handle(
    ipcChannels.setActiveAuthorText,
    (_event, containerId: string, authorTextId: string) => {
      getActiveDb().setActiveAuthorText(containerId, authorTextId);
      return getState(containerId);
    }
  );

  ipcMain.handle(
    ipcChannels.createReviewComment,
    (
      _event,
      authorTextId: string,
      range: TextRange,
      payload: CreateReviewCommentPayload
    ) => {
      getActiveDb().createReviewComment(authorTextId, range, payload);
      return getState();
    }
  );

  ipcMain.handle(
    ipcChannels.updateReviewCommentStatus,
    (_event, commentId: string, status: 'open' | 'addressed' | 'wont_fix') => {
      getActiveDb().updateReviewCommentStatus(commentId, status);
      return getState();
    }
  );

  ipcMain.handle(
    ipcChannels.createProcessEdge,
    (_event, fromArtifactId: string, toArtifactId: string, relationType: EdgeKind) =>
      getActiveDb().createProcessEdge(fromArtifactId, toArtifactId, relationType)
  );

  ipcMain.handle(
    ipcChannels.updateProcessEdge,
    (_event, edgeId: string, relationType: EdgeKind) => {
      getActiveDb().updateProcessEdge(edgeId, relationType);
      return getState();
    }
  );

  ipcMain.handle(ipcChannels.exportLatex, (_event, rootContainerId: string) => ({
    path: exportLatex(getActiveDb(), rootContainerId)
  }));

  ipcMain.handle(ipcChannels.getLlmSettings, () => readPublicLlmSettings());

  ipcMain.handle(ipcChannels.updateLlmSettings, (_event, payload) =>
    updateLlmSettings(payload)
  );

  ipcMain.handle(ipcChannels.generateWithLlm, async (event, payload: GenerateLlmPayload) => {
    const settings = readLlmSettings();
    const controller = new AbortController();
    llmRuns.set(payload.runId, controller);

    event.sender.send(ipcChannels.llmStream, {
      type: 'started',
      runId: payload.runId,
      containerId: payload.containerId
    });

    let content = '';
    try {
      for await (const chunk of streamLlmText(settings, payload, controller.signal)) {
        content += chunk;
        event.sender.send(ipcChannels.llmStream, {
          type: 'chunk',
          runId: payload.runId,
          content
        });
      }
      event.sender.send(ipcChannels.llmStream, {
        type: 'done',
        runId: payload.runId,
        content
      });
      return { runId: payload.runId, content, canceled: false };
    } catch (caught) {
      if (controller.signal.aborted) {
        event.sender.send(ipcChannels.llmStream, {
          type: 'canceled',
          runId: payload.runId
        });
        return { runId: payload.runId, content, canceled: true };
      }

      const rawMessage = caught instanceof Error ? caught.message : String(caught);
      const message = /timeout|timed out/i.test(rawMessage)
        ? 'LLM request timed out after 45 seconds. Check the URL, model name, API key, and network access.'
        : rawMessage;
      event.sender.send(ipcChannels.llmStream, {
        type: 'error',
        runId: payload.runId,
        message
      });
      throw new Error(message);
    } finally {
      llmRuns.delete(payload.runId);
    }
  });

  ipcMain.handle(ipcChannels.cancelLlmGeneration, (_event, runId: string) => {
    llmRuns.get(runId)?.abort();
  });

  ipcMain.handle(ipcChannels.saveLlmGeneration, (_event, payload: SaveLlmGenerationPayload) => {
    const settings = readLlmSettings();
    const db = getActiveDb();
    db.createGenerationCandidate(payload.containerId, 'LLM generation', payload.content, {
      provider: settings.provider,
      baseURL: settings.baseURL,
      model: settings.model,
      prompt: payload.prompt
    });
    return getState(payload.containerId);
  });
}
