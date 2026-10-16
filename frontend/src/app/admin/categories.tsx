import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { AdminOnly } from '@/components/admin-only';
import { AdminScaffold, QueryState, confirmAction, errorMessage } from '@/components/admin-scaffold';
import { BrandIcon } from '@/components/brand-icon';
import { FormError, IconButton, SwitchRow } from '@/components/form';
import { PrimaryButton } from '@/components/primary-button';
import { Brand, Fonts, Radius, Shadow } from '@/constants/brand';
import { useAuth } from '@/context/auth';
import { useAuthorizedQuery } from '@/hooks/use-authorized-query';
import {
  deleteCategory,
  fetchAdminCategories,
  reorderCategories,
  updateCategory,
  type AdminCategory,
} from '@/services/admin-api';
import { ApiError } from '@/services/auth-api';

export default function AdminCategoriesScreen() {
  return (
    <AdminOnly>
      <Categories />
    </AdminOnly>
  );
}

const courseCount = (count: number) => (count === 1 ? '1 curso' : `${count} cursos`);

function Categories() {
  const { authorized } = useAuth();
  const { data, error, loading, reload } = useAuthorizedQuery(fetchAdminCategories);
  const [notice, setNotice] = useState<string>();
  // Alteração já aplicada na tela enquanto o backend confirma; vale só para a lista atual.
  const [draft, setDraft] = useState<{ base: AdminCategory[]; items: AdminCategory[] }>();
  const items = draft !== undefined && draft.base === data ? draft.items : data;

  const apply = async (next: AdminCategory[], action: (token: string) => Promise<unknown>) => {
    if (data) setDraft({ base: data, items: next });
    setNotice(undefined);
    try {
      await authorized(action);
    } catch (cause) {
      setNotice(errorMessage(cause));
    }
    reload();
  };

  const move = (index: number, delta: -1 | 1) => {
    if (!items) return;
    const next = [...items];
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    apply(next, (token) => reorderCategories(token, next.map((category) => category.id)));
  };

  const toggleHome = (category: AdminCategory, mostrarHome: boolean) => {
    if (!items) return;
    apply(
      items.map((item) => (item.id === category.id ? { ...item, mostrarHome } : item)),
      (token) => updateCategory(token, category.id, { mostrarHome })
    );
  };

  const remove = async (category: AdminCategory, unlink: boolean) => {
    setNotice(undefined);
    try {
      await authorized((token) => deleteCategory(token, category.id, unlink));
    } catch (cause) {
      // Há cursos vinculados: a exclusão só segue com a confirmação de desvinculá-los.
      if (cause instanceof ApiError && cause.status === 409 && typeof cause.data.cursos === 'number') {
        Alert.alert(
          'Categoria com cursos',
          `${cause.message} Se você excluir a categoria, ${cause.data.cursos === 1 ? 'esse curso ficará' : 'esses cursos ficarão'} sem categoria até você escolher outra.`,
          [
            { text: 'Cancelar', style: 'cancel' },
            { text: 'Excluir mesmo assim', style: 'destructive', onPress: () => remove(category, true) },
          ]
        );
        return;
      }
      setNotice(errorMessage(cause));
    }
    reload();
  };

  return (
    <AdminScaffold
      title="Gerenciar categorias"
      subtitle="Organize os cursos e escolha quais categorias aparecem na Home."
      refreshing={loading && data !== undefined}
      onRefresh={reload}>
      <PrimaryButton label="Nova categoria" onPress={() => router.push('/admin/category-form')} />
      {notice !== undefined && <FormError message={notice} />}
      <QueryState loading={loading} error={error} hasData={data !== undefined} onRetry={reload} />

      {items?.length === 0 && (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Nenhuma categoria cadastrada ainda.</Text>
          <Text style={styles.detail}>Crie a primeira categoria para organizar os cursos.</Text>
        </View>
      )}

      {items?.map((category, index) => (
        <View key={category.id} style={styles.card}>
          <View style={styles.row}>
            <View style={styles.iconCircle}>
              <BrandIcon name={category.icone ?? 'tag'} size={18} strokeWidth={1.4} />
            </View>
            <View style={styles.text}>
              <Text style={styles.name}>{category.nome}</Text>
              <Text style={styles.detail}>
                {category.totalCursos === 0
                  ? 'Nenhum curso'
                  : `${courseCount(category.totalCursos)} · ${category.cursosPublicados} ${category.cursosPublicados === 1 ? 'publicado' : 'publicados'}`}
              </Text>
            </View>
            <IconButton
              icon="up"
              label={`Mover ${category.nome} para cima`}
              disabled={index === 0}
              onPress={() => move(index, -1)}
            />
            <IconButton
              icon="down"
              label={`Mover ${category.nome} para baixo`}
              disabled={index === items.length - 1}
              onPress={() => move(index, 1)}
            />
          </View>
          {category.descricao !== null && <Text style={styles.detail}>{category.descricao}</Text>}
          <SwitchRow
            label="Mostrar na Home"
            description={
              category.mostrarHome && category.cursosPublicados === 0
                ? 'Aparecerá quando tiver ao menos um curso publicado.'
                : undefined
            }
            value={category.mostrarHome}
            onValueChange={(value) => toggleHome(category, value)}
          />
          <View style={styles.actions}>
            <IconButton
              icon="edit"
              label={`Editar ${category.nome}`}
              onPress={() =>
                router.push({ pathname: '/admin/category-form', params: { id: String(category.id) } })
              }
            />
            <IconButton
              icon="trash"
              tone="danger"
              label={`Excluir ${category.nome}`}
              onPress={() =>
                confirmAction(
                  'Excluir categoria',
                  `Excluir a categoria "${category.nome}"? Esta ação não pode ser desfeita.`,
                  'Excluir',
                  () => remove(category, false)
                )
              }
            />
          </View>
        </View>
      ))}
    </AdminScaffold>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 10,
    padding: 14,
    borderRadius: Radius.card,
    backgroundColor: Brand.card,
    boxShadow: Shadow.card,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: Brand.surfaceSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, gap: 2 },
  name: { fontFamily: Fonts.serif, fontSize: 17, lineHeight: 22, color: Brand.text },
  detail: { fontFamily: Fonts.sans, fontSize: 12.5, lineHeight: 18, color: Brand.muted },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  empty: { alignItems: 'center', gap: 6, paddingVertical: 36 },
  emptyTitle: {
    alignSelf: 'stretch',
    fontFamily: Fonts.serifMedium,
    fontSize: 19,
    lineHeight: 25,
    color: Brand.text,
    textAlign: 'center',
  },
});
