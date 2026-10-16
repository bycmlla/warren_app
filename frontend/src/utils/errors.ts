import { ApiError } from '@/services/auth-api';

export const errorMessage = (cause: unknown) =>
  cause instanceof Error ? cause.message : 'Não foi possível concluir. Tente novamente.';

/** Mensagem do backend ao recusar a publicação de um curso, com as pendências em lista. */
export const publishError = (cause: unknown) =>
  cause instanceof ApiError && Array.isArray(cause.data.pendencias)
    ? `${cause.message}\n${cause.data.pendencias.map((item) => `• ${item}`).join('\n')}`
    : errorMessage(cause);
