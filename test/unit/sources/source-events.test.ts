import { expect, test } from 'bun:test';
import { SourceEvents } from '../../../src/main/sources/source-events';

test('sequences, replays, bounds and requests resync after overflow', () => {
  const events = new SourceEvents(2);
  events.publish({
    catalogRevision: 1,
    type: 'candidate-updated',
    candidateId: '1',
    candidateStatus: 'queued',
  });
  events.publish({
    catalogRevision: 1,
    type: 'candidate-updated',
    candidateId: '2',
    candidateStatus: 'queued',
  });
  events.publish({
    catalogRevision: 1,
    type: 'candidate-updated',
    candidateId: '3',
    candidateStatus: 'queued',
  });
  const replay: string[] = [];
  const unsubscribe = events.subscribe(0, (event) => replay.push(event.type));
  expect(replay).toEqual(['resync-required']);
  unsubscribe();
  const current: number[] = [];
  events.subscribe(3, (event) => current.push(event.sequence));
  events.publish({ catalogRevision: 2, type: 'source-removed' });
  expect(current).toEqual([5]);
});
