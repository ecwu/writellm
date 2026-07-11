import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createGitCheckpoint,
  ensureGitSession,
  getGitDiff,
  getGitStatus,
  getSectionVersion,
  listGitHistory
} from '../../src/main/gitSession.js';

describe('Git-backed workspace history', () => {
  test('creates session history, limits tracked changes, and retrieves prior versions', () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), 'writellm-git-test-'));
    try {
      mkdirSync(path.join(workspace, 'sections'), { recursive: true });
      writeFileSync(path.join(workspace, 'sections', 'intro.md'), 'First draft\n', 'utf8');
      writeFileSync(path.join(workspace, '.writellm-manifest.json'), '{}\n', 'utf8');

      ensureGitSession(workspace);
      const initial = listGitHistory(workspace, 'intro');
      expect(initial).toHaveLength(1);
      expect(initial[0].subject).toBe('Initial workspace');
      expect(getGitStatus(workspace)).toMatchObject({ branch: expect.stringMatching(/^session\//), dirty: false });

      writeFileSync(path.join(workspace, 'sections', 'intro.md'), 'Second draft\n', 'utf8');
      writeFileSync(path.join(workspace, 'untracked.txt'), 'not versioned', 'utf8');
      expect(getGitStatus(workspace)).toMatchObject({
        dirty: true,
        entries: [{ path: 'sections/intro.md', status: 'M' }]
      });

      const checkpoint = createGitCheckpoint(workspace, 'Revise introduction');
      expect(checkpoint?.subject).toBe('Revise introduction');
      expect(createGitCheckpoint(workspace, 'No-op')).toBeNull();

      const history = listGitHistory(workspace, 'intro');
      expect(history.map((entry) => entry.subject)).toEqual(['Revise introduction', 'Initial workspace']);
      expect(getSectionVersion(workspace, 'intro', history[1].hash)).toBe('First draft\n');
      expect(getGitDiff(workspace, { sectionId: 'intro', base: history[1].hash, head: history[0].hash })).toContain('+Second draft');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  test('rejects invalid section ids and commit hashes before executing Git', () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), 'writellm-git-test-'));
    try {
      expect(() => getSectionVersion(workspace, '../outside', 'deadbeef')).toThrow('Section id is invalid');
      expect(() => getSectionVersion(workspace, 'intro', 'not a hash')).toThrow('Git commit hash is invalid');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
