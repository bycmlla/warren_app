import { router, type Href } from 'expo-router';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AdminOnly } from '@/components/admin-only';
import { Avatar } from '@/components/avatar';
import { BrandIcon, type IconName } from '@/components/brand-icon';
import { HomeHeader } from '@/components/home-header';
import { PrimaryButton } from '@/components/primary-button';
import { Brand, ContentWidth, Fonts, Gutter, Radius, Shadow } from '@/constants/brand';
import { useAuth } from '@/context/auth';
import { useAuthorizedQuery } from '@/hooks/use-authorized-query';
import { fetchCourseStats, type CourseStats } from '@/services/admin-api';

// Indicadores da faixa de resumo: número real do backend e um nome curto.
const indicators: { key: keyof CourseStats; label: string; description: string }[] = [
  { key: 'total', label: 'Cursos', description: 'Total de cursos' },
  { key: 'publicados', label: 'Publicados', description: 'Cursos publicados' },
  { key: 'rascunhos', label: 'Rascunhos', description: 'Cursos em rascunho' },
  { key: 'destaques', label: 'Destaques', description: 'Cursos em destaque' },
];

type Shortcut = { icon: IconName; title: string; description: string; href: Href };

// Atalhos agrupados por finalidade. "Adicionar curso" é o botão principal, acima das listas.
const groups: { title: string; items: Shortcut[] }[] = [
  {
    title: 'Gerenciamento',
    items: [
      {
        icon: 'library',
        title: 'Gerenciar cursos',
        description: 'Edite, publique e organize módulos e aulas',
        href: '/admin/courses',
      },
      {
        icon: 'tag',
        title: 'Gerenciar categorias',
        description: 'Organize os cursos e o que aparece na Home',
        href: '/admin/categories',
      },
      {
        icon: 'receipt',
        title: 'Vendas e acessos',
        description: 'Consulte compras e libere ou revogue cursos',
        href: '/admin/sales',
      },
    ],
  },
  {
    title: 'Personalização',
    items: [
      {
        icon: 'sparkle',
        title: 'Banners da página inicial',
        description: 'Carrossel da Home: imagens, ordem e botão',
        href: '/admin/home-banners',
      },
    ],
  },
  {
    title: 'Aplicativo',
    items: [
      {
        icon: 'phone',
        title: 'Visualizar aplicativo',
        description: 'Veja a área pública como os alunos',
        href: '/',
      },
    ],
  },
];

export default function PanelScreen() {
  return (
    <AdminOnly>
      <Panel />
    </AdminOnly>
  );
}

function Panel() {
  const { user } = useAuth();
  const stats = useAuthorizedQuery(fetchCourseStats);
  if (!user) return null;

  const firstName = user.nome.trim().split(/\s+/)[0];
  // "/" é uma aba (troca de aba, sem sair da sessão); as demais telas abrem sobre as abas.
  const open = (href: Href) => (href === '/' ? router.navigate(href) : router.push(href));

  return (
    <View style={styles.screen}>
      <HomeHeader />
      <SafeAreaView edges={['left', 'right']} style={styles.body}>
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={stats.loading && stats.data !== undefined}
              onRefresh={stats.reload}
              colors={[Brand.primary]}
              tintColor={Brand.primary}
            />
          }>
          <View style={styles.intro}>
            <View style={styles.introText}>
              <Text style={styles.greeting}>Olá, {firstName}!</Text>
              <Text accessibilityRole="header" style={styles.title}>
                Painel Administrativo
              </Text>
              <Text style={styles.subtitle}>Gerencie seu aplicativo.</Text>
            </View>
            <Avatar name={user.nome} photoUrl={user.fotoPerfil} size={40} />
          </View>

          {stats.error !== undefined && stats.data === undefined ? (
            <View style={styles.notice}>
              <Text accessibilityLiveRegion="polite" style={styles.noticeText}>
                {stats.error}
              </Text>
              <PrimaryButton variant="outline" label="Tentar novamente" onPress={stats.reload} />
            </View>
          ) : (
            <View style={styles.stats}>
              {indicators.map((indicator, index) => (
                <View
                  key={indicator.key}
                  accessible
                  accessibilityLabel={`${indicator.description}: ${stats.data ? stats.data[indicator.key] : 'carregando'}`}
                  style={[styles.stat, index > 0 && styles.statDivider]}>
                  <Text style={[styles.statValue, !stats.data && styles.statPending]}>
                    {stats.data ? stats.data[indicator.key] : '–'}
                  </Text>
                  <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={styles.statLabel}>
                    {indicator.label}
                  </Text>
                </View>
              ))}
            </View>
          )}
          {stats.error !== undefined && stats.data !== undefined && (
            <Text accessibilityLiveRegion="polite" style={styles.staleText}>
              Não foi possível atualizar os indicadores. Puxe a tela para tentar novamente.
            </Text>
          )}

          <PrimaryButton label="Adicionar curso" onPress={() => open('/admin/course-form')} />

          {groups.map((group) => (
            <View key={group.title} style={styles.section}>
              <Text accessibilityRole="header" style={styles.heading}>
                {group.title}
              </Text>
              <View style={styles.list}>
                {group.items.map((item, index) => (
                  <Pressable
                    key={item.title}
                    accessibilityRole="button"
                    accessibilityLabel={`${item.title}. ${item.description}`}
                    onPress={() => open(item.href)}
                    android_ripple={{ color: Brand.surface }}
                    style={({ pressed }) => [styles.row, index > 0 && styles.rowDivider, pressed && styles.pressed]}>
                    <View style={styles.iconCircle}>
                      <BrandIcon name={item.icon} size={17} strokeWidth={1.4} />
                    </View>
                    <View style={styles.rowText}>
                      <Text style={styles.rowTitle}>{item.title}</Text>
                      <Text numberOfLines={2} style={styles.rowDescription}>
                        {item.description}
                      </Text>
                    </View>
                    <BrandIcon name="chevron" size={18} color={Brand.muted} />
                  </Pressable>
                ))}
              </View>
            </View>
          ))}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Brand.background },
  body: { flex: 1 },
  content: {
    width: '100%',
    maxWidth: ContentWidth,
    alignSelf: 'center',
    paddingHorizontal: Gutter,
    paddingTop: 2,
    paddingBottom: 24,
    gap: 16,
  },
  intro: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  introText: { flex: 1, gap: 1 },
  greeting: { fontFamily: Fonts.sansMedium, fontSize: 12.5, lineHeight: 17, color: Brand.primaryDeep },
  title: { fontFamily: Fonts.serifMedium, fontSize: 23, lineHeight: 29, color: Brand.text },
  subtitle: { fontFamily: Fonts.sans, fontSize: 13, lineHeight: 18, color: Brand.muted },
  // Faixa única com os quatro indicadores lado a lado.
  stats: {
    flexDirection: 'row',
    paddingVertical: 14,
    borderRadius: Radius.card,
    backgroundColor: Brand.card,
    boxShadow: Shadow.field,
  },
  stat: { flex: 1, alignItems: 'center', gap: 2, paddingHorizontal: 4 },
  statDivider: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: Brand.primarySoft },
  // Algarismos alinhados: no estilo antigo da Playfair o zero se confunde com a letra O.
  statValue: {
    fontFamily: Fonts.serifMedium,
    fontVariant: ['lining-nums', 'tabular-nums'],
    fontSize: 24,
    lineHeight: 30,
    color: Brand.text,
  },
  statPending: { color: Brand.muted },
  statLabel: { fontFamily: Fonts.sans, fontSize: 11.5, lineHeight: 16, color: Brand.muted },
  notice: { gap: 12, padding: 14, borderRadius: Radius.card, backgroundColor: Brand.surfaceSoft },
  noticeText: { fontFamily: Fonts.sans, fontSize: 13.5, lineHeight: 20, color: Brand.text },
  staleText: { fontFamily: Fonts.sans, fontSize: 12, lineHeight: 17, color: Brand.muted, marginTop: -8 },
  section: { gap: 8, marginTop: 4 },
  heading: { fontFamily: Fonts.serifMedium, fontSize: 18, lineHeight: 24, color: Brand.text },
  list: {
    borderRadius: Radius.card,
    backgroundColor: Brand.card,
    boxShadow: Shadow.field,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 64,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Brand.primarySoft },
  iconCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: Brand.surfaceSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1, gap: 1 },
  rowTitle: { fontFamily: Fonts.sansMedium, fontSize: 14.5, lineHeight: 20, color: Brand.text },
  rowDescription: { fontFamily: Fonts.sans, fontSize: 12.5, lineHeight: 17, color: Brand.muted },
  pressed: { opacity: 0.75 },
});
