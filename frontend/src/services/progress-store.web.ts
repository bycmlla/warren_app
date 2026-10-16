import { decodePendingProgress, type PendingProgress } from '@/utils/progress-queue';

const key = (userId: number) => `joanalia.progress.${userId}`;

export async function readPendingProgress(userId: number): Promise<PendingProgress[]> {
  if (typeof localStorage === 'undefined') return [];
  try { return decodePendingProgress(localStorage.getItem(key(userId))); }
  catch { return []; }
}

export async function writePendingProgress(userId: number, entries: PendingProgress[]) {
  if (typeof localStorage === 'undefined') return;
  if (entries.length > 0) localStorage.setItem(key(userId), JSON.stringify(entries));
  else localStorage.removeItem(key(userId));
}
