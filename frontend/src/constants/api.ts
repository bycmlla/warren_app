import Constants from 'expo-constants';

// Em desenvolvimento a API roda na mesma máquina do Metro (porta 3000).
// Defina EXPO_PUBLIC_API_URL para apontar para outro endereço.
const devHost = Constants.expoConfig?.hostUri?.split(':')[0];

export const ApiUrl = process.env.EXPO_PUBLIC_API_URL ?? `http://${devHost ?? 'localhost'}:3000`;

/** Endereço completo de um arquivo servido pela API (capas e banners vêm como caminho relativo). */
export const fileUrl = (value: string | null | undefined) =>
  !value ? null : value.startsWith('/') ? `${ApiUrl}${value}` : /^https?:\/\//i.test(value) ? value : null;
