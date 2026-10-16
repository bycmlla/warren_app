import { router, type Href } from 'expo-router';

let last = { key: '', at: 0 };

/**
 * Abre uma tela sobre a atual, ignorando a repetição do mesmo toque: sem isso, tocar duas vezes
 * num cartão antes de a tela aparecer empilha duas cópias dela, e o Voltar precisa ser apertado
 * duas vezes.
 */
export function pushOnce(href: Href) {
  const key = JSON.stringify(href);
  const now = Date.now();
  if (key === last.key && now - last.at < 1000) return;
  last = { key, at: now };
  router.push(href);
}

/** Fecha tudo o que estiver aberto sobre as abas e mostra a aba Início, que continua montada. */
export function goHome() {
  if (router.canDismiss()) router.dismissAll();
  router.navigate('/');
}
