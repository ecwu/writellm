import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import { PaperLabDatabase } from '../dist-electron/main/database.js';
import { exportLatex } from '../dist-electron/main/exportLatex.js';

const workspacePath = mkdtempSync(path.join(os.tmpdir(), 'paperlab-smoke-'));

try {
  const db = new PaperLabDatabase(workspacePath);
  const rootId = db.rootNodeId;
  const intro = db.createNode({
    kind: 'section',
    parentId: rootId,
    title: 'Intro',
    intent: ''
  });
  if (intro.kind !== 'section') {
    throw new Error('Child section was not created.');
  }

  const main = db.createNode({
    kind: 'content',
    parentId: intro.id,
    title: 'Main draft',
    content: '\\section{Intro}\nHello world.',
    isMain: true
  });
  const source = db.createNode({
    kind: 'content',
    parentId: intro.id,
    title: 'Source note',
    content: 'Background source.',
    isArtifact: true
  });
  if (main.kind !== 'content' || source.kind !== 'content') {
    throw new Error('Content nodes were not created.');
  }

  db.setActiveMainNode(intro.id, main.id);
  const exportPath = exportLatex(db, rootId);
  const output = readFileSync(exportPath, 'utf8');
  if (!output.includes('\\section{Intro}') || !output.includes('Hello world.')) {
    throw new Error('Exported LaTeX did not include active main content.');
  }

  db.createNodeEdge(source.id, main.id, 'informs');
  if (db.listEdges().length !== 1) {
    throw new Error('Content edge was not created.');
  }

  db.updateNodeLayout({
    canvasSectionId: intro.id,
    nodeId: main.id,
    x: 10,
    y: 20,
    width: 240,
    height: 160
  });
  if (db.listCanvasNodeLayouts(intro.id).length !== 1) {
    throw new Error('Canvas layout was not saved.');
  }

  db.updateNode(intro.id, { title: 'Renamed intro', intent: 'State the problem.' });
  const renamed = db.getSection(intro.id);
  if (renamed?.title !== 'Renamed intro' || renamed.intent !== 'State the problem.') {
    throw new Error('Section update did not persist.');
  }

  db.deleteNode(source.id);
  if (db.listEdges().length !== 0) {
    throw new Error('Deleting content did not clean up edges.');
  }

  db.deleteNode(main.id);
  const afterMainDelete = db.getSection(intro.id);
  if (afterMainDelete?.activeMainNodeId !== null) {
    throw new Error('Deleting active main content did not clear active pointer.');
  }
  if (db.listCanvasNodeLayouts(intro.id).length !== 0) {
    throw new Error('Deleting content did not clean up layouts.');
  }

  db.deleteNode(intro.id);
  if (db.getNode(intro.id)) {
    throw new Error('Deleted section is still listed.');
  }

  const first = db.createNode({ kind: 'section', parentId: rootId, title: 'First', intent: '' });
  const second = db.createNode({ kind: 'section', parentId: rootId, title: 'Second', intent: '' });
  if (first.kind !== 'section' || second.kind !== 'section') {
    throw new Error('Ordering smoke sections were not created.');
  }
  const firstText = db.createNode({
    kind: 'content',
    parentId: first.id,
    title: 'First main',
    content: 'FIRST',
    isMain: true
  });
  const secondText = db.createNode({
    kind: 'content',
    parentId: second.id,
    title: 'Second main',
    content: 'SECOND',
    isMain: true
  });
  if (firstText.kind !== 'content' || secondText.kind !== 'content') {
    throw new Error('Ordering smoke content records were not created.');
  }
  db.setActiveMainNode(first.id, firstText.id);
  db.setActiveMainNode(second.id, secondText.id);
  db.moveNode(second.id, rootId, 0);
  const reorderedPath = exportLatex(db, rootId);
  const reorderedOutput = readFileSync(reorderedPath, 'utf8');
  if (reorderedOutput.indexOf('SECOND') > reorderedOutput.indexOf('FIRST')) {
    throw new Error('moveNode did not update export order.');
  }

  db.close();
  console.log('electron-smoke ok');
} finally {
  rmSync(workspacePath, { recursive: true, force: true });
  app.quit();
}
