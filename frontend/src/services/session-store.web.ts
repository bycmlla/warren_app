// O armazenamento seguro não existe na web: a sessão vale só enquanto a página estiver aberta.
let memory: string | null = null;

export const loadToken = async () => memory;
export const saveToken = async (token: string) => {
  memory = token;
};
export const clearToken = async () => {
  memory = null;
};
