import type { SourceEvent } from '../../shared/sources.js';

export class SourceEvents {
  private sequence = 0;
  private replay: SourceEvent[] = [];
  private listeners = new Set<(event: SourceEvent) => void>();
  private sessionKey: string | null = null;
  private catalogRevision = 0;
  constructor(private capacity = 256) {}

  activate(sessionKey: string, catalogRevision = 0): void {
    if (this.sessionKey === sessionKey) {
      this.catalogRevision = Math.max(this.catalogRevision, catalogRevision);
      return;
    }
    this.sessionKey = sessionKey;
    this.catalogRevision = catalogRevision;
    this.sequence = 0;
    this.replay = [];
    this.listeners.clear();
  }

  deactivate(sessionKey?: string): void {
    if (sessionKey && this.sessionKey !== sessionKey) return;
    this.sessionKey = null;
    this.catalogRevision = 0;
    this.sequence = 0;
    this.replay = [];
    this.listeners.clear();
  }

  publish(event: Omit<SourceEvent, 'sequence'>, sessionKey?: string): SourceEvent | null {
    if (sessionKey && this.sessionKey && sessionKey !== this.sessionKey) return null;
    this.catalogRevision = Math.max(this.catalogRevision, event.catalogRevision);
    const envelope = { ...event, sequence: ++this.sequence } as SourceEvent;
    this.replay.push(envelope);
    if (this.replay.length > this.capacity) this.replay.shift();
    for (const listener of this.listeners) listener(envelope);
    return envelope;
  }

  subscribe(
    afterSequence: number,
    listener: (event: SourceEvent) => void,
    sessionKey?: string,
  ): () => void {
    if (sessionKey && this.sessionKey && sessionKey !== this.sessionKey) {
      listener({
        sequence: Math.max(1, this.sequence + 1),
        catalogRevision: this.catalogRevision,
        type: 'resync-required',
      });
      return () => undefined;
    }
    this.listeners.add(listener);
    const oldest = this.replay[0]?.sequence ?? this.sequence + 1;
    if (afterSequence < oldest - 1)
      listener({
        sequence: ++this.sequence,
        catalogRevision: this.catalogRevision,
        type: 'resync-required',
      });
    else for (const event of this.replay) if (event.sequence > afterSequence) listener(event);
    return () => this.listeners.delete(listener);
  }
}
