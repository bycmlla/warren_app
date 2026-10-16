import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BrandIcon } from '@/components/brand-icon';
import { FormError } from '@/components/form';
import { OfferGate } from '@/components/offer-gate';
import { PrimaryButton } from '@/components/primary-button';
import { DetailCard, Notice, StackScreen } from '@/components/stack-screen';
import { Brand, Fonts, Radius, Shadow } from '@/constants/brand';
import { useAuth } from '@/context/auth';
import {
  createOrder,
  installmentsLabel,
  paymentMethodLabels,
  type Offer,
  type PaymentMethod,
} from '@/services/commerce-api';
import { errorMessage } from '@/utils/errors';
import { formatAccessTerm, formatMoney } from '@/utils/format';

// Escolha da forma de pagamento e confirmação da compra. Só as formas habilitadas no curso e
// aceitas pelo provedor aparecem. Confirmar aqui é um ato separado do aceite dos Termos de Uso.
export default function CheckoutScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <OfferGate courseId={Number(id)}>{(offer) => <Checkout offer={offer} />}</OfferGate>;
}

function Checkout({ offer }: { offer: Offer }) {
  const { curso: course, comercial: commerce, pagamentos: payments } = offer;
  const { authorized } = useAuth();
  const [method, setMethod] = useState<PaymentMethod | undefined>(payments.metodos[0]?.forma);
  const [installments, setInstallments] = useState(1);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string>();

  const pix = payments.metodos.find((item) => item.forma === 'pix');
  const card = payments.metodos.find((item) => item.forma === 'cartao');
  const installment = card?.opcoes?.find((option) => option.parcelas === installments);
  // Total da forma escolhida; no cartão, só existe quando o provedor informou as parcelas.
  const total =
    method === 'pix' ? pix?.totalCentavos : method === 'cartao' ? installment?.totalCentavos : undefined;
  const ready = payments.disponivel && method !== undefined && total !== undefined;

  const confirm = async () => {
    if (!ready || saving) return;
    setFailure(undefined);
    setSaving(true);
    try {
      const order = await authorized((token) =>
        createOrder(token, {
          cursoId: course.id,
          formaPagamento: method,
          parcelas: method === 'cartao' ? installments : 1,
        })
      );
      router.replace({ pathname: '/order/[id]', params: { id: String(order.id) } });
    } catch (cause) {
      setFailure(errorMessage(cause));
      setSaving(false);
    }
  };

  return (
    <StackScreen
      title="Forma de pagamento"
      subtitle={course.titulo}
      footer={
        <>
          {failure !== undefined && <FormError message={failure} />}
          <PrimaryButton
            label={total !== undefined ? `Confirmar compra de ${formatMoney(total)}` : 'Confirmar compra'}
            onPress={confirm}
            disabled={!ready}
            loading={saving}
          />
          <Text style={styles.footnote}>
            A cobrança só acontece depois desta confirmação. O curso é liberado quando o pagamento for aprovado.
          </Text>
        </>
      }>
      {!payments.disponivel && (
        <Notice>
          O pagamento pelo aplicativo ainda não está disponível, por isso a compra não pode ser confirmada
          agora. Nenhum valor será cobrado.
        </Notice>
      )}

      <View accessibilityRole="radiogroup" style={styles.methods}>
        {pix && (
          <MethodOption
            icon="pix"
            title="Pix"
            value={formatMoney(pix.totalCentavos)}
            detail={
              pix.descontoCentavos > 0
                ? `Desconto de ${formatMoney(pix.descontoCentavos)} no pagamento à vista por Pix.`
                : 'Pagamento à vista, com confirmação em instantes.'
            }
            selected={method === 'pix'}
            onPress={() => setMethod('pix')}
          />
        )}
        {card && (
          <MethodOption
            icon="card"
            title="Cartão de crédito"
            value={card.maxParcelas > 1 ? `em até ${card.maxParcelas}x` : 'à vista'}
            detail={
              card.opcoes
                ? 'Escolha abaixo em quantas vezes quer pagar.'
                : 'As parcelas e os valores serão exibidos quando o pagamento por cartão estiver ativo.'
            }
            selected={method === 'cartao'}
            onPress={() => setMethod('cartao')}
          />
        )}
      </View>

      {method === 'cartao' && card?.opcoes && (
        <View accessibilityRole="radiogroup" style={styles.installments}>
          <Text style={styles.label}>Parcelas</Text>
          {card.opcoes.map((option) => {
            const selected = option.parcelas === installments;
            return (
              <Pressable
                key={option.parcelas}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                onPress={() => setInstallments(option.parcelas)}
                style={({ pressed }) => [styles.installment, selected && styles.selected, pressed && styles.pressed]}>
                <View style={[styles.radio, selected && styles.radioSelected]} />
                <Text style={styles.installmentText}>
                  {option.parcelas}x de {formatMoney(option.valorParcelaCentavos)}
                </Text>
                <Text style={styles.installmentTotal}>
                  {option.jurosCentavos > 0 ? `total ${formatMoney(option.totalCentavos)}` : 'sem juros'}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      <View style={styles.summary}>
        <Text accessibilityRole="header" style={styles.heading}>
          Resumo da compra
        </Text>
        <DetailCard
          rows={[
            { label: 'Curso', value: course.titulo },
            { label: 'Valor original', value: formatMoney(commerce.precoCentavos) },
            method === 'pix' &&
              pix !== undefined &&
              pix.descontoCentavos > 0 && { label: 'Desconto no Pix', value: `- ${formatMoney(pix.descontoCentavos)}` },
            method !== undefined && { label: 'Forma de pagamento', value: paymentMethodLabels[method] },
            method === 'cartao' &&
              installment !== undefined && {
                label: 'Parcelas',
                value: installmentsLabel(installment.parcelas, installment.valorParcelaCentavos),
              },
            method === 'cartao' &&
              installment !== undefined && {
                label: 'Juros',
                value: installment.jurosCentavos > 0 ? formatMoney(installment.jurosCentavos) : 'sem juros',
              },
            total !== undefined && { label: 'Total a pagar', value: formatMoney(total), strong: true },
            {
              label: 'Prazo de acesso',
              value: formatAccessTerm(commerce.prazoAcessoMeses),
              detail:
                commerce.prazoAcessoMeses !== null
                  ? 'Começa a contar na aprovação do pagamento.'
                  : undefined,
            },
          ]}
        />
        <Text style={styles.footnote}>
          As condições de cancelamento, arrependimento e reembolso desta compra são as dos Termos de Uso que
          você aceitou.
        </Text>
        <Pressable
          accessibilityRole="link"
          hitSlop={6}
          onPress={() => router.push('/terms')}
          style={({ pressed }) => pressed && styles.pressed}>
          <Text style={styles.link}>Consultar os Termos de Uso</Text>
        </Pressable>
      </View>
    </StackScreen>
  );
}

function MethodOption({
  icon,
  title,
  value,
  detail,
  selected,
  onPress,
}: {
  icon: 'pix' | 'card';
  title: string;
  value: string;
  detail: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${title}, ${value}. ${detail}`}
      onPress={onPress}
      style={({ pressed }) => [styles.method, selected && styles.selected, pressed && styles.pressed]}>
      <View style={styles.methodIcon}>
        <BrandIcon name={icon} size={18} strokeWidth={1.4} color={Brand.primaryDeep} />
      </View>
      <View style={styles.methodText}>
        <View style={styles.methodTop}>
          <Text style={styles.methodTitle}>{title}</Text>
          <Text style={styles.methodValue}>{value}</Text>
        </View>
        <Text style={styles.footnote}>{detail}</Text>
      </View>
      <View style={[styles.radio, selected && styles.radioSelected]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  methods: { gap: 10 },
  method: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: Brand.card,
    boxShadow: Shadow.field,
  },
  selected: { borderColor: Brand.primary },
  methodIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: Brand.surfaceSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  methodText: { flex: 1, gap: 3 },
  methodTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 },
  methodTitle: { fontFamily: Fonts.sansMedium, fontSize: 14.5, color: Brand.text },
  methodValue: { fontFamily: Fonts.sansSemiBold, fontSize: 14.5, color: Brand.text },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: Brand.primary },
  radioSelected: { borderWidth: 5 },
  installments: { gap: 8 },
  label: { fontFamily: Fonts.sansMedium, fontSize: 12.5, color: Brand.text },
  installment: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    borderRadius: Radius.tile,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: Brand.card,
  },
  installmentText: { flex: 1, fontFamily: Fonts.sansMedium, fontSize: 14, color: Brand.text },
  installmentTotal: { fontFamily: Fonts.sans, fontSize: 12.5, color: Brand.muted },
  summary: { gap: 10, marginTop: 4 },
  heading: { fontFamily: Fonts.serifMedium, fontSize: 20, lineHeight: 26, color: Brand.text },
  footnote: { fontFamily: Fonts.sans, fontSize: 12, lineHeight: 17, color: Brand.muted },
  link: { fontFamily: Fonts.sansMedium, fontSize: 13, color: Brand.primaryDeep, textDecorationLine: 'underline' },
  pressed: { opacity: 0.75 },
});
