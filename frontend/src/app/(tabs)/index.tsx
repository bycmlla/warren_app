import { router } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BrandIcon } from '@/components/brand-icon';
import { CourseCard } from '@/components/course-card';
import { HomeHeader } from '@/components/home-header';
import { HeroCarousel } from '@/components/hero-carousel';
import { PrimaryButton } from '@/components/primary-button';
import { fileUrl } from '@/constants/api';
import { Brand, ContentWidth, Fonts, Gutter, Radius } from '@/constants/brand';
import { sectionTitle, type SectionId } from '@/constants/sections';
import { usePublicQuery } from '@/hooks/use-authorized-query';
import { prefetchTints } from '@/hooks/use-image-tint';
import { fetchHome } from '@/services/catalog-api';

const HERO_MARGIN = 16;
const CARD_GAP = 12;
const CATEGORY_GAP = 10;

/** Abre o catálogo completo, opcionalmente já filtrado por seção ou categoria. */
const explore = (filter: { section?: SectionId; category?: number } = {}) =>
  router.navigate({
    pathname: '/explore',
    params: {
      section: filter.section ?? '',
      category: filter.category !== undefined ? String(filter.category) : '',
    },
  });

export default function HomeScreen() {
  const { width } = useWindowDimensions();
  const contentWidth = Math.min(width, ContentWidth);
  // Dois cartões inteiros e o início do terceiro, para indicar a rolagem horizontal.
  const cardWidth = Math.min(240, Math.max(150, (contentWidth - Gutter - CARD_GAP * 2) / 2.25));
  const titleSize = Math.min(21, Math.max(18, contentWidth * 0.051));
  const titleStyle = [styles.sectionTitle, { fontSize: titleSize, lineHeight: Math.round(titleSize * 1.34) }];
  const { data, error, reload } = usePublicQuery(fetchHome);

  // Com a lista carregada, as cores dos banners são lidas com antecedência (uma vez por imagem):
  // ao abrir um curso, o topo da tela já sai pronto, sem espera.
  useEffect(() => {
    if (!data) return;
    prefetchTints(
      data.secoes.flatMap((section) =>
        section.cursos.map((course) => fileUrl(course.imagemBanner) ?? fileUrl(course.imagemCapa))
      )
    );
  }, [data]);

  const filledSections = (data?.secoes ?? []).filter((section) => section.cursos.length > 0);
  const categories = data?.categorias ?? [];
  const empty = data !== undefined && filledSections.length === 0 && categories.length === 0;

  return (
    <View style={styles.screen}>
      <HomeHeader />
      <SafeAreaView edges={['left', 'right']} style={styles.body}>
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <View style={styles.content}>
            <View style={styles.heroWrap}>
              <HeroCarousel
                width={contentWidth - HERO_MARGIN * 2}
                slides={data?.carrossel}
                onExplore={() => explore()}
              />
            </View>

            {error !== undefined && data === undefined && (
              <View style={styles.notice}>
                <Text accessibilityLiveRegion="polite" style={styles.noticeText}>
                  {error}
                </Text>
                <PrimaryButton variant="outline" label="Tentar novamente" onPress={reload} />
              </View>
            )}

            {categories.length > 0 && (
              <View style={styles.section}>
                <SectionHeader title="Categorias" titleStyle={titleStyle} label="Ver todas" onPress={() => explore()} />
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.categories}>
                  {categories.map((category) => (
                    <Pressable
                      key={category.id}
                      accessibilityRole="button"
                      accessibilityLabel={`Ver cursos de ${category.nome}`}
                      onPress={() => explore({ category: category.id })}
                      style={({ pressed }) => [styles.categoryCard, pressed && styles.pressed]}>
                      <BrandIcon name={category.icone ?? 'tag'} size={26} strokeWidth={1.25} />
                      <Text numberOfLines={1} style={styles.categoryLabel}>
                        {category.nome}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            )}

            {filledSections.map((section) => (
              <View key={section.id} style={styles.section}>
                <SectionHeader
                  title={sectionTitle(section.id)}
                  titleStyle={titleStyle}
                  label="Ver todas"
                  onPress={() => explore({ section: section.id })}
                />
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={styles.row}
                  contentContainerStyle={styles.cards}>
                  {section.cursos.map((course) => (
                    <CourseCard key={course.id} course={course} width={cardWidth} />
                  ))}
                </ScrollView>
              </View>
            ))}

            {empty && (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>Novos conteúdos em breve.</Text>
                <Text style={styles.emptyText}>
                  Os cursos e práticas aparecerão aqui assim que forem publicados.
                </Text>
              </View>
            )}

          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function SectionHeader({
  title,
  titleStyle,
  label,
  onPress,
}: {
  title: string;
  titleStyle: object[];
  label: string;
  onPress: () => void;
}) {
  return (
    <View style={styles.sectionHeader}>
      <Text accessibilityRole="header" style={titleStyle}>
        {title}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${title}`}
        onPress={onPress}
        style={({ pressed }) => [styles.seeAll, pressed && styles.pressed]}>
        <Text style={styles.seeAllText}>{label}</Text>
        <BrandIcon name="arrow" size={14} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Brand.background },
  body: { flex: 1 },
  scrollContent: { flexGrow: 1, paddingBottom: 28 },
  content: { width: '100%', maxWidth: ContentWidth, alignSelf: 'center' },
  heroWrap: { paddingHorizontal: HERO_MARGIN, paddingTop: 4 },
  section: { paddingTop: 22 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: Gutter,
  },
  sectionTitle: { fontFamily: Fonts.serifMedium, color: Brand.text, flexShrink: 1 },
  seeAll: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 5,
  },
  seeAllText: { fontFamily: Fonts.sansMedium, fontSize: 12.5, color: Brand.primaryDeep },
  // O respiro vertical evita que a sombra dos cartões seja cortada pela rolagem horizontal.
  row: { marginBottom: -14 },
  cards: {
    paddingHorizontal: Gutter,
    paddingTop: 6,
    paddingBottom: 22,
    gap: CARD_GAP,
    alignItems: 'stretch',
  },
  categories: { paddingHorizontal: Gutter, paddingTop: 6, gap: CATEGORY_GAP },
  categoryCard: {
    minWidth: 92,
    minHeight: 84,
    borderRadius: Radius.tile,
    backgroundColor: Brand.surfaceSoft,
    paddingVertical: 14,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  categoryLabel: { fontFamily: Fonts.sans, fontSize: 11.5, color: Brand.text, textAlign: 'center' },
  notice: {
    gap: 12,
    padding: 16,
    marginTop: 22,
    marginHorizontal: Gutter,
    borderRadius: Radius.card,
    backgroundColor: Brand.surfaceSoft,
  },
  noticeText: { fontFamily: Fonts.sans, fontSize: 13.5, lineHeight: 20, color: Brand.text },
  empty: { alignItems: 'center', gap: 6, paddingTop: 36, paddingHorizontal: Gutter + 8 },
  emptyTitle: {
    alignSelf: 'stretch',
    fontFamily: Fonts.serifMedium,
    fontSize: 20,
    lineHeight: 26,
    color: Brand.text,
    textAlign: 'center',
  },
  emptyText: {
    fontFamily: Fonts.sans,
    fontSize: 14,
    lineHeight: 21,
    color: Brand.muted,
    textAlign: 'center',
    maxWidth: 300,
  },
  pressed: { opacity: 0.7 },
});
