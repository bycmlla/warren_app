import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BrandIcon } from '@/components/brand-icon';
import { CourseCard } from '@/components/course-card';
import { HomeHeader } from '@/components/home-header';
import { PrimaryButton } from '@/components/primary-button';
import { Brand, ContentWidth, Fonts, Gutter, Radius, Shadow } from '@/constants/brand';
import { isSectionId, sectionTitle, type SectionId } from '@/constants/sections';
import { useAuth } from '@/context/auth';
import { useAuthorizedQuery, usePublicQuery } from '@/hooks/use-authorized-query';
import { fetchMyCourses } from '@/services/commerce-api';
import { fetchCategories, fetchCourses, type CourseSummary } from '@/services/catalog-api';
import { errorMessage } from '@/utils/errors';

// Aba Explorar: o catálogo completo, com todos os cursos publicados (inclusive os de categorias
// ocultas da Home), busca por título, filtro por categoria e por "Meus cursos". A Home mostra só
// destaques e leva para cá pelos atalhos "Ver todas".
export default function ExploreScreen() {
  const params = useLocalSearchParams<{ section?: string; category?: string }>();
  const category = Number(params.category);
  return (
    <ExploreContent
      key={`${params.section ?? ''}:${params.category ?? ''}`}
      initialSection={isSectionId(params.section) ? params.section : undefined}
      initialCategory={Number.isInteger(category) && category > 0 ? category : undefined}
    />
  );
}

type Result = { key: string; items: CourseSummary[]; page: number; hasMore: boolean; error?: string };

function ExploreContent({
  initialSection,
  initialCategory,
}: {
  initialSection?: SectionId;
  initialCategory?: number;
}) {
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState(initialCategory);
  const [section, setSection] = useState(initialSection);
  const [onlyMine, setOnlyMine] = useState(false);
  const [result, setResult] = useState<Result>();
  const [attempt, setAttempt] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const searchInput = useRef<TextInput>(null);
  const filtersScroll = useRef<ScrollView>(null);
  const { width } = useWindowDimensions();
  const titleSize = Math.min(34, Math.max(26, Math.round(Math.min(width, ContentWidth) * 0.072)));
  const categories = usePublicQuery(fetchCategories);
  // Cursos adquiridos (compra aprovada ou liberação manual com acesso válido), por id. Só existe
  // para quem tem sessão; visitantes veem o catálogo sem o filtro e sem o selo de "adquirido".
  const { user } = useAuth();
  const mine = useAuthorizedQuery(fetchMyCourses);
  const owned = new Set(
    user ? (mine.data ?? []).filter((course) => course.situacao === 'ativo').map((course) => course.id) : []
  );

  // A busca só é enviada quando a pessoa para de digitar.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  // O resultado só vale para os filtros com que foi pedido; enquanto não chega, a tela carrega.
  const key = JSON.stringify([search, categoryId ?? null, section ?? null, attempt]);
  const current = result?.key === key ? result : undefined;

  useEffect(() => {
    let active = true;
    fetchCourses({ search, categoryId, section })
      .then((data) => {
        if (active) setResult({ key, items: data.cursos, page: 1, hasMore: data.temMais });
      })
      .catch((cause) => {
        if (active) setResult({ key, items: [], page: 0, hasMore: false, error: errorMessage(cause) });
      });
    return () => {
      active = false;
    };
  }, [key, search, categoryId, section]);

  const loadMore = async () => {
    if (!current || loadingMore) return;
    setLoadingMore(true);
    try {
      const data = await fetchCourses({ search, categoryId, section, page: current.page + 1 });
      setResult((latest) =>
        latest?.key === key
          ? { key, items: [...latest.items, ...data.cursos], page: data.pagina, hasMore: data.temMais }
          : latest
      );
    } catch {
      // Mantém o que já foi carregado; o botão continua disponível para tentar de novo.
    } finally {
      setLoadingMore(false);
    }
  };

  const filters = [{ id: undefined, nome: 'Todos' }, ...(categories.data ?? [])];
  const visible = current?.items.filter((course) => !onlyMine || owned.has(course.id)) ?? [];

  return (
    <View style={styles.screen}>
      <HomeHeader />
      <SafeAreaView edges={['left', 'right']} style={styles.body}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
          <Text
            accessibilityRole="header"
            style={[styles.title, { fontSize: titleSize, lineHeight: Math.round(titleSize * 1.22) }]}>
            Explorar
          </Text>
          <View style={styles.search}>
            <BrandIcon name="search" size={20} color={Brand.primary} />
            <TextInput
              ref={searchInput}
              accessibilityLabel="Buscar conteúdos"
              placeholder="Busque por título"
              placeholderTextColor={Brand.muted}
              selectionColor={Brand.primary}
              value={query}
              onChangeText={setQuery}
              returnKeyType="search"
              onSubmitEditing={() => searchInput.current?.blur()}
              style={styles.input}
            />
          </View>

          <ScrollView
            ref={filtersScroll}
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            style={styles.filtersRow}
            contentContainerStyle={styles.filters}>
            {user !== null && (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: onlyMine }}
                hitSlop={{ top: 4, bottom: 4 }}
                onPress={() => setOnlyMine((value) => !value)}
                style={({ pressed }) => [styles.filter, onlyMine && styles.selectedFilter, pressed && styles.pressed]}>
                <Text style={[styles.filterText, onlyMine && styles.selectedText]}>Meus cursos</Text>
              </Pressable>
            )}
            {filters.map((item) => {
              const selected = item.id === categoryId;
              return (
                <Pressable
                  key={item.id ?? 'todos'}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  hitSlop={{ top: 4, bottom: 4 }}
                  onPress={() => setCategoryId(item.id)}
                  onLayout={
                    item.id !== undefined && item.id === initialCategory
                      ? (event) =>
                          filtersScroll.current?.scrollTo({
                            x: event.nativeEvent.layout.x - Gutter,
                            animated: false,
                          })
                      : undefined
                  }
                  style={({ pressed }) => [
                    styles.filter,
                    selected && styles.selectedFilter,
                    pressed && styles.pressed,
                  ]}>
                  <Text style={[styles.filterText, selected && styles.selectedText]}>{item.nome}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {section !== undefined && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remover filtro da seção ${sectionTitle(section)}`}
              onPress={() => setSection(undefined)}
              style={({ pressed }) => [styles.sectionFilter, pressed && styles.pressed]}>
              <Text style={styles.sectionFilterText}>Seção: {sectionTitle(section)}</Text>
              <BrandIcon name="close" size={14} color={Brand.primaryDeep} />
            </Pressable>
          )}

          {current === undefined && (
            <View style={styles.center}>
              <ActivityIndicator color={Brand.primary} size="large" />
            </View>
          )}

          {current?.error !== undefined && (
            <View style={styles.notice}>
              <Text accessibilityLiveRegion="polite" style={styles.noticeText}>
                {current.error}
              </Text>
              <PrimaryButton
                variant="outline"
                label="Tentar novamente"
                onPress={() => setAttempt((value) => value + 1)}
              />
            </View>
          )}

          {current !== undefined && current.error === undefined && (
            <>
              <View style={styles.cards}>
                {visible.map((course) => (
                  <View key={course.id} style={styles.card}>
                    <CourseCard course={course} variant="large" owned={user?.role === 'ADMIN' ? undefined : owned.has(course.id)} />
                  </View>
                ))}
              </View>
              {visible.length === 0 && (
                <Text style={styles.empty}>
                  {onlyMine
                    ? current.hasMore
                      ? 'Nenhum curso seu nesta página. Toque em "Carregar mais" para continuar procurando.'
                      : 'Você ainda não tem cursos adquiridos com estes filtros.'
                    : search || categoryId !== undefined || section !== undefined
                    ? 'Nenhum conteúdo encontrado. Tente outra busca ou categoria.'
                    : 'Nenhum conteúdo publicado ainda.'}
                </Text>
              )}
              {current.hasMore && (
                <PrimaryButton variant="outline" label="Carregar mais" onPress={loadMore} loading={loadingMore} />
              )}
            </>
          )}
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
    paddingTop: 4,
    paddingBottom: 28,
    gap: 16,
  },
  title: { fontFamily: Fonts.serifMedium, color: Brand.text, marginBottom: 2 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 52,
    paddingHorizontal: 16,
    borderRadius: Radius.field,
    borderWidth: 1,
    borderColor: Brand.surface,
    backgroundColor: Brand.card,
    boxShadow: Shadow.field,
  },
  input: { flex: 1, fontFamily: Fonts.sans, fontSize: 15, color: Brand.text, paddingVertical: 12 },
  // A linha de filtros sangra até as bordas da tela para a rolagem horizontal.
  filtersRow: { marginHorizontal: -Gutter, flexGrow: 0 },
  filters: { paddingHorizontal: Gutter, gap: 8, alignItems: 'center' },
  filter: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Brand.primarySoft,
    backgroundColor: Brand.background,
  },
  selectedFilter: { backgroundColor: Brand.primary, borderColor: Brand.primary },
  filterText: { fontFamily: Fonts.sansMedium, fontSize: 13, color: Brand.text },
  selectedText: { color: Brand.white },
  sectionFilter: {
    alignSelf: 'flex-start',
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    borderRadius: Radius.pill,
    backgroundColor: Brand.surface,
  },
  sectionFilterText: { fontFamily: Fonts.sansMedium, fontSize: 12.5, color: Brand.primaryDeep },
  center: { paddingVertical: 48, alignItems: 'center' },
  notice: { gap: 12, padding: 16, borderRadius: Radius.card, backgroundColor: Brand.surfaceSoft },
  noticeText: { fontFamily: Fonts.sans, fontSize: 13.5, lineHeight: 20, color: Brand.text },
  cards: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, paddingTop: 4 },
  card: { flexGrow: 1, flexBasis: 220, maxWidth: 420 },
  empty: { fontFamily: Fonts.sans, fontSize: 15, lineHeight: 23, color: Brand.muted, paddingTop: 8 },
  pressed: { opacity: 0.7 },
});
