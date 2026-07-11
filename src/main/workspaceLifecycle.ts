type ActiveWorkspaceWork = {
  workspacePath: string;
  cancel: (reason: Error) => void;
  resolve: () => void;
  completion: Promise<void>;
};

const activeWork = new Set<ActiveWorkspaceWork>();
let nextWorkId = 0;

export function registerActiveWorkspaceWork(
  workspacePath: string,
  cancel: (reason: Error) => void
): { id: string; complete: () => void } {
  let resolve!: () => void;
  const completion = new Promise<void>((done) => {
    resolve = done;
  });
  const work: ActiveWorkspaceWork = { workspacePath, cancel, resolve, completion };
  activeWork.add(work);
  let completed = false;
  return {
    id: `workspace-work-${nextWorkId++}`,
    complete: () => {
      if (completed) {
        return;
      }
      completed = true;
      activeWork.delete(work);
      work.resolve();
    }
  };
}

export async function cancelAndDrainWorkspaceWork(reason: string, workspacePath?: string): Promise<void> {
  const selected = [...activeWork].filter((work) => !workspacePath || work.workspacePath === workspacePath);
  const error = new Error(reason);
  selected.forEach((work) => work.cancel(error));
  await Promise.all(selected.map((work) => work.completion));
}

export function activeWorkspaceWorkCount(workspacePath?: string): number {
  return [...activeWork].filter((work) => !workspacePath || work.workspacePath === workspacePath).length;
}
