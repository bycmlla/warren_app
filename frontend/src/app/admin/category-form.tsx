import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { AdminOnly } from '@/components/admin-only';
import { AdminScaffold, QueryState, errorMessage } from '@/components/admin-scaffold';
import type { IconName } from '@/components/brand-icon';
import { ChoiceChips, FormError, SwitchRow, TextField } from '@/components/form';
import { PrimaryButton } from '@/components/primary-button';
import { useAuth } from '@/context/auth';
import { useAuthorizedQuery } from '@/hooks/use-authorized-query';
import {
  createCategory,
  fetchAdminCategories,
  updateCategory,
  type AdminCategory,
} from '@/services/admin-api';

const icons: { value: IconName | null; label: string; icon?: IconName }[] = [
  { value: null, label: 'Sem ícone' },
  { value: 'lotus', label: 'Lótus', icon: 'lotus' },
  { value: 'sparkle', label: 'Brilho', icon: 'sparkle' },
  { value: 'sun', label: 'Sol', icon: 'sun' },
  { value: 'moon', label: 'Lua', icon: 'moon' },
  { value: 'leaf', label: 'Folha', icon: 'leaf' },
  { value: 'heart', label: 'Coração', icon: 'heart' },
  { value: 'star', label: 'Estrela', icon: 'star' },
  { value: 'music', label: 'Música', icon: 'music' },
];

export default function CategoryFormScreen() {
  return (
    <AdminOnly>
      <Loader />
    </AdminOnly>
  );
}

function Loader() {
  const params = useLocalSearchParams<{ id?: string }>();
  const id = params.id ? Number(params.id) : undefined;
  const { data, error, loading, reload } = useAuthorizedQuery(fetchAdminCategories);
  const category = data?.find((item) => item.id === id);

  if (id === undefined) return <CategoryForm />;
  if (category) return <CategoryForm key={category.id} category={category} />;
  return (
    <AdminScaffold title="Editar categoria">
      <QueryState
        loading={loading}
        error={error ?? (data ? 'Categoria não encontrada.' : undefined)}
        hasData={false}
        onRetry={reload}
      />
    </AdminScaffold>
  );
}

function CategoryForm({ category }: { category?: AdminCategory }) {
  const { authorized } = useAuth();
  const [nome, setNome] = useState(category?.nome ?? '');
  const [descricao, setDescricao] = useState(category?.descricao ?? '');
  const [icone, setIcone] = useState<IconName | null>(category?.icone ?? null);
  const [mostrarHome, setMostrarHome] = useState(category?.mostrarHome ?? true);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (saving) return;
    if (!nome.trim()) return setError('Informe o nome da categoria.');
    setError(undefined);
    setSaving(true);
    const body = { nome: nome.trim(), descricao: descricao.trim() || null, icone, mostrarHome };
    try {
      await authorized((token) =>
        category ? updateCategory(token, category.id, body) : createCategory(token, body)
      );
      router.back();
    } catch (cause) {
      setError(errorMessage(cause));
      setSaving(false);
    }
  };

  return (
    <AdminScaffold title={category ? 'Editar categoria' : 'Nova categoria'}>
      <TextField label="Nome" value={nome} onChangeText={setNome} maxLength={100} />
      <TextField
        label="Descrição (opcional)"
        value={descricao}
        onChangeText={setDescricao}
        maxLength={500}
        multiline
      />
      <ChoiceChips label="Ícone (opcional)" options={icons} value={icone} onChange={setIcone} />
      <SwitchRow
        label="Mostrar na Home"
        description="Categorias ocultas da Home continuam disponíveis em Explorar conteúdos."
        value={mostrarHome}
        onValueChange={setMostrarHome}
      />
      {error !== undefined && <FormError message={error} />}
      <PrimaryButton label={category ? 'Salvar alterações' : 'Criar categoria'} onPress={save} loading={saving} />
    </AdminScaffold>
  );
}
