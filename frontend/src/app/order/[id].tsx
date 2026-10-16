import { Image } from 'expo-image';
import * as Linking from 'expo-linking';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { confirmAction } from '@/components/admin-scaffold';
import { BrandIcon, type IconName } from '@/components/brand-icon';
import { FormError } from '@/components/form';
import { PrimaryButton } from '@/components/primary-button';
import { AuthGate } from '@/components/section-placeholder';
import { DetailCard, StackScreen } from '@/components/stack-screen';
import { Brand, Fonts, Radius, Shadow } from '@/constants/brand';
import { useAuth } from '@/context/auth';
import { useAuthorizedQuery } from '@/hooks/use-authorized-query';
import {
  cancelOrder,
  fetchOrder,
  installmentsLabel,
  isOpenOrder,
  paymentMethodLabels,
  type Order,
  type OrderStatus,
} from '@/services/commerce-api';
import { errorMessage } from '@/utils/errors';
import { formatAccessTerm, formatDate, formatDateTime, formatMoney } from '@/utils/format';

/** Intervalo entre as consultas da situação enquanto a compra está em aberto. */
const POLL_EVERY = 6000;

const statuses: Record<OrderStatus, { icon: IconName; title: string; text: string }> = {
  pendente: {
    icon: 'clock',
    title: 'Aguardando pagamento',
    text: 'O curso é liberado automaticamente assim que o pagamento for confirmado. Esta tela se atualiza sozinha.',
  },
  em_processamento: {
    icon: 'clock',
    title: 'Pagamento em análise',
    text: 'A análise está em andamento. O curso será liberado assim que o pagamento for aprovado.',
  },
  aprovado: { icon: 'check', title: 'Pagamento aprovado', text: 'Seu curso está liberado. Bons estudos!' },
  recusado: {
    icon: 'close',
    title: 'Pagamento recusado',
    text: 'O pagamento não foi aprovado e o curso não foi liberado. Você pode tentar de novo com outra forma de pagamento.',
  },
  cancelado: { icon: 'close', title: 'Compra cancelada', text: 'Esta compra foi cancelada e o curso não foi liberado.' },
  expirado: {
    icon: 'clock',
    title: 'Cobrança expirada',
    text: 'O prazo para pagamento terminou. Você pode iniciar uma nova compra quando quiser.',
  },
  reembolsado: {
    icon: 'receipt',
    title: 'Compra reembolsada',
    text: 'O valor foi devolvido e o acesso ao curso foi encerrado. Seu progresso nas aulas continua guardado.',
  },
  contestado: {
    icon: 'receipt',
    title: 'Compra contestada',
    text: 'O pagamento foi contestado e o acesso ao curso foi encerrado. Seu progresso nas aulas continua guardado.',
  },
};

// Situação de uma compra. A liberação do curso depende só da confirmação do pagamento pelo
// backend: esta tela consulta a situação, nunca a define.
export default function OrderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  if (!user) return <AuthGate area="profile" areaLabel="suas compras" />;
  return <Loader key={id} orderId={Number(id)} />;
}

function Loader({ orderId }: { orderId: number }) {
  const { authorized } = useAuth();
  const load = useCallback((token: string) => fetchOrder(token, orderId), [orderId]);
  const { data, error, loading, reload } = useAuthorizedQuery(load);
  const [failure, setFailure] = useState<string>();
  const [cancelling, setCancelling] = useState(false);
  const open = data !== undefined && isOpenOrder(data.status);

  // Enquanto o pagamento não é confirmado, consulta a situação de tempos em tempos.
  useFocusEffect(
    useCallback(() => {
      if (!open) return undefined;
      const timer = setInterval(reload, POLL_EVERY);
      return () => clearInterval(timer);
    }, [open, reload])
  );

  if (data === undefined) {
    return (
      <StackScreen>
        <View style={styles.center}>
          {error !== undefined ? (
            <>
              <Text accessibilityLiveRegion="polite" style={styles.text}>
                {error}
              </Text>
              <PrimaryButton variant="outline" label="Tentar novamente" onPress={reload} />
            </>
          ) : (
            loading && <ActivityIndicator color={Brand.primary} size="large" />
          )}
        </View>
      </StackScreen>
    );
  }

  const cancel = () =>
    confirmAction(
      'Cancelar esta compra?',
      'A cobrança em aberto será descartada. Você poderá iniciar outra compra depois.',
      'Cancelar compra',
      async () => {
        setFailure(undefined);
        setCancelling(true);
        try {
          await authorized((token) => cancelOrder(token, orderId));
        } catch (cause) {
          setFailure(errorMessage(cause));
        } finally {
          setCancelling(false);
          reload();
        }
      }
    );

  return (
    <StackScreen refreshing={false} onRefresh={reload}>
      <OrderView order={data} />
      {failure !== undefined && <FormError message={failure} />}
      <Actions order={data} cancelling={cancelling} onCancel={cancel} />
    </StackScreen>
  );
}

function OrderView({ order }: { order: Order }) {
  const status = statuses[order.status];
  const positive = order.status === 'aprovado';
  return (
    <>
      <View style={styles.status}>
        <View style={[styles.statusIcon, positive && styles.statusIconDone]}>
          <BrandIcon
            name={status.icon}
            size={24}
            strokeWidth={positive ? 2 : 1.5}
            color={positive ? Brand.white : Brand.primaryDeep}
          />
        </View>
        <Text accessibilityRole="header" accessibilityLiveRegion="polite" style={styles.title}>
          {status.title}
        </Text>
        <Text style={styles.text}>{status.text}</Text>
      </View>

      {order.pix !== null && (
        <View style={styles.pix}>
          <Text style={styles.label}>Pague com Pix</Text>
          {order.pix.qrBase64 !== null && (
            <Image
              source={{ uri: `data:image/png;base64,${order.pix.qrBase64}` }}
              contentFit="contain"
              accessibilityLabel="QR Code do Pix"
              style={styles.qr}
            />
          )}
          <Text style={styles.small}>
            Abra o aplicativo do seu banco, escolha Pix copia e cola e use o código abaixo (toque e segure
            para copiar).
          </Text>
          <Text selectable style={styles.code}>
            {order.pix.copiaECola}
          </Text>
          {order.expiraEm !== null && (
            <Text style={styles.small}>Válido até {formatDateTime(order.expiraEm)}.</Text>
          )}
        </View>
      )}

      <DetailCard
        rows={[
          { label: 'Curso', value: order.cursoTitulo },
          { label: 'Data da compra', value: formatDateTime(order.criadoEm) },
          { label: 'Valor original', value: formatMoney(order.precoCentavos) },
          order.descontoCentavos > 0 && { label: 'Desconto', value: `- ${formatMoney(order.descontoCentavos)}` },
          { label: 'Forma de pagamento', value: paymentMethodLabels[order.formaPagamento] },
          order.formaPagamento === 'cartao' && {
            label: 'Parcelas',
            value: installmentsLabel(order.parcelas, order.valorParcelaCentavos),
          },
          order.jurosCentavos > 0 && { label: 'Juros', value: formatMoney(order.jurosCentavos) },
          { label: 'Total', value: formatMoney(order.totalCentavos), strong: true },
          {
            label: 'Prazo de acesso',
            value: formatAccessTerm(order.prazoAcessoMeses),
            detail:
              order.aprovadoEm !== null
                ? `Contado a partir de ${formatDate(order.aprovadoEm)}, data da aprovação.`
                : order.prazoAcessoMeses !== null
                  ? 'Começa a contar na aprovação do pagamento.'
                  : undefined,
          },
        ]}
      />
    </>
  );
}

function Actions({ order, cancelling, onCancel }: { order: Order; cancelling: boolean; onCancel: () => void }) {
  const course = { pathname: '/course/[id]', params: { id: String(order.cursoId) } } as const;
  const retry = order.status === 'recusado' || order.status === 'cancelado' || order.status === 'expirado';
  const { checkoutUrl, reciboUrl } = order;
  return (
    <View style={styles.actions}>
      {checkoutUrl !== null && (
        <PrimaryButton label="Abrir pagamento seguro" onPress={() => Linking.openURL(checkoutUrl)} />
      )}
      {order.status === 'aprovado' && (
        <>
          <PrimaryButton label="Ir para o curso" onPress={() => router.dismissTo(course)} />
          <PrimaryButton variant="outline" label="Meus cursos" onPress={() => router.push('/my-courses')} />
        </>
      )}
      {retry && (
        <PrimaryButton
          label="Tentar novamente"
          onPress={() => router.replace({ pathname: '/offer/[id]', params: { id: String(order.cursoId) } })}
        />
      )}
      {reciboUrl !== null && (
        <PrimaryButton variant="outline" label="Ver comprovante" onPress={() => Linking.openURL(reciboUrl)} />
      )}
      {isOpenOrder(order.status) && (
        <PrimaryButton variant="outline" label="Cancelar compra" onPress={onCancel} loading={cancelling} />
      )}
      {order.status !== 'aprovado' && (
        <PrimaryButton variant="outline" label="Voltar ao curso" onPress={() => router.dismissTo(course)} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', paddingVertical: 48, gap: 14 },
  status: { alignItems: 'center', gap: 8, paddingVertical: 8 },
  statusIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Brand.surfaceSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  statusIconDone: { backgroundColor: Brand.primary },
  title: { fontFamily: Fonts.serifMedium, fontSize: 24, lineHeight: 30, color: Brand.text, textAlign: 'center' },
  text: { fontFamily: Fonts.sans, fontSize: 14, lineHeight: 21, color: Brand.muted, textAlign: 'center' },
  pix: {
    gap: 10,
    padding: 16,
    borderRadius: Radius.card,
    backgroundColor: Brand.card,
    boxShadow: Shadow.card,
  },
  label: {
    fontFamily: Fonts.sansMedium,
    fontSize: 11,
    letterSpacing: 0.9,
    color: Brand.primaryDeep,
    textTransform: 'uppercase',
  },
  qr: { width: 220, height: 220, alignSelf: 'center', backgroundColor: Brand.white },
  small: { fontFamily: Fonts.sans, fontSize: 12.5, lineHeight: 18, color: Brand.muted },
  code: {
    fontFamily: Fonts.sans,
    fontSize: 12.5,
    lineHeight: 18,
    color: Brand.text,
    backgroundColor: Brand.surfaceSoft,
    borderRadius: Radius.tile,
    padding: 12,
  },
  actions: { gap: 10 },
});
