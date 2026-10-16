import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { AdminOnly } from '@/components/admin-only';
import { AdminScaffold, QueryState, confirmAction, errorMessage } from '@/components/admin-scaffold';
import { ButtonStylePicker } from '@/components/button-style-picker';
import { FormError, SmallButton, SwitchRow, TextField } from '@/components/form';
import { HomeHero, heroHeight } from '@/components/home-hero';
import { PrimaryButton } from '@/components/primary-button';
import { fileUrl } from '@/constants/api';
import {
  type AdminBanner,
  type Slide,
  type BannerText,
  type ButtonStyleId,
} from '@/constants/banner';
import { Brand, ContentWidth, Fonts, Gutter } from '@/constants/brand';
import { useAuth } from '@/context/auth';
import { useAuthorizedQuery } from '@/hooks/use-authorized-query';
import { createBanner, fetchBanners, updateBanner } from '@/services/admin-api';
import { uploadFile } from '@/services/upload';

/** Largura máxima da imagem enviada: o banner é pequeno, então 1600 px sobra com folga. */
const IMAGE_WIDTH = 1600;
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];
/** O banner da Home tem a mesma margem lateral usada em (tabs)/index.tsx. */
const HERO_MARGIN = 16;

const POSITIONS = [0, 50, 100];

export default function HomeBannerFormScreen() {
  return (
    <AdminOnly>
      <Loader />
    </AdminOnly>
  );
}

function Loader() {
  const params = useLocalSearchParams<{ id?: string }>();
  const id = params.id ? Number(params.id) : undefined;
  const { data, error, loading, reload } = useAuthorizedQuery(fetchBanners);
  const banner = data?.banners.find((item) => item.id === id);

  if (id === undefined) return <Editor />;
  if (banner) return <Editor key={banner.id} banner={banner} />;
  return (
    <AdminScaffold title="Editar banner">
      <QueryState loading={loading} error={error} hasData={data !== undefined} onRetry={reload} />
      {data !== undefined && <FormError message="Banner não encontrado. Ele pode ter sido excluído." />}
    </AdminScaffold>
  );
}

type Draft = {
  nome: string;
  enquadramento: { x: number; y: number };
  textoSuperior: BannerText;
  titulo: BannerText;
  botao: ButtonStyleId;
};

const NEW_DRAFT: Draft = {
  nome: '',
  enquadramento: { x: 50, y: 50 },
  textoSuperior: { texto: '', visivel: false },
  titulo: { texto: '', visivel: false },
  botao: 'champagne',
};

const toDraft = (banner?: AdminBanner): Draft =>
  banner
    ? {
        nome: banner.nome,
        enquadramento: banner.enquadramento,
        textoSuperior: banner.textoSuperior,
        titulo: banner.titulo,
        botao: banner.botao,
      }
    : NEW_DRAFT;

function Editor({ banner }: { banner?: AdminBanner }) {
  const { authorized } = useAuth();
  const { width } = useWindowDimensions();
  const [draft, setDraft] = useState<Draft>(() => toDraft(banner));
  // Imagem já publicada e imagem nova ainda só neste aparelho, que sobe ao salvar.
  const image = banner?.imagem ?? null;
  const [localUri, setLocalUri] = useState<string>();
  // Endereço da imagem nova já enviada: se salvar falhar, a nova tentativa não envia o arquivo de novo.
  const [uploaded, setUploaded] = useState<string>();
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<number>();
  const [error, setError] = useState<string>();
  const busy = saving || picking;

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const dirty = localUri !== undefined || JSON.stringify(draft) !== JSON.stringify(toDraft(banner));
  const hasImage = localUri !== undefined || image !== null;
  const previewImage = localUri ?? fileUrl(image);

  // Mesma largura e altura do banner real da Home; a tela administrativa tem uma margem lateral um pouco maior.
  const previewWidth = Math.min(width, ContentWidth) - HERO_MARGIN * 2;
  const preview: Slide = {
    id: banner?.id ?? null,
    modo: 'personalizado',
    imagem: image,
    enquadramento: draft.enquadramento,
    textoSuperior: draft.textoSuperior,
    titulo: draft.titulo,
    botao: draft.botao,
    atualizadoEm: null,
  };

  const pick = async () => {
    if (busy) return;
    setError(undefined);
    setPicking(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (asset.mimeType && !ACCEPTED.includes(asset.mimeType.toLowerCase())) {
        setError('Formato não aceito. Escolha uma imagem JPG, PNG ou WebP.');
        return;
      }
      // Imagens grandes são reduzidas e comprimidas (WebP) antes de qualquer envio.
      const context = ImageManipulator.manipulate(asset.uri);
      if (asset.width > IMAGE_WIDTH) context.resize({ width: IMAGE_WIDTH });
      const rendered = await context.renderAsync();
      const saved = await rendered.saveAsync({ format: SaveFormat.WEBP, compress: 0.85 });
      rendered.release();
      setLocalUri(saved.uri);
      setUploaded(undefined);
      set('enquadramento', { x: 50, y: 50 });
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPicking(false);
    }
  };

  const save = async () => {
    if (busy) return;
    if (!draft.nome.trim()) return setError('Dê um nome interno ao banner (ele não aparece na Home).');
    if (!hasImage) return setError('Escolha uma imagem para o banner.');
    if (draft.titulo.visivel && !draft.titulo.texto.trim()) return setError('Escreva o título ou oculte-o.');
    if (draft.textoSuperior.visivel && !draft.textoSuperior.texto.trim()) {
      return setError('Escreva o texto superior ou oculte-o.');
    }
    setError(undefined);
    setSaving(true);
    try {
      let url = uploaded ?? image;
      if (localUri !== undefined && uploaded === undefined) {
        setProgress(0);
        const sent = await authorized((token) =>
          uploadFile(token, 'imagem', { uri: localUri, name: 'banner.webp', mimeType: 'image/webp', size: null }, setProgress)
        );
        url = sent.url ?? null;
        setUploaded(sent.url ?? undefined);
      }
      if (url === null) throw new Error('A imagem não foi enviada. Tente novamente.');
      // Só depois do envio o banner é gravado: se algo falhar, o que já estava publicado continua.
      const body = { ...draft, nome: draft.nome.trim(), imagem: url };
      await authorized((token) => (banner ? updateBanner(token, banner.id, body) : createBanner(token, body)));
      router.back();
    } catch (cause) {
      setError(`${errorMessage(cause)} ${banner ? 'O banner publicado foi mantido.' : 'Nada foi publicado.'}`);
      setSaving(false);
      setProgress(undefined);
    }
  };

  const cancel = () => {
    if (!dirty) return router.back();
    return confirmAction('Descartar alterações?', 'As mudanças ainda não publicadas serão perdidas. Os banners atuais continuam como estão.', 'Descartar', () => router.back());
  };

  return (
    <AdminScaffold
      title={banner ? 'Editar banner' : 'Novo banner'}
      subtitle="A prévia mostra como o banner ficará na Home, com o botão nativo. Nada aparece para os alunos antes de salvar.">
      <View style={styles.preview} accessibilityLabel="Pré-visualização do banner">
        <HomeHero
          width={previewWidth}
          height={heroHeight(previewWidth)}
          banner={preview}
          imageUri={previewImage}
          onExplore={() => undefined}
        />
      </View>

      <TextField label="Nome interno" value={draft.nome} onChangeText={(nome) => set('nome', nome)} maxLength={80} />

      <View style={styles.group}>
        <Text style={styles.label}>Imagem</Text>
        <Text style={styles.hint}>JPG, PNG ou WebP. Imagens grandes são otimizadas automaticamente.</Text>
        <View style={styles.row}>
          <SmallButton
            label={progress !== undefined ? `Enviando… ${Math.round(progress * 100)}%` : picking ? 'Preparando…' : hasImage ? 'Trocar imagem' : 'Escolher imagem'}
            onPress={pick}
            disabled={busy}
          />
        </View>
      </View>

      {hasImage && (
        <View style={styles.group}>
          <Text style={styles.label}>Enquadramento</Text>
          <Text style={styles.hint}>Toque na parte da imagem que deve ficar em destaque no banner.</Text>
          <View style={styles.grid}>
            {POSITIONS.map((y) =>
              POSITIONS.map((x) => {
                const selected = draft.enquadramento.x === x && draft.enquadramento.y === y;
                return (
                  <Pressable
                    key={`${x}-${y}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`Enquadrar ${y === 0 ? 'no topo' : y === 100 ? 'na base' : 'ao centro'}, ${x === 0 ? 'à esquerda' : x === 100 ? 'à direita' : 'no meio'}`}
                    onPress={() => set('enquadramento', { x, y })}
                    style={[styles.cell, selected && styles.cellSelected]}>
                    {selected && <View style={styles.dot} />}
                  </Pressable>
                );
              })
            )}
          </View>
        </View>
      )}

      <View style={styles.group}>
        <TextField
          label="Texto superior"
          value={draft.textoSuperior.texto}
          onChangeText={(texto) => set('textoSuperior', { ...draft.textoSuperior, texto })}
          maxLength={80}
          editable={draft.textoSuperior.visivel}
          autoCapitalize="characters"
        />
        <SwitchRow
          label="Mostrar texto superior"
          value={draft.textoSuperior.visivel}
          onValueChange={(visivel) => set('textoSuperior', { ...draft.textoSuperior, visivel })}
        />
        <TextField
          label="Título principal"
          value={draft.titulo.texto}
          onChangeText={(texto) => set('titulo', { ...draft.titulo, texto })}
          maxLength={120}
          editable={draft.titulo.visivel}
          multiline
        />
        <SwitchRow
          label="Mostrar título"
          description="Oculte os textos se a imagem já tiver textos próprios."
          value={draft.titulo.visivel}
          onValueChange={(visivel) => set('titulo', { ...draft.titulo, visivel })}
        />
      </View>

      <View style={styles.group}>
        <Text accessibilityRole="header" style={styles.heading}>
          Cor do botão
        </Text>
        <Text style={styles.hint}>O botão “Explorar experiências” é sempre nativo, sobre a imagem.</Text>
        <ButtonStylePicker value={draft.botao} onChange={(botao) => set('botao', botao)} />
      </View>

      {error !== undefined && <FormError message={error} />}
      <PrimaryButton label="Salvar e publicar" onPress={save} loading={saving} disabled={picking} />
      <PrimaryButton variant="outline" label="Cancelar" onPress={cancel} disabled={busy} />
    </AdminScaffold>
  );
}

const styles = StyleSheet.create({
  // Alinha a prévia à largura do banner real (a tela tem margem lateral maior que a da Home).
  preview: { marginHorizontal: -(Gutter - HERO_MARGIN) },
  group: { gap: 8 },
  label: { fontFamily: Fonts.sansMedium, fontSize: 12.5, color: Brand.text },
  heading: { fontFamily: Fonts.serifMedium, fontSize: 18, lineHeight: 24, color: Brand.text },
  hint: { fontFamily: Fonts.sans, fontSize: 12, lineHeight: 17, color: Brand.muted },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  grid: { width: 132, flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  cell: {
    width: 40,
    height: 30,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Brand.primarySoft,
    backgroundColor: Brand.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellSelected: { borderColor: Brand.primary, backgroundColor: Brand.surface },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: Brand.primary },
});
