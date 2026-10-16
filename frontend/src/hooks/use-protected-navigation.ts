import { router } from 'expo-router';

import { useAuth } from '@/context/auth';

export const protectedRoutes = {
  downloads: '/downloads',
  profile: '/profile',
} as const;

export type ProtectedArea = keyof typeof protectedRoutes;

export const isProtectedArea = (value: unknown): value is ProtectedArea =>
  typeof value === 'string' && value in protectedRoutes;

export const openLogin = (redirect?: ProtectedArea) =>
  router.push(redirect ? { pathname: '/login', params: { redirect } } : '/login');

/** Abre uma área restrita; visitantes vão para o login e retornam à área depois. */
export function useProtectedNavigation() {
  const { user } = useAuth();
  return (area: ProtectedArea) =>
    user ? router.navigate(protectedRoutes[area]) : openLogin(area);
}
