import { saveLessonProgress, saveVideoProgress, type ProgressResult, type VideoProgressResult } from '@/services/catalog-api';
import { ApiError } from '@/services/auth-api';
import { readPendingProgress, writePendingProgress } from '@/services/progress-store';
import { ProgressQueue, progressKey, type PendingProgress } from '@/utils/progress-queue';

type Result = ProgressResult | VideoProgressResult;
const queues = new Map<number, ProgressQueue<Result>>();

const queueFor = (userId: number) => {
  let queue = queues.get(userId);
  if (!queue) {
    queue = new ProgressQueue<Result>({
      read: () => readPendingProgress(userId),
      write: (entries) => writePendingProgress(userId, entries),
    });
    queues.set(userId, queue);
  }
  return queue;
};

async function send(token: string, entry: PendingProgress): Promise<Result> {
  if (entry.videoId === null) return saveLessonProgress(token, entry.lessonId, { posicaoSegundos: entry.seconds, finalizada: entry.finished });
  if (entry.finished && entry.completionSeconds !== undefined && entry.seconds !== entry.completionSeconds) {
    await saveVideoProgress(token, entry.lessonId, entry.videoId, {
      posicaoSegundos: entry.completionSeconds, finalizado: true, duracaoSegundos: entry.duration, versaoMidia: entry.mediaVersion,
    });
    return saveVideoProgress(token, entry.lessonId, entry.videoId, { posicaoSegundos: entry.seconds, versaoMidia: entry.mediaVersion });
  }
  return saveVideoProgress(token, entry.lessonId, entry.videoId, {
    posicaoSegundos: entry.seconds, finalizado: entry.finished, duracaoSegundos: entry.duration, versaoMidia: entry.mediaVersion,
  });
}

const obsolete = (error: unknown) => error instanceof ApiError &&
  (error.status === 404 || (error.status === 409 && error.data.codigo === 'VIDEO_SUBSTITUIDO'));
export const syncProgress = (userId: number, token: string) => queueFor(userId).flush((entry) => send(token, entry), obsolete);

export async function persistProgress(userId: number, token: string, entry: PendingProgress) {
  const queue = queueFor(userId);
  let localFailure = false;
  await queue.put(entry).catch(() => { localFailure = true; });
  try {
    const results = await queue.flush((pending) => send(token, pending), obsolete);
    const key = progressKey(entry);
    if (queue.errorFor(key)) throw queue.errorFor(key);
    return results.get(key);
  } catch (error) {
    if (localFailure) throw new Error('Não foi possível salvar o progresso no servidor nem neste dispositivo. Mantenha a aula aberta até a conexão voltar.');
    throw error;
  }
}

export const pendingProgress = (userId: number) => queueFor(userId).entries();
