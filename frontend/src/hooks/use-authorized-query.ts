import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

import { useAuth } from '@/context/auth';
import { ApiError } from '@/services/auth-api';

type State<T> = { data?: T; error?: string; loading: boolean };

/**
 * Consulta autenticada que recarrega sempre que a tela volta a ficar em foco, para refletir
 * alterações feitas em outras telas. `call` deve ser uma função estável (definida fora do componente).
 */
export function useAuthorizedQuery<T>(call: (token: string) => Promise<T>) {
  const { authorized } = useAuth();
  return useFocusQuery(call, authorized);
}

/** Igual a useAuthorizedQuery, para rotas públicas: envia o token quando há sessão. */
export function usePublicQuery<T>(call: (token?: string) => Promise<T>) {
  const { optional } = useAuth();
  return useFocusQuery(call, optional);
}

function useFocusQuery<A, T>(
  call: (token: A) => Promise<T>,
  run: (call: (token: A) => Promise<T>) => Promise<T>
) {
  const [state, setState] = useState<State<T>>({ loading: true });
  const latest = useRef(0);

  const load = useCallback(() => {
    // Só a consulta mais recente atualiza a tela.
    const id = ++latest.current;
    setState((current) => ({ data: current.data, loading: true }));
    run(call)
      .then((data) => {
        if (latest.current === id) setState({ data, loading: false });
      })
      .catch((error: unknown) => {
        if (latest.current !== id) return;
        const message =
          error instanceof Error ? error.message : 'Não foi possível carregar as informações.';
        // Uma revogação ou remoção precisa retirar também os detalhes que estavam em memória.
        const denied = error instanceof ApiError && [401, 403, 404].includes(error.status ?? 0);
        setState((current) => ({ data: denied ? undefined : current.data, error: message, loading: false }));
      });
  }, [run, call]);

  useFocusEffect(load);

  return { ...state, reload: load };
}
