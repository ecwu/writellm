import type { SourceEvent } from '../../shared/sources.js';

export class SourceEvents {
  private sequence = 0;
  private replay: SourceEvent[] = [];
  private listeners = new Set<(event: SourceEvent) => void>();
  constructor(private capacity = 256) {}

  publish(event: Omit<SourceEvent, 'sequence'>): SourceEvent {
    const envelope = { ...event, sequence: ++this.sequence } as SourceEvent;
    this.replay.push(envelope);
    if (this.replay.length > this.capacity) this.replay.shift();
    for (const listener of this.listeners) listener(envelope);
    return envelope;
  }

  subscribe(afterSequence: number, listener: (event: SourceEvent) => void): () => void {
    this.listeners.add(listener);
    const oldest = this.replay[0]?.sequence ?? this.sequence + 1;
    if (afterSequence < oldest - 1)
      listener({
        sequence: ++this.sequence,
        catalogRevision: this.replay.at(-1)?.catalogRevision ?? 0,
        type: 'resync-required',
      });
    else for (const event of this.replay) if (event.sequence > afterSequence) listener(event);
    return () => this.listeners.delete(listener);
  }
}
