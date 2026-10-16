import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { BrandIcon } from '@/components/brand-icon';
import { FormError } from '@/components/form';
import { PrimaryButton } from '@/components/primary-button';
import { Brand, Fonts, Radius } from '@/constants/brand';
import { useAuth } from '@/context/auth';
import { deleteProfilePhoto, type User } from '@/services/auth-api';
import { uploadProfilePhoto } from '@/services/upload';
import { errorMessage } from '@/utils/errors';

/** Lado, em pixels, da foto enviada: sobra para o maior avatar e mantém o arquivo pequeno. */
const PHOTO_SIZE = 640;
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * Avatar do Perfil com um selo de câmera: ao tocar, abre a foto atual e as ações de trocar ou
 * remover. A foto é recortada em quadrado, reduzida e comprimida antes do envio, e fica guardada
 * no backend, associada à conta. Só depois de o servidor confirmar o usuário da sessão é
 * atualizado, e então todos os avatares (Perfil e cabeçalho) mudam juntos. Se algo falhar, a
 * foto anterior continua valendo.
 */
export function ProfilePhotoEditor({ user }: { user: User }) {
  const { authorized, updateUser } = useAuth();
  const [open, setOpen] = useState(false);
  const [progress, setProgress] = useState<number>();
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string>();
  const busy = progress !== undefined || removing;
  const hasPhoto = user.fotoPerfil !== null;

  const close = () => {
    if (busy) return;
    setOpen(false);
    setError(undefined);
  };

  const choose = async () => {
    if (busy) return;
    setError(undefined);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 1,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (asset.mimeType && !ACCEPTED.includes(asset.mimeType.toLowerCase())) {
        setError('Formato não aceito. Escolha uma imagem JPG, PNG ou WebP.');
        return;
      }

      setProgress(0);
      // Reduz e comprime antes de enviar (WebP preserva a qualidade com pouco peso).
      const context = ImageManipulator.manipulate(asset.uri);
      if (asset.width > PHOTO_SIZE) context.resize({ width: PHOTO_SIZE });
      const rendered = await context.renderAsync();
      const saved = await rendered.saveAsync({ format: SaveFormat.WEBP, compress: 0.85 });
      rendered.release();

      const { usuario } = await authorized((token) =>
        uploadProfilePhoto(
          token,
          { uri: saved.uri, name: 'perfil.webp', mimeType: 'image/webp', size: null },
          setProgress
        )
      );
      updateUser(usuario);
      setOpen(false);
    } catch (cause) {
      setError(`${errorMessage(cause)}${hasPhoto ? ' Sua foto atual foi mantida.' : ''}`);
    } finally {
      setProgress(undefined);
    }
  };

  const remove = async () => {
    if (busy) return;
    setError(undefined);
    setRemoving(true);
    try {
      updateUser(await authorized((token) => deleteProfilePhoto(token)));
      setOpen(false);
    } catch (cause) {
      setError(`${errorMessage(cause)} Sua foto atual foi mantida.`);
    } finally {
      setRemoving(false);
    }
  };

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={hasPhoto ? 'Foto de perfil. Toque para ver, trocar ou remover' : 'Adicionar foto de perfil'}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.wrap, pressed && styles.pressed]}>
        <Avatar name={user.nome} photoUrl={user.fotoPerfil} size={64} />
        <View style={styles.badge}>
          <BrandIcon name="camera" size={12} strokeWidth={1.8} color={Brand.white} />
        </View>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        <Pressable accessibilityLabel="Fechar" style={styles.backdrop} onPress={close}>
          <Pressable accessible={false} style={styles.sheet}>
            <Text accessibilityRole="header" style={styles.title}>
              Foto de perfil
            </Text>
            <View style={styles.preview}>
              <Avatar name={user.nome} photoUrl={user.fotoPerfil} size={160} />
              {busy && (
                <View style={styles.loading}>
                  <ActivityIndicator color={Brand.white} size="large" />
                </View>
              )}
            </View>
            <Text style={styles.hint}>
              {hasPhoto
                ? 'Esta foto aparece no seu perfil e no topo do aplicativo.'
                : 'Sem foto, o aplicativo mostra a inicial do seu nome.'}
            </Text>
            {error !== undefined && <FormError message={error} />}
            <PrimaryButton
              label={
                progress !== undefined
                  ? `Enviando… ${Math.round(progress * 100)}%`
                  : hasPhoto
                    ? 'Trocar foto'
                    : 'Escolher da galeria'
              }
              onPress={choose}
              loading={progress !== undefined}
              disabled={removing}
            />
            {hasPhoto && (
              <PrimaryButton variant="outline" label="Remover foto" onPress={remove} loading={removing} disabled={progress !== undefined} />
            )}
            <PrimaryButton variant="outline" label="Fechar" onPress={close} disabled={busy} />
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  wrap: { width: 64, height: 64 },
  badge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Brand.primary,
    borderWidth: 2,
    borderColor: Brand.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.8 },
  backdrop: { flex: 1, backgroundColor: 'rgba(72, 75, 60, 0.45)', justifyContent: 'center', padding: 24 },
  sheet: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    gap: 14,
    padding: 22,
    borderRadius: Radius.hero,
    backgroundColor: Brand.card,
  },
  title: { fontFamily: Fonts.serifMedium, fontSize: 22, lineHeight: 28, color: Brand.text, textAlign: 'center' },
  preview: { alignSelf: 'center', width: 160, height: 160, borderRadius: 80, overflow: 'hidden' },
  loading: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(72, 75, 60, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: { fontFamily: Fonts.sans, fontSize: 13, lineHeight: 19, color: Brand.muted, textAlign: 'center' },
});
