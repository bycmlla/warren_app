import * as DocumentPicker from 'expo-document-picker';
import { Platform } from 'react-native';

import { ApiUrl } from '@/constants/api';
import { ApiError, type User } from '@/services/auth-api';

export type UploadKind = 'imagem' | 'video' | 'audio';
export type PickedFile = { uri: string; name: string; mimeType: string; size: number | null };
/** `duracaoSegundos` vem nos envios de vídeo e áudio: null quando o servidor não consegue lê-la do arquivo. */
export type UploadResult = { arquivo: string; tamanho: number; url?: string; duracaoSegundos?: number | null };

// Mesmos formatos e limites aplicados pelo backend (que é quem decide).
const KINDS: Record<UploadKind, { pick: string; limitMb: number; types: Record<string, string> }> = {
  imagem: {
    pick: 'image/*',
    limitMb: 8,
    types: { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' },
  },
  video: {
    pick: 'video/*',
    limitMb: 1024,
    types: { mp4: 'video/mp4', m4v: 'video/x-m4v', mov: 'video/quicktime', webm: 'video/webm' },
  },
  audio: {
    pick: 'audio/*',
    limitMb: 200,
    types: {
      mp3: 'audio/mpeg',
      m4a: 'audio/mp4',
      aac: 'audio/aac',
      wav: 'audio/wav',
      ogg: 'audio/ogg',
    },
  },
};

/** Abre o seletor de arquivos do dispositivo. Retorna null se a pessoa cancelar. */
export async function pickFile(kind: UploadKind): Promise<PickedFile | null> {
  const { pick, limitMb, types } = KINDS[kind];
  // Vídeos e áudios são enviados direto do arquivo original: copiá-los antes para a área
  // temporária do aplicativo dobraria o espaço exigido no aparelho e atrasaria arquivos grandes.
  const result = await DocumentPicker.getDocumentAsync({ type: pick, copyToCacheDirectory: kind === 'imagem' });
  if (result.canceled) return null;

  const asset = result.assets[0];
  const extension = asset.name.split('.').pop()?.toLowerCase() ?? '';
  // O tipo vem da extensão: o informado pelo sistema varia entre aparelhos.
  const mimeType = types[extension];
  if (!mimeType) {
    throw new ApiError(`Formato não aceito. Escolha um arquivo ${Object.keys(types).join(', ')}.`);
  }
  if (asset.size !== undefined && asset.size > limitMb * 1024 * 1024) {
    throw new ApiError(`O arquivo excede o limite de ${limitMb} MB.`);
  }
  return { uri: asset.uri, name: asset.name, mimeType, size: asset.size ?? null };
}

/**
 * Envia o arquivo como corpo da requisição, lendo direto do disco (sem carregá-lo em memória),
 * e informa o andamento de 0 a 1.
 */
function postFile<T>(
  path: string,
  token: string,
  file: PickedFile,
  onProgress: (fraction: number) => void
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${ApiUrl}${path}`);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('Content-Type', file.mimeType);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total);
    };
    xhr.onerror = () =>
      reject(new ApiError('Não foi possível enviar o arquivo. Verifique sua conexão e tente novamente.'));
    xhr.onload = () => {
      let data: (T & { message?: string }) | null = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        data = null;
      }
      if (xhr.status >= 200 && xhr.status < 300 && data) resolve(data);
      else reject(new ApiError(data?.message ?? 'Não foi possível enviar o arquivo.', xhr.status));
    };

    if (Platform.OS === 'web') {
      fetch(file.uri)
        .then((response) => response.blob())
        .then((blob) => xhr.send(blob))
        .catch(() => reject(new ApiError('Não foi possível ler o arquivo selecionado.')));
    } else {
      // No React Native, um corpo `{ uri }` é transmitido pelo sistema a partir do arquivo.
      xhr.send({ uri: file.uri, type: file.mimeType, name: file.name } as unknown as XMLHttpRequestBodyInit);
    }
  });
}

/** Envia um vídeo, áudio ou imagem do painel administrativo. */
export const uploadFile = (token: string, kind: UploadKind, file: PickedFile, onProgress: (fraction: number) => void) =>
  postFile<UploadResult>(`/api/admin/uploads/${kind}`, token, file, onProgress);

/** Envia a foto de perfil do usuário da sessão; o backend a associa ao cadastro e devolve o usuário atualizado. */
export const uploadProfilePhoto = (token: string, file: PickedFile, onProgress: (fraction: number) => void) =>
  postFile<{ usuario: User }>('/api/usuarios/me/foto', token, file, onProgress);
