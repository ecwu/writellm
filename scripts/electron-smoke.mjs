import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import { PaperLabDatabase } from '../dist-electron/main/database.js';
import { exportLatex } from '../dist-electron/main/exportLatex.js';

const workspacePath = mkdtempSync(path.join(os.tmpdir(), 'paperlab-smoke-'));

try {
  const db = new PaperLabDatabase(workspacePath);
  db.createContainer(db.rootContainerId, 'Intro', '');
  const child = db.listContainers().find((container) => container.parentId === db.rootContainerId);
  if (!child) {
    throw new Error('Child container was not created.');
  }
  db.createAuthorText(child.id, '\\section{Intro}\nHello world.');
  const text = db.listAuthorTexts()[0];
  if (!text) {
    throw new Error('AuthorText was not created.');
  }
  db.setActiveAuthorText(child.id, text.artifactId);
  const exportPath = exportLatex(db, db.rootContainerId);
  const output = readFileSync(exportPath, 'utf8');
  if (!output.includes('\\section{Intro}') || !output.includes('Hello world.')) {
    throw new Error('Exported LaTeX did not include active AuthorText.');
  }

  db.updateContainer(child.id, { title: 'Renamed intro', intent: 'State the problem.' });
  const renamed = db.listContainers().find((container) => container.id === child.id);
  if (renamed?.title !== 'Renamed intro' || renamed.intent !== 'State the problem.') {
    throw new Error('Container rename did not persist.');
  }

  db.deleteArtifact(text.artifactId);
  const afterArtifactDelete = db.listContainers().find((container) => container.id === child.id);
  if (afterArtifactDelete?.activeAuthorTextId !== null) {
    throw new Error('Deleting active AuthorText did not clear active pointer.');
  }

  db.deleteContainer(child.id);
  if (db.listContainers().some((container) => container.id === child.id)) {
    throw new Error('Deleted container is still listed.');
  }

  db.createContainer(db.rootContainerId, 'First', '');
  db.createContainer(db.rootContainerId, 'Second', '');
  const orderedChildren = db
    .listContainers()
    .filter((container) => container.parentId === db.rootContainerId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const first = orderedChildren.find((container) => container.title === 'First');
  const second = orderedChildren.find((container) => container.title === 'Second');
  if (!first || !second) {
    throw new Error('Ordering smoke containers were not created.');
  }
  db.createAuthorText(first.id, 'FIRST');
  db.createAuthorText(second.id, 'SECOND');
  const firstText = db.listAuthorTexts().find((text) => text.containerId === first.id);
  const secondText = db.listAuthorTexts().find((text) => text.containerId === second.id);
  if (!firstText || !secondText) {
    throw new Error('Ordering smoke AuthorText records were not created.');
  }
  db.setActiveAuthorText(first.id, firstText.artifactId);
  db.setActiveAuthorText(second.id, secondText.artifactId);
  db.moveContainer(second.id, db.rootContainerId, 0);
  const reorderedPath = exportLatex(db, db.rootContainerId);
  const reorderedOutput = readFileSync(reorderedPath, 'utf8');
  if (reorderedOutput.indexOf('SECOND') > reorderedOutput.indexOf('FIRST')) {
    throw new Error('moveContainer did not update export order.');
  }

  db.close();
  console.log('electron-smoke ok');
} finally {
  rmSync(workspacePath, { recursive: true, force: true });
  app.quit();
}
