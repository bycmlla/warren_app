export type PendingProgress = {
  lessonId: number;
  videoId: number | null;
  seconds: number;
  finished?: boolean;
  duration?: number;
  completionSeconds?: number;
  mediaVersion?: string;
  updatedAt: number;
};

export const progressKey = (entry: PendingProgress) => `${entry.lessonId}.${entry.videoId ?? 'aula'}`;
export function decodePendingProgress(value: string | null): PendingProgress[] {
  try {
    const entries = JSON.parse(value ?? '[]');
    return Array.isArray(entries) ? entries.filter((entry) => entry && Number.isInteger(entry.lessonId) && entry.lessonId > 0 &&
      (entry.videoId === null || (Number.isInteger(entry.videoId) && entry.videoId > 0)) &&
      Number.isFinite(entry.seconds) && entry.seconds >= 0 && entry.seconds <= 86400 && Number.isFinite(entry.updatedAt)) : [];
  } catch { return []; }
}
type ProgressStorage = {
  read: () => Promise<PendingProgress[]>;
  write: (entries: PendingProgress[]) => Promise<void>;
};

/** Fila persistente: substitui checkpoints antigos e envia na ordem em que foram assistidos. */
export class ProgressQueue<Result> {
  private pending = new Map<string, PendingProgress>();
  private ready: Promise<void>;
  private writing: Promise<void> = Promise.resolve();
  private sending?: Promise<Map<string, Result>>;
  private failures = new Map<string, unknown>();
  private storage: ProgressStorage;

  constructor(storage: ProgressStorage) {
    this.storage = storage;
    this.ready = storage.read().then((entries) => {
      for (const entry of entries) this.pending.set(progressKey(entry), entry);
    });
  }

  private persist() {
    const snapshot = [...this.pending.values()];
    const write = this.writing.catch(() => undefined).then(() => this.storage.write(snapshot));
    this.writing = write;
    return write;
  }

  async put(entry: PendingProgress) {
    await this.ready;
    const key = progressKey(entry);
    const existing = this.pending.get(key);
    const previous = existing?.mediaVersion && entry.mediaVersion && existing.mediaVersion !== entry.mediaVersion ? undefined : existing;
    this.pending.set(key, { ...entry, finished: Boolean(entry.finished || previous?.finished),
      duration: entry.duration ?? previous?.duration,
      completionSeconds: entry.finished ? entry.seconds : previous?.completionSeconds });
    await this.persist();
  }

  async entries() {
    await this.ready;
    return [...this.pending.values()];
  }

  errorFor(key: string) { return this.failures.get(key); }

  async flush(send: (entry: PendingProgress) => Promise<Result>, discard?: (error: unknown) => boolean) {
    await this.ready;
    if (this.sending) return this.sending;
    this.sending = (async () => {
      const results = new Map<string, Result>();
      const attempted = new Set<PendingProgress>();
      this.failures.clear();
      while (true) {
        const entry = [...this.pending.values()].filter((item) => !attempted.has(item))
          .sort((a, b) => a.updatedAt - b.updatedAt)[0];
        if (!entry) break;
        attempted.add(entry);
        const key = progressKey(entry);
        try {
          const result = await send(entry);
          results.set(key, result);
          this.failures.delete(key);
        } catch (error) {
          if (!discard?.(error)) { this.failures.set(key, error); continue; }
        }
        // Um checkpoint criado enquanto o anterior era enviado ainda precisa ser gravado.
        if (this.pending.get(key) === entry) this.pending.delete(key);
        // Uma falha no armazenamento local não desfaz um progresso confirmado pelo servidor.
        await this.persist().catch(() => undefined);
      }
      if (results.size === 0 && this.failures.size > 0) throw this.failures.values().next().value;
      return results;
    })();
    try { return await this.sending; }
    finally { this.sending = undefined; }
  }
}
