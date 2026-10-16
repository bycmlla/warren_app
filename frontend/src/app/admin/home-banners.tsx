import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { AdminOnly } from '@/components/admin-only';
import { AdminScaffold, QueryState, confirmAction, errorMessage } from '@/components/admin-scaffold';
import { FormError, IconButton, SwitchRow } from '@/components/form';
import { BrandIcon } from '@/components/brand-icon';
import { ButtonStylePicker } from '@/components/button-style-picker';
import { HomeHero, heroHeight } from '@/components/home-hero';
import { fileUrl } from '@/constants/api';
import { BUTTON_STYLES, DEFAULT_SLIDE, type AdminBanner } from '@/constants/banner';
import { Brand, ContentWidth, Fonts, Gutter, Radius, Shadow } from '@/constants/brand';
import { useAuth } from '@/context/auth';
import { useAuthorizedQuery } from '@/hooks/use-authorized-query';
import {
  deleteBanner,
  fetchBanners,
  reorderBanners,
  saveDefaultBanner,
  setBannerActive,
  type BannerPanel,
} from '@/services/admin-api';

export default function HomeBannersScreen() {
  return (
    <AdminOnly>
      <Banners />
    </AdminOnly>
  );
}

function Banners() {
  const { authorized } = useAuth();
  const { data, error, loading, reload } = useAuthorizedQuery(fetchBanners);
  const [notice, setNotice] = useState<string>();
  // Alteração já aplicada na tela enquanto o servidor confirma; vale só para os dados atuais.
  const [draft, setDraft] = useState<{ base: BannerPanel; panel: BannerPanel }>();
  const panel = draft !== undefined && draft.base === data ? draft.panel : data;

  const apply = async (next: BannerPanel, action: (token: string) => Promise<unknown>) => {
    if (data) setDraft({ base: data, panel: next });
    setNotice(undefined);
    try {
      await authorized(action);
    } catch (cause) {
      setNotice(errorMessage(cause));
    }
    // Recarregar devolve a tela ao estado real do servidor, inclusive quando a alteração falhou.
    reload();
  };

  const move = (index: number, delta: -1 | 1) => {
    if (!panel) return;
    const banners = [...panel.banners];
    [banners[index], banners[index + delta]] = [banners[index + delta], banners[index]];
    apply({ ...panel, banners }, (token) => reorderBanners(token, banners.map((banner) => banner.id)));
  };

  const toggle = (banner: AdminBanner, ativo: boolean) => {
    if (!panel) return;
    apply(
      { ...panel, banners: panel.banners.map((item) => (item.id === banner.id ? { ...item, ativo } : item)) },
      (token) => setBannerActive(token, banner.id, ativo)
    );
  };

  const adjustDefault = (change: Partial<BannerPanel['padrao']>) => {
    if (!panel) return;
    const padrao = { ...panel.padrao, ...change };
    apply({ ...panel, padrao }, (token) => saveDefaultBanner(token, padrao));
  };

  const remove = (banner: AdminBanner) =>
    confirmAction(
      'Excluir banner?',
      `"${banner.nome}" deixa de aparecer na Home e a imagem é apagada. Isso não pode ser desfeito.`,
      'Excluir',
      async () => {
        setNotice(undefined);
        try {
          await authorized((token) => deleteBanner(token, banner.id));
        } catch (cause) {
          setNotice(errorMessage(cause));
        }
        reload();
      }
    );

  const { width } = useWindowDimensions();
  // Largura do banner dentro do card: a tela, menos a margem da página e o respiro interno do card.
  const previewWidth = Math.min(width, ContentWidth) - Gutter * 2 - CARD_PADDING * 2;
  const custom = panel?.banners ?? [];
  const activeCount = custom.filter((banner) => banner.ativo).length;

  return (
    <AdminScaffold
      title="Banners da página inicial"
      subtitle="Os banners aparecem na Home em carrossel, na ordem desta lista. Com um único banner, não há troca."
      refreshing={loading && data !== undefined}
      onRefresh={reload}>
      {notice !== undefined && <FormError message={notice} />}
      <QueryState loading={loading} error={error} hasData={data !== undefined} onRetry={reload} />

      {panel && (
        <View style={styles.card}>
          <View accessibilityLabel="Pré-visualização do banner padrão">
            <HomeHero
              width={previewWidth}
              height={heroHeight(previewWidth)}
              banner={{ ...DEFAULT_SLIDE, botao: panel.padrao.botao }}
              onExplore={() => undefined}
            />
          </View>
          <AddBannerButton onPress={() => router.push('/admin/home-banner-form')} />
          <View style={styles.row}>
            <View style={[styles.thumb, styles.defaultThumb]}>
              <Text style={styles.defaultThumbText}>Joanalia</Text>
            </View>
            <View style={styles.text}>
              <Text style={styles.name}>Banner padrão</Text>
              <View style={styles.tags}>
                <Tag label="Padrão" tone="gold" />
                <Tag label={panel.padrao.exibir || activeCount === 0 ? 'No carrossel' : 'Oculto'} />
              </View>
            </View>
          </View>
          <SwitchRow
            label="Exibir banner padrão no carrossel"
            description={
              activeCount === 0
                ? 'Sem banners personalizados ativos, o banner padrão aparece sempre. Ele não pode ser excluído.'
                : 'O banner padrão não pode ser excluído; só pode ser ocultado do carrossel.'
            }
            value={panel.padrao.exibir || activeCount === 0}
            disabled={activeCount === 0}
            onValueChange={(exibir) => adjustDefault({ exibir })}
          />
          <Text style={styles.name}>Cor do botão</Text>
          <ButtonStylePicker value={panel.padrao.botao} onChange={(botao) => adjustDefault({ botao })} />
        </View>
      )}

      {panel && custom.length === 0 && (
        <View style={styles.empty}>
          <Text style={styles.name}>Nenhum banner personalizado.</Text>
          <Text style={styles.detail}>A Home mostra o banner padrão. Adicione um banner para montar o carrossel.</Text>
        </View>
      )}

      {custom.map((banner, index) => (
        <View key={banner.id} style={styles.card}>
          <View style={styles.row}>
            <Image source={{ uri: fileUrl(banner.imagem) ?? undefined }} contentFit="cover" style={styles.thumb} accessible={false} />
            <View style={styles.text}>
              <Text numberOfLines={2} style={styles.name}>
                {banner.nome}
              </Text>
              <View style={styles.tags}>
                <Tag label={banner.ativo ? 'Ativo' : 'Inativo'} tone={banner.ativo ? 'green' : undefined} />
                <Tag label={`Botão ${BUTTON_STYLES[banner.botao].label.toLowerCase()}`} />
              </View>
            </View>
          </View>
          <View style={styles.actions}>
            <IconButton icon="up" label={`Mover ${banner.nome} para cima`} disabled={index === 0} onPress={() => move(index, -1)} />
            <IconButton
              icon="down"
              label={`Mover ${banner.nome} para baixo`}
              disabled={index === custom.length - 1}
              onPress={() => move(index, 1)}
            />
            <View style={styles.grow} />
            <IconButton
              icon="edit"
              label={`Editar ${banner.nome}`}
              onPress={() => router.push({ pathname: '/admin/home-banner-form', params: { id: String(banner.id) } })}
            />
            <IconButton icon="trash" label={`Excluir ${banner.nome}`} onPress={() => remove(banner)} />
          </View>
          <SwitchRow label="Ativo no carrossel" value={banner.ativo} onValueChange={(ativo) => toggle(banner, ativo)} />
        </View>
      ))}
    </AdminScaffold>
  );
}

/** Botão compacto, abaixo da prévia e à direita: abre o mesmo cadastro de banner. */
function AddBannerButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Adicionar banner"
      onPress={onPress}
      android_ripple={{ color: 'rgba(255, 255, 255, 0.28)' }}
      style={({ pressed }) => [styles.add, pressed && styles.pressed]}>
      <BrandIcon name="plus" size={16} strokeWidth={1.8} color={Brand.white} />
      <Text style={styles.addText}>Adicionar banner</Text>
    </Pressable>
  );
}

function Tag({ label, tone }: { label: string; tone?: 'gold' | 'green' }) {
  return (
    <View style={[styles.tag, tone === 'gold' && styles.tagGold, tone === 'green' && styles.tagGreen]}>
      <Text style={[styles.tagText, tone === 'gold' && styles.tagTextGold]}>{label}</Text>
    </View>
  );
}

const CARD_PADDING = 14;

const styles = StyleSheet.create({
  card: { gap: 10, padding: CARD_PADDING, borderRadius: Radius.card, backgroundColor: Brand.card, boxShadow: Shadow.card },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  text: { flex: 1, gap: 6 },
  name: { fontFamily: Fonts.sansMedium, fontSize: 14.5, lineHeight: 20, color: Brand.text },
  detail: { fontFamily: Fonts.sans, fontSize: 12, lineHeight: 17, color: Brand.muted },
  thumb: { width: 84, height: 56, borderRadius: Radius.tile, backgroundColor: Brand.surface },
  defaultThumb: { alignItems: 'center', justifyContent: 'center', backgroundColor: Brand.surfaceSoft },
  defaultThumbText: { fontFamily: Fonts.serifMedium, fontSize: 13, color: Brand.primary },
  add: {
    alignSelf: 'flex-end',
    marginTop: 2,
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    borderRadius: Radius.pill,
    backgroundColor: Brand.primary,
    overflow: 'hidden',
  },
  addText: { fontFamily: Fonts.sansMedium, fontSize: 13, color: Brand.white },
  pressed: { opacity: 0.85 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: Radius.pill, backgroundColor: Brand.surface },
  tagGold: { backgroundColor: Brand.primary },
  tagGreen: { backgroundColor: '#E3EBDD' },
  tagText: { fontFamily: Fonts.sansMedium, fontSize: 11, color: Brand.text },
  tagTextGold: { color: Brand.white },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  grow: { flex: 1 },
  empty: { gap: 4, padding: 16, borderRadius: Radius.card, backgroundColor: Brand.surface },
});
