import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AdminOnly } from '@/components/admin-only';
import { AdminScaffold, QueryState, confirmAction, errorMessage } from '@/components/admin-scaffold';
import { ChoiceChips, FormError, SmallButton, TextField } from '@/components/form';
import { PrimaryButton } from '@/components/primary-button';
import { Brand, Fonts, Radius, Shadow } from '@/constants/brand';
import { useAuth } from '@/context/auth';
import { useAuthorizedQuery } from '@/hooks/use-authorized-query';
import {
  fetchAdminAccesses,
  fetchAdminOrders,
  fetchSalesSummary,
  revokeAccess,
  type AdminAccess,
  type AdminOrder,
} from '@/services/admin-api';
import {
  accessStatusLabels,
  installmentsLabel,
  orderStatusLabels,
  paymentMethodLabels,
} from '@/services/commerce-api';
import { formatAccessTerm, formatDate, formatDay, formatMoney } from '@/utils/format';

type View_ = 'compras' | 'acessos';

const views: { value: View_; label: string }[] = [
  { value: 'compras', label: 'Compras' },
  { value: 'acessos', label: 'Acessos' },
];
// Filtros de compras: cada um reúne as situações equivalentes do pedido.
const orderFilters: { value: string; label: string }[] = [
  { value: '', label: 'Todas' },
  { value: 'aprovado', label: 'Confirmadas' },
  { value: 'pendente,em_processamento', label: 'Pendentes' },
  { value: 'cancelado,recusado,expirado', label: 'Canceladas' },
  { value: 'reembolsado,contestado', label: 'Reembolsadas' },
];
const accessFilters: { value: string; label: string }[] = [
  { value: '', label: 'Todos' },
  { value: 'ativo', label: 'Ativos' },
  { value: 'vencido', label: 'Vencidos' },
  { value: 'revogado', label: 'Revogados' },
];

export default function SalesScreen() {
  return (
    <AdminOnly>
      <Sales />
    </AdminOnly>
  );
}

// Vendas e direitos de acesso. A administradora consulta compras e libera ou revoga cursos;
// a situação de um pagamento só muda pela confirmação do provedor, nunca por esta tela.
function Sales() {
  const { authorized } = useAuth();
  const summary = useAuthorizedQuery(fetchSalesSummary);
  const [view, setView] = useState<View_>('compras');
  const [status, setStatus] = useState('');
  const [situation, setSituation] = useState('');
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  const [failure, setFailure] = useState<string>();

  const loadOrders = useCallback(
    (token: string) => fetchAdminOrders(token, { status: status || undefined, busca: search || undefined }),
    [status, search]
  );
  const loadAccesses = useCallback(
    (token: string) => fetchAdminAccesses(token, { situacao: situation || undefined, busca: search || undefined }),
    [situation, search]
  );
  const orders = useAuthorizedQuery(loadOrders);
  const accesses = useAuthorizedQuery(loadAccesses);
  const list = view === 'compras' ? orders : accesses;

  const reload = () => {
    summary.reload();
    orders.reload();
    accesses.reload();
  };

  const revoke = (access: AdminAccess) =>
    confirmAction(
      'Revogar este acesso?',
      `${access.aluno.nome} deixará de assistir às aulas de "${access.cursoTitulo}". O progresso dele continua guardado.`,
      'Revogar acesso',
      async () => {
        setFailure(undefined);
        try {
          await authorized((token) => revokeAccess(token, { usuarioId: access.aluno.id, cursoId: access.cursoId }));
        } catch (cause) {
          setFailure(errorMessage(cause));
        }
        reload();
      }
    );

  const data = summary.data;
  return (
    <AdminScaffold
      title="Vendas e acessos"
      subtitle="Compras feitas pelo aplicativo e quem pode assistir a cada curso."
      refreshing={list.loading && list.data !== undefined}
      onRefresh={reload}>
      {data !== undefined && (
        <>
          <View style={styles.stats}>
            <Stat label="Recebido em compras confirmadas" value={formatMoney(data.pedidos.recebidoCentavos)} wide />
            <Stat label="Compras confirmadas" value={String(data.pedidos.aprovados)} />
            <Stat label="Pagamentos pendentes" value={String(data.pedidos.pendentes)} />
            <Stat label="Acessos ativos" value={String(data.acessos.ativos)} />
            <Stat label="Acessos vencidos" value={String(data.acessos.vencidos)} />
          </View>
          {data.cursosComPendencias.map((course) => (
            <View key={course.id} accessibilityRole="alert" style={styles.alert}>
              <Text style={styles.alertTitle}>{course.titulo}: curso pago publicado com pendências</Text>
              {course.pendencias.map((item) => (
                <Text key={item} style={styles.alertText}>
                  {item}
                </Text>
              ))}
              <SmallButton
                tone="danger"
                label="Corrigir no cadastro do curso"
                onPress={() => router.push({ pathname: '/admin/course-form', params: { id: String(course.id) } })}
              />
            </View>
          ))}
          {data.pagamentos.provedor === null && (
            <Text style={styles.notice}>
              Pagamentos ainda não ativados: nenhuma cobrança é feita pelo aplicativo. Você pode liberar
              cursos manualmente.
            </Text>
          )}
          <Text style={styles.detail}>
            {data.termos
              ? `Termos de Uso em vigor: versão ${data.termos.versao}, desde ${formatDay(data.termos.vigenteDesde)}.`
              : 'Termos de Uso ainda não publicados: sem eles, nenhuma compra pode ser iniciada.'}
          </Text>
        </>
      )}

      <PrimaryButton label="Gerenciar acessos por aluno" onPress={() => router.push('/admin/grant-access')} />

      <ChoiceChips options={views} value={view} onChange={setView} />
      <TextField
        label="Buscar por aluno ou curso"
        value={text}
        onChangeText={setText}
        onSubmitEditing={() => setSearch(text.trim())}
        onBlur={() => setSearch(text.trim())}
        returnKeyType="search"
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={100}
      />
      {view === 'compras' ? (
        <ChoiceChips options={orderFilters} value={status} onChange={setStatus} />
      ) : (
        <ChoiceChips options={accessFilters} value={situation} onChange={setSituation} />
      )}

      {failure !== undefined && <FormError message={failure} />}
      <QueryState
        loading={list.loading}
        error={list.data === undefined ? list.error : undefined}
        hasData={list.data !== undefined}
        onRetry={list.reload}
      />
      {list.data?.length === 0 && (
        <Text style={styles.detail}>
          {view === 'compras' ? 'Nenhuma compra encontrada.' : 'Nenhum acesso encontrado.'}
        </Text>
      )}
      {view === 'compras'
        ? orders.data?.map((order) => <OrderCard key={order.id} order={order} />)
        : accesses.data?.map((access) => (
            <AccessCard key={`${access.aluno.id}-${access.cursoId}`} access={access} onRevoke={() => revoke(access)} />
          ))}
    </AdminScaffold>
  );
}

function Stat({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return (
    <View accessible accessibilityLabel={`${label}: ${value}`} style={[styles.stat, wide && styles.statWide]}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.detail}>{label}</Text>
    </View>
  );
}

function OrderCard({ order }: { order: AdminOrder }) {
  const payment =
    order.formaPagamento === 'cartao'
      ? `${paymentMethodLabels.cartao}, ${installmentsLabel(order.parcelas, order.valorParcelaCentavos)}`
      : paymentMethodLabels.pix;
  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <Text numberOfLines={2} style={styles.cardTitle}>
          {order.cursoTitulo}
        </Text>
        <Text style={styles.amount}>{formatMoney(order.totalCentavos)}</Text>
      </View>
      <Text style={styles.person}>
        {order.aluno.nome} · {order.aluno.email}
      </Text>
      <Text style={styles.detail}>
        {formatDate(order.criadoEm)} · {payment}
        {order.descontoCentavos > 0 ? ` · desconto de ${formatMoney(order.descontoCentavos)}` : ''}
        {order.jurosCentavos > 0 ? ` · juros de ${formatMoney(order.jurosCentavos)}` : ''}
      </Text>
      <Text style={styles.detail}>
        Preço contratado {formatMoney(order.precoCentavos)} · acesso {formatAccessTerm(order.prazoAcessoMeses)}
        {order.aprovadoEm ? ` · aprovada em ${formatDate(order.aprovadoEm)}` : ''}
      </Text>
      <Text style={[styles.tag, order.status === 'aprovado' && styles.tagDone]}>{orderStatusLabels[order.status]}</Text>
    </View>
  );
}

function AccessCard({ access, onRevoke }: { access: AdminAccess; onRevoke: () => void }) {
  const active = access.situacao === 'ativo' || access.situacao === 'agendado';
  return (
    <View style={styles.card}>
      <Text numberOfLines={2} style={styles.cardTitle}>
        {access.cursoTitulo}
      </Text>
      <Text style={styles.person}>
        {access.aluno.nome} · {access.aluno.email}
      </Text>
      <Text style={styles.detail}>
        {access.origem === 'compra' ? `Compra nº ${access.pedidoId}` : 'Liberação manual'} · início em{' '}
        {formatDate(access.inicioEm)} · {access.expiraEm ? `vencimento em ${formatDate(access.expiraEm)}` : 'sem vencimento'}
      </Text>
      {access.revogadoEm !== null && (
        <Text style={styles.detail}>
          Revogado em {formatDate(access.revogadoEm)}
          {access.motivoRevogacao ? ` · ${access.motivoRevogacao}` : ''}
        </Text>
      )}
      <View style={styles.cardBottom}>
        <Text style={[styles.tag, access.situacao === 'ativo' && styles.tagDone]}>
          {accessStatusLabels[access.situacao]}
          {access.diasRestantes !== null ? ` · ${access.diasRestantes} ${access.diasRestantes === 1 ? 'dia' : 'dias'}` : ''}
        </Text>
        {active && <SmallButton tone="danger" label="Revogar" onPress={onRevoke} />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  stat: {
    flexGrow: 1,
    flexBasis: '45%',
    padding: 14,
    gap: 2,
    borderRadius: Radius.card,
    backgroundColor: Brand.card,
    boxShadow: Shadow.card,
  },
  statWide: { flexBasis: '100%' },
  // Algarismos alinhados: no estilo antigo da Playfair o zero se confunde com a letra O.
  statValue: {
    fontFamily: Fonts.serifMedium,
    fontVariant: ['lining-nums', 'tabular-nums'],
    fontSize: 24,
    lineHeight: 31,
    color: Brand.text,
  },
  notice: {
    fontFamily: Fonts.sans,
    fontSize: 13,
    lineHeight: 19,
    color: Brand.text,
    backgroundColor: Brand.surfaceSoft,
    borderRadius: Radius.tile,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  detail: { fontFamily: Fonts.sans, fontSize: 12.5, lineHeight: 18, color: Brand.muted },
  alert: {
    gap: 6,
    padding: 12,
    borderRadius: Radius.tile,
    borderWidth: 1,
    borderColor: Brand.danger,
    backgroundColor: Brand.dangerSoft,
    alignItems: 'flex-start',
  },
  alertTitle: { fontFamily: Fonts.sansSemiBold, fontSize: 13.5, lineHeight: 19, color: Brand.danger },
  alertText: { fontFamily: Fonts.sans, fontSize: 13, lineHeight: 19, color: Brand.danger },
  card: { gap: 5, padding: 14, borderRadius: Radius.card, backgroundColor: Brand.card, boxShadow: Shadow.card },
  cardTop: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  cardTitle: { flex: 1, fontFamily: Fonts.serif, fontSize: 17, lineHeight: 22, color: Brand.text },
  amount: { fontFamily: Fonts.sansSemiBold, fontSize: 14.5, color: Brand.text },
  person: { fontFamily: Fonts.sansMedium, fontSize: 13, lineHeight: 19, color: Brand.text },
  cardBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 2 },
  tag: { fontFamily: Fonts.sansMedium, fontSize: 12.5, lineHeight: 18, color: Brand.muted, marginTop: 2 },
  tagDone: { color: Brand.primaryDeep },
});
