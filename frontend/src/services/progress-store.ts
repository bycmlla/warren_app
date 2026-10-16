import * as SecureStore from 'expo-secure-store';

import { decodePendingProgress, progressKey, type PendingProgress } from '@/utils/progress-queue';

const prefix = (userId: number) => `joanalia.progress.${userId}`;

// Cada checkpoint usa uma chave pequena; não armazena vídeos nem credenciais da sessão.
export async function readPendingProgress(userId: number): Promise<PendingProgress[]> {
  const base = prefix(userId);
  try {
    const keys: string[] = JSON.parse((await SecureStore.getItemAsync(`${base}.index`)) ?? '[]');
    if (!Array.isArray(keys)) return [];
    const valid = keys.filter((key) => typeof key === 'string' && /^\d+\.(?:\d+|aula)$/.test(key));
    const values = await Promise.all(valid.map((key) => SecureStore.getItemAsync(`${base}.${key}`)));
    return values.flatMap((value) => decodePendingProgress(value === null ? null : `[${value}]`));
  } catch { return []; }
}

export async function writePendingProgress(userId: number, entries: PendingProgress[]) {
  const base = prefix(userId);
  const previous: string[] = JSON.parse((await SecureStore.getItemAsync(`${base}.index`)) ?? '[]');
  const keys = entries.map(progressKey);
  // O índice é gravado antes: se houver interrupção, um checkpoint enviado pode ser repetido.
  await SecureStore.setItemAsync(`${base}.index`, JSON.stringify([...new Set([...previous, ...keys])]));
  await Promise.all(entries.map((entry) => SecureStore.setItemAsync(`${base}.${progressKey(entry)}`, JSON.stringify(entry))));
  await SecureStore.setItemAsync(`${base}.index`, JSON.stringify(keys));
  await Promise.all(previous.filter((key) => !keys.includes(key)).map((key) => SecureStore.deleteItemAsync(`${base}.${key}`)));
}
