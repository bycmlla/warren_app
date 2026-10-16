import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { AdminOnly } from '@/components/admin-only';
import { AdminScaffold, QueryState, confirmAction, errorMessage } from '@/components/admin-scaffold';
import { BrandIcon } from '@/components/brand-icon';
import { ChoiceChips, FormError, SmallButton } from '@/components/form';
import { PrimaryButton } from '@/components/primary-button';
import { fileUrl } from '@/constants/api';
import { Brand, Fonts, Gutter, Radius, Shadow } from '@/constants/brand';
import { useAuth } from '@/context/auth';
import { useAuthorizedQuery } from '@/hooks/use-authorized-query';
import {
  deleteCourse,
  fetchAdminCourses,
  setCourseStatus,
  statusLabels,
  type AdminCourse,
  type CourseStatus,
} from '@/services/admin-api';
import { ApiError } from '@/services/auth-api';
import { publishError } from '@/utils/errors';
import { formatLessons } from '@/utils/format';

const statusFilters: { value: CourseStatus | null; label: string }[] = [
  { value: null, label: 'Todos' },
  { value: 'publicado', label: 'Publicados' },
  { value: 'rascunho', label: 'Rascunhos' },
  { value: 'arquivado', label: 'Arquivados' },
];

const normalize = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

export default function AdminCoursesScreen() {
  return (
    <AdminOnly>
      <AdminCourses />
    </AdminOnly>
  );
}

function AdminCourses() {
  const { authorized } = useAuth();
  const { data, error, loading, reload } = useAuthorizedQuery(fetchAdminCourses);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<CourseStatus | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [notice, setNotice] = useState<string>();

  const categories = [...new Set((data ?? []).map((course) => course.categoria).filter((name) => name !== null))];
  const filtered = (data ?? []).filter(
    (course) =>
      (status === null || course.status === status) &&
      (category === null || course.categoria === category) &&
      normalize(course.titulo).includes(normalize(query.trim()))
  );

  const run = async (action: (token: string) => Promise<unknown>, format = errorMessage) => {
    setNotice(undefined);
    try {
      await authorized(action);
    } catch (cause) {
      setNotice(format(cause));
    }
    reload();
  };

  const changeStatus = (course: AdminCourse, next: CourseStatus) =>
    run((token) => setCourseStatus(token, course.id, next), publishError);

  const remove = async (course: AdminCourse) => {
    setNotice(undefined);
    try {
      await authorized((token) => deleteCourse(token, course.id));
    } catch (cause) {
      // Curso já iniciado por alunos: em vez de excluir, oferece arquivar.
      if (cause instanceof ApiError && cause.status === 409) {
        Alert.alert('Curso com alunos', cause.message, [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Arquivar curso', onPress: () => changeStatus(course, 'arquivado') },
        ]);
        return;
      }
      setNotice(errorMessage(cause));
    }
    reload();
  };

  return (
    <AdminScaffold
      title="Gerenciar cursos"
      subtitle={
        data && data.length > 0
          ? data.length === 1
            ? '1 curso cadastrado'
            : `${data.length} cursos cadastrados`
          : undefined
      }
      refreshing={loading && data !== undefined}
      onRefresh={reload}>
      <PrimaryButton label="Adicionar curso" onPress={() => router.push('/admin/course-form')} />

      {data !== undefined && data.length > 0 && (
        <>
          <View style={styles.search}>
            <BrandIcon name="search" size={18} color={Brand.primary} />
            <TextInput
              accessibilityLabel="Pesquisar cursos"
              placeholder="Pesquisar por título"
              placeholderTextColor={Brand.muted}
              selectionColor={Brand.primary}
              value={query}
              onChangeText={setQuery}
              style={styles.searchInput}
            />
          </View>
          <ChoiceChips label="Status" options={statusFilters} value={status} onChange={setStatus} />
          {categories.length > 0 && (
            <View style={styles.filterGroup}>
              <Text style={styles.filterLabel}>Categoria</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                style={styles.bleed}
                contentContainerStyle={styles.bleedContent}>
                <ChoiceChips
                  options={[{ value: null, label: 'Todas' }, ...categories.map((name) => ({ value: name, label: name }))]}
                  value={category}
                  onChange={setCategory}
                />
              </ScrollView>
            </View>
          )}
        </>
      )}

      {notice !== undefined && <FormError message={notice} />}
      <QueryState loading={loading} error={error} hasData={data !== undefined} onRetry={reload} />

      {data?.length === 0 && (
        <View style={styles.empty}>
          <View style={styles.emptyIcon}>
            <BrandIcon name="library" size={28} strokeWidth={1.3} />
          </View>
          <Text style={styles.emptyTitle}>Nenhum curso cadastrado ainda.</Text>
          <Text style={styles.detail}>Os cursos cadastrados aparecerão aqui, com status e destaque.</Text>
        </View>
      )}
      {data !== undefined && data.length > 0 && filtered.length === 0 && (
        <Text style={styles.detail}>Nenhum curso encontrado com esses filtros.</Text>
      )}

      {filtered.map((course) => {
        const cover = fileUrl(course.imagemCapa);
        return (
          <View key={course.id} style={styles.card}>
            <View style={styles.cardTop}>
              {cover ? (
                <Image source={{ uri: cover }} contentFit="cover" accessible={false} style={styles.cover} />
              ) : (
                <View style={[styles.cover, styles.noCover]}>
                  <BrandIcon name="library" size={22} strokeWidth={1.3} color={Brand.muted} />
                </View>
              )}
              <View style={styles.cardBody}>
                <Text numberOfLines={2} style={styles.cardTitle}>
                  {course.titulo}
                </Text>
                <Text numberOfLines={1} style={styles.detail}>
                  {[course.categoria ?? 'Sem categoria', formatLessons(course.totalAulas)].join(' · ')}
                </Text>
                <View style={styles.tags}>
                  <View style={[styles.tag, course.status === 'publicado' && styles.publishedTag]}>
                    <Text style={[styles.tagText, course.status === 'publicado' && styles.publishedText]}>
                      {statusLabels[course.status]}
                    </Text>
                  </View>
                  {course.destaque && (
                    <View style={[styles.tag, styles.featuredTag]}>
                      <BrandIcon name="star" size={11} filled />
                      <Text style={[styles.tagText, styles.featuredText]}>Destaque</Text>
                    </View>
                  )}
                </View>
              </View>
            </View>
            <View style={styles.actions}>
              <SmallButton
                icon="edit"
                label="Editar"
                onPress={() => router.push({ pathname: '/admin/course-form', params: { id: String(course.id) } })}
              />
              <SmallButton
                icon="library"
                label="Aulas"
                onPress={() =>
                  router.push({ pathname: '/admin/course-content', params: { id: String(course.id) } })
                }
              />
              {course.status === 'publicado' ? (
                <SmallButton label="Despublicar" onPress={() => changeStatus(course, 'rascunho')} />
              ) : (
                <SmallButton icon="check" label="Publicar" onPress={() => changeStatus(course, 'publicado')} />
              )}
              <SmallButton
                icon="trash"
                tone="danger"
                label="Excluir"
                onPress={() =>
                  confirmAction(
                    'Excluir curso',
                    `Excluir "${course.titulo}" com todos os módulos e aulas? Esta ação não pode ser desfeita.`,
                    'Excluir',
                    () => remove(course)
                  )
                }
              />
            </View>
          </View>
        );
      })}
    </AdminScaffold>
  );
}

const styles = StyleSheet.create({
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 50,
    paddingHorizontal: 16,
    borderRadius: Radius.field,
    borderWidth: 1,
    borderColor: Brand.surface,
    backgroundColor: Brand.card,
  },
  searchInput: { flex: 1, fontFamily: Fonts.sans, fontSize: 15, color: Brand.text, paddingVertical: 10 },
  filterGroup: { gap: 6 },
  filterLabel: { fontFamily: Fonts.sansMedium, fontSize: 12.5, color: Brand.text },
  bleed: { marginHorizontal: -Gutter, flexGrow: 0 },
  bleedContent: { paddingHorizontal: Gutter },
  detail: { fontFamily: Fonts.sans, fontSize: 12.5, lineHeight: 18, color: Brand.muted },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 40 },
  emptyIcon: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: Brand.surfaceSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    alignSelf: 'stretch',
    fontFamily: Fonts.serifMedium,
    fontSize: 20,
    lineHeight: 26,
    color: Brand.text,
    textAlign: 'center',
  },
  card: {
    gap: 12,
    padding: 10,
    borderRadius: Radius.card,
    backgroundColor: Brand.card,
    boxShadow: Shadow.card,
  },
  cardTop: { flexDirection: 'row', gap: 14 },
  cover: { width: 84, height: 84, borderRadius: 12, backgroundColor: Brand.surface },
  noCover: { alignItems: 'center', justifyContent: 'center', backgroundColor: Brand.surfaceSoft },
  cardBody: { flex: 1, justifyContent: 'center', gap: 4, paddingRight: 4 },
  cardTitle: { fontFamily: Fonts.serif, fontSize: 17, lineHeight: 22, color: Brand.text },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: Radius.pill,
    backgroundColor: Brand.surface,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  tagText: { fontFamily: Fonts.sansMedium, fontSize: 11, color: Brand.text },
  publishedTag: { backgroundColor: Brand.primary },
  publishedText: { color: Brand.white },
  featuredTag: { backgroundColor: 'transparent', borderWidth: 1, borderColor: Brand.primarySoft },
  featuredText: { color: Brand.primaryDeep },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
