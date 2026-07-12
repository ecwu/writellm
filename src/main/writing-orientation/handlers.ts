import type { IpcMain } from 'electron';
import { type OrientationResult, orientationChannels } from '../../shared/writing-orientation.js';
import type { ProjectRepository } from '../project/project-repository.js';
import { OrientationValidationError, parseDeleteInput } from './parser.js';
import type { WritingOrientationRepository } from './repository.js';

export function registerWritingOrientationHandlers(options: {
  ipcMain: IpcMain;
  projects: ProjectRepository;
  repository: WritingOrientationRepository;
  isExpectedSender(event: Electron.IpcMainInvokeEvent): boolean;
}) {
  const noProject = (): OrientationResult<never> => ({
    ok: false,
    error: {
      code: 'NO_ACTIVE_PROJECT',
      message: 'Open a project before editing writing orientation.',
      retryable: false,
    },
  });
  options.ipcMain.handle(orientationChannels.load, (event) => {
    if (!options.isExpectedSender(event)) return noProject();
    const session = options.projects.getActiveProjectSession();
    return session ? options.repository.load(session) : noProject();
  });
  options.ipcMain.handle(orientationChannels.save, (event, input: unknown) => {
    if (!options.isExpectedSender(event)) return noProject();
    const session = options.projects.getActiveProjectSession();
    return session ? options.repository.save(session, input) : noProject();
  });
  options.ipcMain.handle(orientationChannels.deleteOutlineItem, (event, input: unknown) => {
    if (!options.isExpectedSender(event)) return noProject();
    const session = options.projects.getActiveProjectSession();
    if (!session) return noProject();
    try {
      return options.repository.deleteOutlineItem(session, parseDeleteInput(input));
    } catch (error) {
      const detail =
        error instanceof OrientationValidationError
          ? error.detail
          : {
              code: 'INVALID_INPUT' as const,
              message: 'Delete request is invalid.',
              retryable: false,
            };
      return { ok: false, error: detail };
    }
  });
}
