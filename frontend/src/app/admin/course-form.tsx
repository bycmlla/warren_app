import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { StyleSheet, Text, View, type ScrollView } from 'react-native';

import { AdminOnly } from '@/components/admin-only';
import { CourseStudentsEditor, type PreparedAccessChanges } from '@/components/access-selection';
import { AdminScaffold, QueryState, errorMessage } from '@/components/admin-scaffold';
import { ChoiceChips, FormError, ImageField, SmallButton, SwitchRow, TextField } from '@/components/form';
import { PrimaryButton } from '@/components/primary-button';
import { Brand, Fonts, Radius } from '@/constants/brand';
import { sections, type SectionId } from '@/constants/sections';
import { useAuth } from '@/context/auth';
import { useAuthorizedQuery } from '@/hooks/use-authorized-query';
import {
  createCourse,
  fetchAdminCategories,
  fetchAdminCourse,
  fetchSalesSummary,
  setCourseStatus,
  statusLabels,
  updateCourse,
  type AdminCategory,
  type AdminCourse,
  type CourseInput,
} from '@/services/admin-api';
import { ApiError } from '@/services/auth-api';
import type { AccessType } from '@/services/catalog-api';
import { publishError } from '@/utils/errors';
import { formatMoney, moneyInput, parseMoney } from '@/utils/format';

export default function CourseFormScreen() {
  return (
    <AdminOnly>
      <Loader />
    </AdminOnly>
  );
}

function Loader() {
  const params = useLocalSearchParams<{ id?: string }>();
  const id = params.id ? Number(params.id) : undefined;
  const categories = useAuthorizedQuery(fetchAdminCategories);
  const loadCourse = useCallback(
    async (token: string) => (id === undefined ? null : (await fetchAdminCourse(token, id)).curso),
    [id]
  );
  const course = useAuthorizedQuery(loadCourse);

  if (categories.data !== undefined && course.data !== undefined) {
    return (
      <CourseForm key={course.data?.id ?? 'new'} course={course.data} categories={categories.data} />
    );
  }
  return (
    <AdminScaffold title={id === undefined ? 'Adicionar curso' : 'Editar curso'}>
      <QueryState
        loading={categories.loading || course.loading}
        error={categories.error ?? course.error}
        hasData={false}
        onRetry={() => {
          categories.reload();
          course.reload();
        }}
      />
    </AdminScaffold>
  );
}

const sectionOptions: { value: SectionId | null; label: string }[] = [
  { value: null, label: 'Nenhuma' },
  ...sections.map((section) => ({ value: section.id, label: section.title })),
];

const accessOptions: { value: AccessType; label: string }[] = [
  { value: 'gratuito', label: 'Gratuito' },
  { value: 'pago', label: 'Pago' },
  { value: 'restrito', label: 'Restrito' },
];
const accessHints: Record<AccessType, string> = {
  gratuito: 'Qualquer pessoa com conta pode iniciar.',
  pago: 'O aluno compra o curso pelo aplicativo e o acesso é liberado quando o pagamento é aprovado.',
  restrito: 'Só alunos liberados pela administração podem iniciar. Não há venda pelo aplicativo.',
};
const termOptions: { value: number | null; label: string }[] = [
  { value: 12, label: '12 meses' },
  { value: 24, label: '24 meses' },
  { value: null, label: 'Sem vencimento' },
];
const MAX_INSTALLMENTS = 12;
const installmentOptions = (max: number) =>
  Array.from({ length: max }, (_, index) => ({ value: index + 1, label: index === 0 ? 'À vista' : `${index + 1}x` }));

const PUBLISH_BLOCKED = 'Não é possível publicar este curso.';
const PRICE_REQUIRED =
  'Este curso está configurado como pago, mas ainda não possui um valor válido cadastrado. Informe o preço antes de publicar.';
const PAYMENT_REQUIRED =
  'Este curso está configurado como pago, mas não tem forma de pagamento habilitada. Habilite Pix ou cartão antes de publicar.';

/** Problema nas configurações comerciais que impede salvar ou publicar. */
type CommerceError = { field: 'preco' | 'pagamento'; title: string; message: string };

/** Recusa do backend (422) por pendência comercial, com o campo e a mensagem que ele informou. */
function commerceRefusal(cause: unknown): CommerceError | undefined {
  if (!(cause instanceof ApiError) || cause.status !== 422) return undefined;
  const { campos: fields, pendencias: messages } = cause.data;
  if (!Array.isArray(fields) || !Array.isArray(messages)) return undefined;
  const index = fields.findIndex((field) => field === 'preco' || field === 'pagamento');
  return index < 0
    ? undefined
    : { field: fields[index] as CommerceError['field'], title: PUBLISH_BLOCKED, message: String(messages[index]) };
}

/** Lê o desconto digitado ("5", "7,5"). undefined se inválido. */
function parseDiscount(text: string) {
  const value = text.trim();
  if (!value) return 0;
  if (!/^\d{1,2}([.,]\d{1,2})?$/.test(value)) return undefined;
  const discount = Number(value.replace(',', '.'));
  return discount <= 90 ? discount : undefined;
}

function CourseForm({ course, categories }: { course: AdminCourse | null; categories: AdminCategory[] }) {
  const { authorized } = useAuth();
  const sales = useAuthorizedQuery(fetchSalesSummary);
  const [form, setForm] = useState<CourseInput>({
    titulo: course?.titulo ?? '',
    subtitulo: course?.subtitulo ?? '',
    descricao: course?.descricao ?? '',
    instrutora: course?.instrutora ?? '',
    imagemCapa: course?.imagemCapa ?? null,
    imagemBanner: course?.imagemBanner ?? null,
    categoriaId: course?.categoriaId ?? null,
    secao: course?.secao ?? null,
    tipoAcesso: course?.tipoAcesso ?? 'restrito',
    precoCentavos: course?.precoCentavos ?? null,
    pixHabilitado: course?.pixHabilitado ?? false,
    pixDescontoPercentual: course?.pixDescontoPercentual ?? 0,
    cartaoHabilitado: course?.cartaoHabilitado ?? false,
    cartaoMaxParcelas: course?.cartaoMaxParcelas ?? 1,
    cartaoParcelasSemJuros: course?.cartaoParcelasSemJuros ?? 1,
    prazoAcessoMeses: course?.prazoAcessoMeses ?? null,
    destaque: course?.destaque ?? false,
    sequencial: course?.sequencial ?? true,
  });
  // Preço e desconto são digitados como texto e convertidos ao salvar.
  const [priceText, setPriceText] = useState(moneyInput(course?.precoCentavos ?? null));
  const [discountText, setDiscountText] = useState(
    course?.pixDescontoPercentual ? String(course.pixDescontoPercentual).replace('.', ',') : ''
  );
  const paid = form.tipoAcesso === 'pago';
  const price = parseMoney(priceText);
  const discount = parseDiscount(discountText);
  const pixValue =
    typeof price === 'number' && discount !== undefined
      ? price - Math.round((price * discount) / 100)
      : undefined;
  const [error, setError] = useState<string>();
  const [commerceError, setCommerceError] = useState<CommerceError>();
  const [saving, setSaving] = useState<'save' | 'publish'>();
  const [accessChanges, setAccessChanges] = useState<PreparedAccessChanges>({ conceder: [], revogar: [] });
  const [accessReady, setAccessReady] = useState(course === null);
  const [registeredId, setRegisteredId] = useState(course?.id);
  const [accessRevision, setAccessRevision] = useState(0);
  const scroll = useRef<ScrollView>(null);
  const commerceTop = useRef(0);
  const published = course?.status === 'publicado';
  const set = <K extends keyof CourseInput>(key: K, value: CourseInput[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  // Depois de criar o curso, a pilha fica Gerenciar cursos → Conteúdo do curso,
  // para o Voltar levar à listagem (e não de volta a este formulário).
  const openContent = (id: number) => {
    router.dismissTo('/admin/courses');
    router.push({ pathname: '/admin/course-content', params: { id: String(id) } });
  };

  // Mostra o problema junto das configurações comerciais (e rola até lá) e também perto dos botões.
  const refuse = (problem: CommerceError) => {
    setCommerceError(problem);
    setError(`${problem.title}\n${problem.message}`);
    scroll.current?.scrollTo({ y: Math.max(commerceTop.current - 12, 0), animated: true });
  };

  // Salva os dados e, se pedido, publica. Um curso novo segue para a tela de módulos e aulas.
  const submit = async (publish: boolean) => {
    if (saving) return;
    if (form.tipoAcesso === 'restrito' && !accessReady) return setError('Aguarde o carregamento dos alunos autorizados ou tente novamente.');
    setCommerceError(undefined);
    if (!form.titulo.trim()) return setError('Informe o título do curso.');
    // Um valor digitado errado não é salvo nem como rascunho; em branco, o rascunho é aceito.
    if (paid && (price === undefined || price === 0)) {
      return refuse({
        field: 'preco',
        title: 'Preço inválido.',
        message: 'Informe o preço em reais, maior que zero, como 297,00.',
      });
    }
    if (paid && discount === undefined) return setError('Informe o desconto no Pix entre 0% e 90%.');
    // Curso que ficará (ou continuará) publicado: se for pago, precisa de preço e forma de pagamento.
    if (paid && (publish || published)) {
      if (price === null) return refuse({ field: 'preco', title: PUBLISH_BLOCKED, message: PRICE_REQUIRED });
      if (!form.pixHabilitado && !form.cartaoHabilitado) {
        return refuse({ field: 'pagamento', title: PUBLISH_BLOCKED, message: PAYMENT_REQUIRED });
      }
    }
    setError(undefined);
    setSaving(publish ? 'publish' : 'save');

    let saved: AdminCourse;
    try {
      const body: CourseInput = {
        ...form,
        titulo: form.titulo.trim(),
        subtitulo: form.subtitulo?.trim() || null,
        descricao: form.descricao?.trim() || null,
        instrutora: form.instrutora?.trim() || null,
        // Fora do tipo "Pago", preço e formas de pagamento ficam como estavam no cadastro.
        precoCentavos: paid ? (price ?? null) : form.precoCentavos,
        pixDescontoPercentual: paid ? (discount ?? 0) : form.pixDescontoPercentual,
        ...(form.tipoAcesso === 'restrito' && {
          acessos: { conceder: accessChanges.conceder.map(({ aluno, ...grant }) => grant), revogar: accessChanges.revogar },
        }),
      };
      saved = await authorized((token) =>
        registeredId !== undefined ? updateCourse(token, registeredId, body) : createCourse(token, body)
      );
      setRegisteredId(saved.id);
      setAccessRevision((current) => current + 1);
      setAccessChanges({ conceder: [], revogar: [] });
    } catch (cause) {
      const refusal = commerceRefusal(cause);
      if (refusal) refuse(refusal);
      else setError(publishError(cause));
      return setSaving(undefined);
    }

    if (publish) {
      try {
        await authorized((token) => setCourseStatus(token, saved.id, 'publicado'));
      } catch (cause) {
        // Os dados foram salvos; só a publicação ficou pendente.
        const pending = cause instanceof ApiError && cause.status === 422;
        const refusal = commerceRefusal(cause);
        if (refusal) {
          refuse(refusal);
          return setSaving(undefined);
        }
        if (!course && pending) return openContent(saved.id);
        setError(pending ? `Alterações salvas. ${publishError(cause)}` : publishError(cause));
        return setSaving(undefined);
      }
    }
    return course ? router.back() : openContent(saved.id);
  };

  const unpublish = async () => {
    if (!course || saving) return;
    setError(undefined);
    setSaving('publish');
    try {
      await authorized((token) => setCourseStatus(token, course.id, 'rascunho'));
      router.back();
    } catch (cause) {
      setError(errorMessage(cause));
      setSaving(undefined);
    }
  };

  return (
    <AdminScaffold title={course ? 'Editar curso' : 'Adicionar curso'} scrollRef={scroll}>
      <View style={styles.statusRow}>
        <View style={[styles.statusTag, published && styles.statusPublished]}>
          <Text style={[styles.statusText, published && styles.statusPublishedText]}>
            {course ? statusLabels[course.status] : 'Novo curso'}
          </Text>
        </View>
        <Text style={styles.statusHint}>
          {published
            ? 'Visível para os alunos. As alterações valem assim que forem salvas.'
            : course
              ? 'Ainda não aparece para os alunos.'
              : 'Será salvo como rascunho até você publicar.'}
        </Text>
      </View>
      {course !== null && (
        <SmallButton
          icon="library"
          label={`Gerenciar módulos e aulas (${course.totalAulas})`}
          onPress={() => router.push({ pathname: '/admin/course-content', params: { id: String(course.id) } })}
        />
      )}
      <TextField label="Título" value={form.titulo} onChangeText={(value) => set('titulo', value)} maxLength={200} />
      <TextField
        label="Subtítulo"
        value={form.subtitulo ?? ''}
        onChangeText={(value) => set('subtitulo', value)}
        maxLength={255}
      />
      <TextField
        label="Descrição"
        value={form.descricao ?? ''}
        onChangeText={(value) => set('descricao', value)}
        maxLength={10000}
        multiline
      />
      <TextField
        label="Instrutora"
        value={form.instrutora ?? ''}
        onChangeText={(value) => set('instrutora', value)}
        maxLength={150}
      />

      {categories.length === 0 ? (
        <View style={styles.group}>
          <Text style={styles.label}>Categoria</Text>
          <Text style={styles.hint}>Nenhuma categoria cadastrada ainda. Ela é necessária para publicar.</Text>
          <SmallButton icon="plus" label="Nova categoria" onPress={() => router.push('/admin/category-form')} />
        </View>
      ) : (
        <ChoiceChips
          label="Categoria"
          options={[
            { value: null, label: 'Sem categoria' },
            ...categories.map((category) => ({ value: category.id, label: category.nome })),
          ]}
          value={form.categoriaId}
          onChange={(value) => set('categoriaId', value)}
        />
      )}
      <View style={styles.group}>
        <ChoiceChips
          label="Seção da Home"
          options={sectionOptions}
          value={form.secao}
          onChange={(value) => set('secao', value)}
        />
        <Text style={styles.hint}>
          Sem seção, o curso publicado aparece apenas em Explorar conteúdos.
        </Text>
      </View>

      <ImageField label="Imagem de capa" value={form.imagemCapa} onChange={(value) => set('imagemCapa', value)} />
      <ImageField
        label="Imagem de banner"
        hint="Aparece no topo da página do curso. Sem banner, a capa é usada."
        value={form.imagemBanner}
        onChange={(value) => set('imagemBanner', value)}
      />

      <View style={styles.group}>
        <ChoiceChips
          label="Tipo de acesso"
          options={accessOptions}
          value={form.tipoAcesso}
          onChange={(value) => set('tipoAcesso', value)}
        />
        <Text style={styles.hint}>{accessHints[form.tipoAcesso]}</Text>
      </View>

      {paid && (
        <View
          style={styles.commerce}
          onLayout={(event) => {
            commerceTop.current = event.nativeEvent.layout.y;
          }}>
          <Text accessibilityRole="header" style={styles.heading}>
            Configurações comerciais
          </Text>
          <Text style={styles.hint}>
            Para publicar um curso pago são obrigatórios o preço e ao menos uma forma de pagamento. Como
            rascunho, o curso pode ser salvo incompleto.
          </Text>
          {commerceError !== undefined && (
            <View accessibilityRole="alert" style={styles.blocked}>
              <Text style={styles.blockedTitle}>{commerceError.title}</Text>
              <Text style={styles.blockedText}>{commerceError.message}</Text>
            </View>
          )}
          {sales.data !== undefined && sales.data.pagamentos.provedor === null && (
            <Text style={styles.warning}>
              Os pagamentos pelo aplicativo ainda não estão ativados. O curso pode ser publicado e mostrará o
              preço, mas a compra fica indisponível até a integração com o provedor. Enquanto isso, você pode
              liberar alunos em Vendas e acessos.
            </Text>
          )}
          <TextField
            label="Preço do curso (R$) · obrigatório para publicar"
            hint="Valor total à vista. Compras já feitas não mudam quando o preço é alterado."
            error={commerceError?.field === 'preco' ? 'Informe um preço válido, maior que zero.' : undefined}
            placeholder="297,00"
            value={priceText}
            onChangeText={(value) => {
              setPriceText(value);
              if (commerceError?.field === 'preco') setCommerceError(undefined);
            }}
            keyboardType="decimal-pad"
            maxLength={12}
          />

          <Text style={styles.label}>Formas de pagamento · ao menos uma para publicar</Text>
          {commerceError?.field === 'pagamento' && (
            <Text accessibilityLiveRegion="polite" style={styles.fieldError}>
              Habilite Pix ou cartão de crédito.
            </Text>
          )}
          <SwitchRow
            label="Aceitar Pix"
            description="Pagamento à vista, pelo preço cadastrado ou com desconto."
            value={form.pixHabilitado}
            onValueChange={(value) => {
              set('pixHabilitado', value);
              if (commerceError?.field === 'pagamento') setCommerceError(undefined);
            }}
          />
          {form.pixHabilitado && (
            <TextField
              label="Desconto no Pix (%)"
              hint={
                pixValue === undefined
                  ? 'Opcional. Deixe em branco para cobrar o preço cheio no Pix.'
                  : discount
                    ? `Valor no Pix: ${formatMoney(pixValue)} (economia de ${formatMoney((price ?? 0) - pixValue)}).`
                    : `Sem desconto: o Pix custa ${formatMoney(pixValue)}.`
              }
              placeholder="0"
              value={discountText}
              onChangeText={setDiscountText}
              keyboardType="decimal-pad"
              maxLength={5}
            />
          )}

          <SwitchRow
            label="Aceitar cartão de crédito"
            description="À vista ou parcelado, pelo checkout seguro do provedor."
            value={form.cartaoHabilitado}
            onValueChange={(value) => {
              set('cartaoHabilitado', value);
              if (commerceError?.field === 'pagamento') setCommerceError(undefined);
            }}
          />
          {form.cartaoHabilitado && (
            <>
              <ChoiceChips
                label="Parcelar em até"
                options={installmentOptions(MAX_INSTALLMENTS)}
                value={form.cartaoMaxParcelas}
                onChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    cartaoMaxParcelas: value,
                    cartaoParcelasSemJuros: Math.min(current.cartaoParcelasSemJuros, value),
                  }))
                }
              />
              {form.cartaoMaxParcelas > 1 && (
                <View style={styles.group}>
                  <ChoiceChips
                    label="Sem juros até"
                    options={installmentOptions(form.cartaoMaxParcelas)}
                    value={form.cartaoParcelasSemJuros}
                    onChange={(value) => set('cartaoParcelasSemJuros', value)}
                  />
                  <Text style={styles.hint}>
                    Acima disso, os juros e o valor de cada parcela são os informados pelo provedor de
                    pagamentos no momento da compra.
                  </Text>
                </View>
              )}
            </>
          )}
        </View>
      )}

      {form.tipoAcesso !== 'gratuito' && (
        <View style={styles.group}>
          <ChoiceChips
            label="Prazo de acesso"
            options={termOptions}
            value={form.prazoAcessoMeses}
            onChange={(value) => set('prazoAcessoMeses', value)}
          />
          <Text style={styles.hint}>
            {paid
              ? 'Vale para o curso completo e começa a contar quando o pagamento é aprovado.'
              : 'Prazo padrão ao liberar um aluno; começa na data da liberação.'}
          </Text>
        </View>
      )}
      {form.tipoAcesso === 'restrito' && (
        <CourseStudentsEditor key={`${registeredId ?? 'new'}-${accessRevision}`} courseId={registeredId} defaultTerm={form.prazoAcessoMeses}
          value={accessChanges} onChange={setAccessChanges} onReadyChange={setAccessReady} disabled={saving !== undefined} />
      )}
      <SwitchRow
        label="Exibir em destaque"
        description="Cursos em destaque aparecem primeiro."
        value={form.destaque}
        onValueChange={(value) => set('destaque', value)}
      />
      <SwitchRow
        label="Progressão sequencial"
        description={
          form.sequencial
            ? 'Cada aula é liberada ao concluir a anterior.'
            : 'O aluno acessa as aulas em qualquer ordem.'
        }
        value={form.sequencial}
        onValueChange={(value) => set('sequencial', value)}
      />

      {error !== undefined && <FormError message={error} />}
      {published ? (
        <>
          <PrimaryButton label="Salvar alterações" onPress={() => submit(false)} loading={saving === 'save'} />
          <PrimaryButton
            variant="outline"
            label="Despublicar"
            onPress={unpublish}
            loading={saving === 'publish'}
          />
        </>
      ) : (
        <>
          <PrimaryButton
            label="Salvar como rascunho"
            onPress={() => submit(false)}
            loading={saving === 'save'}
          />
          <PrimaryButton
            variant="outline"
            label="Salvar e publicar"
            onPress={() => submit(true)}
            loading={saving === 'publish'}
          />
        </>
      )}
    </AdminScaffold>
  );
}

const styles = StyleSheet.create({
  group: { gap: 6 },
  label: { fontFamily: Fonts.sansMedium, fontSize: 12.5, color: Brand.text },
  hint: { fontFamily: Fonts.sans, fontSize: 12, lineHeight: 17, color: Brand.muted },
  commerce: { gap: 16, padding: 14, borderRadius: Radius.card, backgroundColor: Brand.surfaceSoft },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  statusTag: { borderRadius: Radius.pill, backgroundColor: Brand.surface, paddingHorizontal: 12, paddingVertical: 5 },
  statusPublished: { backgroundColor: Brand.primary },
  statusText: { fontFamily: Fonts.sansMedium, fontSize: 12, letterSpacing: 0.3, color: Brand.text },
  statusPublishedText: { color: Brand.white },
  statusHint: { flex: 1, fontFamily: Fonts.sans, fontSize: 12, lineHeight: 17, color: Brand.muted },
  blocked: {
    gap: 4,
    padding: 12,
    borderRadius: Radius.tile,
    borderWidth: 1,
    borderColor: Brand.danger,
    backgroundColor: Brand.dangerSoft,
  },
  blockedTitle: { fontFamily: Fonts.sansSemiBold, fontSize: 13.5, lineHeight: 19, color: Brand.danger },
  blockedText: { fontFamily: Fonts.sans, fontSize: 13, lineHeight: 19, color: Brand.danger },
  fieldError: { fontFamily: Fonts.sansMedium, fontSize: 12.5, lineHeight: 18, color: Brand.danger },
  heading: { fontFamily: Fonts.serifMedium, fontSize: 19, lineHeight: 25, color: Brand.text },
  warning: {
    fontFamily: Fonts.sans,
    fontSize: 12.5,
    lineHeight: 18,
    color: Brand.text,
    backgroundColor: Brand.card,
    borderRadius: Radius.tile,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
});
