import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { fileUrl } from '@/constants/api';
import { Brand, Fonts } from '@/constants/brand';

const initials = (name: string) => {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.charAt(0) ?? '';
  const last = words.length > 1 ? words[words.length - 1].charAt(0) : '';
  return (first + last).toUpperCase();
};

/**
 * Foto de perfil circular; sem foto cadastrada (ou se ela não carregar), mostra as iniciais do nome.
 * `photoUrl` pode ser o caminho guardado no backend ("/arquivos/imagens/…") ou um endereço completo.
 */
export function Avatar({ name, photoUrl, size = 56 }: { name: string; photoUrl: string | null; size?: number }) {
  const [failedUrl, setFailedUrl] = useState<string>();
  const uri = fileUrl(photoUrl);
  const showPhoto = uri !== null && failedUrl !== uri;
  const shape = { width: size, height: size, borderRadius: size / 2 };

  if (showPhoto) {
    return (
      <Image
        source={{ uri }}
        contentFit="cover"
        cachePolicy="memory-disk"
        accessibilityLabel={`Foto de ${name}`}
        onError={() => setFailedUrl(uri)}
        style={[styles.photo, shape]}
      />
    );
  }

  return (
    <View accessible accessibilityLabel={`Avatar de ${name}`} style={[styles.fallback, shape]}>
      <Text maxFontSizeMultiplier={1.2} style={[styles.initials, { fontSize: size * 0.38 }]}>
        {initials(name)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  photo: { backgroundColor: Brand.surface },
  fallback: { backgroundColor: Brand.surface, alignItems: 'center', justifyContent: 'center' },
  initials: { fontFamily: Fonts.serifMedium, color: Brand.primaryDeep },
});
