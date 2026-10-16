import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { QueryState } from '@/components/admin-scaffold';
import { BrandIcon } from '@/components/brand-icon';
import { AuthGate } from '@/components/section-placeholder';
import { StackScreen } from '@/components/stack-screen';
import { Brand, Fonts, Radius, Shadow } from '@/constants/brand';
import { useAuth } from '@/context/auth';
import { useAuthorizedQuery } from '@/hooks/use-authorized-query';
import {
  fetchOrders,
  installmentsLabel,
  orderStatusLabels,
  paymentMethodLabels,
  type Order,
} from '@/services/commerce-api';
import { formatDate, formatMoney } from '@/utils/format';

// Histórico de compras do aluno. Nenhum dado de cartão é guardado ou exibido.
export default function PurchasesScreen() {
  const { user } = useAuth();
  if (!user) return <AuthGate area="profile" areaLabel="suas compras" />;
  return <Purchases />;
}

function Purchases() {
  const { data, error, loading, reload } = useAuthorizedQuery(fetchOrders);
  return (
    <StackScreen
      title="Histórico de compras"
      subtitle="Toque em uma compra para ver os detalhes e a situação do pagamento."
      refreshing={loading && data !== undefined}
      onRefresh={reload}>
      <QueryState loading={loading} error={data === undefined ? error : undefined} hasData={data !== undefined} onRetry={reload} />
      {data?.length === 0 && <Text style={styles.text}>Você ainda não fez nenhuma compra.</Text>}
      {data?.map((order) => <OrderRow key={order.id} order={order} />)}
    </StackScreen>
  );
}

function OrderRow({ order }: { order: Order }) {
  const payment =
    order.formaPagamento === 'cartao'
      ? `${paymentMethodLabels.cartao}, ${installmentsLabel(order.parcelas, order.valorParcelaCentavos)}`
      : paymentMethodLabels.pix;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${order.cursoTitulo}, ${formatMoney(order.totalCentavos)}, ${orderStatusLabels[order.status]}`}
      accessibilityHint="Abre os detalhes da compra"
      onPress={() => router.push({ pathname: '/order/[id]', params: { id: String(order.id) } })}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <View style={styles.body}>
        <Text numberOfLines={2} style={styles.title}>
          {order.cursoTitulo}
        </Text>
        <Text style={styles.meta}>
          {formatDate(order.criadoEm)} · {payment}
        </Text>
        <View style={styles.bottom}>
          <Text style={styles.total}>{formatMoney(order.totalCentavos)}</Text>
          <Text style={[styles.status, order.status === 'aprovado' && styles.statusDone]}>
            {orderStatusLabels[order.status]}
          </Text>
        </View>
      </View>
      <BrandIcon name="chevron" size={18} color={Brand.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  text: { fontFamily: Fonts.sans, fontSize: 14.5, lineHeight: 22, color: Brand.muted },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderRadius: Radius.card,
    backgroundColor: Brand.card,
    boxShadow: Shadow.card,
  },
  body: { flex: 1, gap: 4 },
  title: { fontFamily: Fonts.serif, fontSize: 17, lineHeight: 22, color: Brand.text },
  meta: { fontFamily: Fonts.sans, fontSize: 12.5, lineHeight: 18, color: Brand.muted },
  bottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, marginTop: 2 },
  total: { fontFamily: Fonts.sansSemiBold, fontSize: 14.5, color: Brand.text },
  status: { fontFamily: Fonts.sansMedium, fontSize: 12.5, color: Brand.muted },
  statusDone: { color: Brand.primaryDeep },
  pressed: { opacity: 0.8 },
});
