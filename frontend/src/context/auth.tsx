import { createContext, use, useEffect, useState, type ReactNode } from 'react';

import {
  ApiError,
  fetchCurrentUser,
  login,
  register,
  type RegisterInput,
  type Session,
  type User,
} from '@/services/auth-api';
import { clearToken, loadToken, saveToken } from '@/services/session-store';

type AuthValue = {
  /** false enquanto a sessão salva ainda está sendo recuperada. */
  ready: boolean;
  user: User | null;
  /** Token da sessão, para os players de vídeo e áudio enviarem no cabeçalho. */
  token: string | null;
  signIn: (email: string, senha: string) => Promise<User>;
  signUp: (input: RegisterInput) => Promise<User>;
  signOut: () => Promise<void>;
  /** Substitui os dados do usuário logado (ex.: depois de trocar a foto): todas as telas se atualizam. */
  updateUser: (user: User) => void;
  /**
   * Faz uma chamada autenticada. Se o backend recusar o token (401), encerra a sessão local;
   * se negar a permissão (403), reconsulta o perfil para refletir a perda de acesso.
   */
  authorized: <T>(call: (token: string) => Promise<T>) => Promise<T>;
  /** Chamada a uma rota pública que responde com mais detalhes a quem tem sessão. */
  optional: <T>(call: (token?: string) => Promise<T>) => Promise<T>;
};

const AuthContext = createContext<AuthValue | null>(null);

const RESTORE_TIMEOUT = 5000;
const rejected = (error: unknown, ...statuses: number[]) =>
  error instanceof ApiError && error.status !== undefined && statuses.includes(error.status);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  // Ao abrir o app, recupera o token salvo e confirma usuário e perfil com o backend.
  useEffect(() => {
    let active = true;
    (async () => {
      const token = await loadToken();
      if (token) {
        try {
          const user = await fetchCurrentUser(token, RESTORE_TIMEOUT);
          if (active) setSession({ token, user });
        } catch (error) {
          // Sessão expirada ou conta bloqueada: descarta. Sem conexão: mantém para a próxima abertura.
          if (rejected(error, 401, 403)) await clearToken();
        }
      }
      if (active) setReady(true);
    })();
    return () => {
      active = false;
    };
  }, []);

  const start = async (email: string, senha: string) => {
    const next = await login(email, senha);
    await saveToken(next.token);
    setSession(next);
    return next.user;
  };

  const signOut = async () => {
    await clearToken();
    setSession(null);
  };

  // Atualiza usuário e perfil a partir do backend; encerra a sessão se ela não valer mais.
  const refresh = async (token: string) => {
    try {
      const user = await fetchCurrentUser(token);
      setSession((current) =>
        current?.token === token && JSON.stringify(current.user) !== JSON.stringify(user)
          ? { token, user }
          : current
      );
    } catch (error) {
      if (rejected(error, 401, 403)) await signOut();
    }
  };

  const value: AuthValue = {
    ready,
    user: session?.user ?? null,
    token: session?.token ?? null,
    signIn: start,
    signUp: async (input) => {
      await register(input);
      return start(input.email, input.senha);
    },
    signOut,
    updateUser: (user) => setSession((current) => (current ? { ...current, user } : current)),
    authorized: async (call) => {
      if (!session) throw new ApiError('Sessão expirada. Entre novamente.', 401);
      try {
        return await call(session.token);
      } catch (error) {
        if (rejected(error, 401)) await signOut();
        else if (rejected(error, 403)) await refresh(session.token);
        throw error;
      }
    },
    optional: async (call) => {
      try {
        return await call(session?.token);
      } catch (error) {
        if (session && rejected(error, 401)) await signOut();
        throw error;
      }
    },
  };

  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth() {
  const value = use(AuthContext);
  if (!value) throw new Error('useAuth deve ser usado dentro de AuthProvider.');
  return value;
}
