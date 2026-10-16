import { router, useFocusEffect } from 'expo-router';
import { useCallback, type ReactNode } from 'react';

import { useAuth } from '@/context/auth';

/**
 * Envolve as telas administrativas. Quem não é ADMIN (visitante, aluno, sessão encerrada ou
 * permissão perdida) é levado à Home em vez de ver o conteúdo. A proteção real fica no backend:
 * as rotas /api/admin recusam qualquer outro perfil.
 */
export function AdminOnly({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const allowed = user?.role === 'ADMIN';

  // Só redireciona com a tela em foco, para não navegar a partir de uma aba em segundo plano.
  useFocusEffect(
    useCallback(() => {
      if (allowed) return;
      if (router.canDismiss()) router.dismissAll();
      router.navigate('/');
    }, [allowed])
  );

  return allowed ? children : null;
}
