import { describe, expect, test } from 'bun:test';
import {
  activeWorkspaceWorkCount,
  cancelAndDrainWorkspaceWork,
  registerActiveWorkspaceWork
} from '../../src/main/workspaceLifecycle.js';

describe('active workspace lifecycle registry', () => {
  test('cancels and drains only work belonging to the switched workspace', async () => {
    const canceled: string[] = [];
    const first = registerActiveWorkspaceWork('/tmp/first.writellm', (reason) => {
      canceled.push(reason.message);
      first.complete();
    });
    const second = registerActiveWorkspaceWork('/tmp/second.writellm', () => {
      second.complete();
    });

    expect(activeWorkspaceWorkCount()).toBe(2);
    await cancelAndDrainWorkspaceWork('workspace switched', '/tmp/first.writellm');
    expect(canceled).toEqual(['workspace switched']);
    expect(activeWorkspaceWorkCount('/tmp/first.writellm')).toBe(0);
    expect(activeWorkspaceWorkCount('/tmp/second.writellm')).toBe(1);

    second.complete();
    expect(activeWorkspaceWorkCount()).toBe(0);
  });

  test('waits for a cancellation path to finish terminalization', async () => {
    let complete!: () => void;
    const work = registerActiveWorkspaceWork('/tmp/project.writellm', () => {
      setTimeout(() => complete(), 5);
    });
    complete = work.complete;

    const drain = cancelAndDrainWorkspaceWork('application shutdown');
    expect(activeWorkspaceWorkCount()).toBe(1);
    await drain;
    expect(activeWorkspaceWorkCount()).toBe(0);
  });
});
