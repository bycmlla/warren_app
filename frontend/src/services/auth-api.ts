import { ApiUrl } from '@/constants/api';

export type Role = 'ADMIN' | 'USER';
export type User = {
  id: number;
  nome: string;
  email: string;
  telefone: string | null;
  fotoPerfil: string | null;
  role: Role;
};
export type Session = { token: string; user: User };
export type RegisterInput = { nome: string; email: string; telefone?: string; senha: string };

export class ApiError extends Error {
  constructor(
    message: string,
    /** Código HTTP; ausente quando a requisição nem chegou ao servidor. */
    public status?: number,
    /** Campos extras da resposta de erro (ex.: pendências de publicação). */
    public data: Record<string, unknown> = {}
  ) {
    super(message);
  }
}

type Options = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  token?: string;
  timeout?: number;
  keepalive?: boolean;
};

export async function request<T>(path: string, { method = 'GET', body, token, timeout = 10000, keepalive }: Options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  let response: Response;
  try {
    response = await fetch(`${ApiUrl}${path}`, {
      method,
      headers: {
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
        ...(token !== undefined && { Authorization: `Bearer ${token}` }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
      ...(keepalive && { keepalive: true }),
    });
  } catch {
    throw new ApiError('Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.');
  } finally {
    clearTimeout(timer);
  }

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(
      data?.message ?? 'Não foi possível concluir a solicitação.',
      response.status,
      data ?? {}
    );
  }
  return data as T;
}

export async function login(email: string, senha: string): Promise<Session> {
  const { token, usuario } = await request<{ token: string; usuario: User }>('/api/usuarios/login', {
    method: 'POST',
    body: { email, senha },
  });
  return { token, user: usuario };
}

export function register(input: RegisterInput) {
  return request<User>('/api/usuarios', { method: 'POST', body: input });
}

/** Usuário e perfil atuais segundo o backend. */
export async function fetchCurrentUser(token: string, timeout?: number) {
  return (await request<{ usuario: User }>('/api/usuarios/me', { token, timeout })).usuario;
}


/** Remove a foto de perfil do usuário da sessão e devolve o usuário atualizado. */
export async function deleteProfilePhoto(token: string) {
  return (await request<{ usuario: User }>('/api/usuarios/me/foto', { method: 'DELETE', token })).usuario;
}
