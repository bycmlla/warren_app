import * as SecureStore from 'expo-secure-store';

// O token de sessão fica no armazenamento seguro do sistema (Keystore no Android, Keychain no iOS).
const KEY = 'joanalia.session.token';

export const loadToken = () => SecureStore.getItemAsync(KEY).catch(() => null);
export const saveToken = (token: string) => SecureStore.setItemAsync(KEY, token);
export const clearToken = () => SecureStore.deleteItemAsync(KEY).catch(() => undefined);
