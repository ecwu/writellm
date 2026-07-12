import type { IpcMain } from 'electron';
import { type ChapterResult, chapterChannels } from '../../shared/chapters.js';
import type { ChapterRepository } from './chapter-repository.js';
import {
  ChapterValidationError,
  parseExportInput,
  parseLoadInput,
  parsePreviewInput,
} from './chapter-validation.js';
import type { MarkdownExportService } from './markdown-export.js';
import type { ProjectRepository } from './project-repository.js';

export function registerChapterHandlers(options: {
  ipcMain: IpcMain;
  projects: ProjectRepository;
  repository: ChapterRepository;
  markdown: MarkdownExportService;
  isExpectedSender(event: Electron.IpcMainInvokeEvent): boolean;
}) {
  const unavailable = (): ChapterResult<never> => ({
    ok: false,
    error: {
      code: 'NO_ACTIVE_PROJECT',
      message: 'Open a project before editing a chapter.',
      retryable: false,
    },
  });
  const withSession = <T>(
    event: Electron.IpcMainInvokeEvent,
    run: (
      session: NonNullable<ReturnType<ProjectRepository['getActiveProjectSession']>>,
    ) => Promise<ChapterResult<T>> | ChapterResult<T>,
  ) => {
    if (!options.isExpectedSender(event)) return unavailable();
    const session = options.projects.getActiveProjectSession();
    return session ? run(session) : unavailable();
  };
  const invalid = (error: unknown): ChapterResult<never> => ({
    ok: false,
    error:
      error instanceof ChapterValidationError
        ? error.detail
        : { code: 'INVALID_INPUT', message: 'The chapter request is invalid.', retryable: false },
  });
  options.ipcMain.handle(chapterChannels.openForOutlineItem, (event, input: unknown) =>
    withSession(event, (session) => options.repository.openForOutlineItem(session, input)),
  );
  options.ipcMain.handle(chapterChannels.load, (event, input: unknown) =>
    withSession(event, (session) => {
      try {
        return options.repository.load(session, parseLoadInput(input).chapterId);
      } catch (error) {
        return invalid(error);
      }
    }),
  );
  options.ipcMain.handle(chapterChannels.save, (event, input: unknown) =>
    withSession(event, (session) => options.repository.save(session, input)),
  );
  options.ipcMain.handle(chapterChannels.previewMarkdownExport, (event, input: unknown) =>
    withSession(event, (session) => {
      try {
        const parsed = parsePreviewInput(input);
        return {
          ok: true,
          value: options.markdown.preview(
            session,
            parsed.chapterId,
            parsed.blocks,
            parsed.citations,
          ),
        };
      } catch (error) {
        return invalid(error);
      }
    }),
  );
  options.ipcMain.handle(chapterChannels.exportMarkdown, (event, input: unknown) =>
    withSession(event, (session) => {
      try {
        const parsed = parseExportInput(input);
        return options.markdown.export(session, parsed.chapterId, parsed.previewId);
      } catch (error) {
        return invalid(error);
      }
    }),
  );
}
