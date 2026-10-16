import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BrandIcon, BrandMark } from '@/components/brand-icon';
import { OfferGate } from '@/components/offer-gate';
import { PrimaryButton } from '@/components/primary-button';
import { fileUrl } from '@/constants/api';
import { Brand, Fonts, Gutter, Radius } from '@/constants/brand';
import type { Offer } from '@/services/commerce-api';
import { formatAccessTerm, formatLessons, formatModules, formatMoney } from '@/utils/format';

// Oferta de um curso pago: aparece depois do login e do aceite dos Termos de Uso, para quem
// ainda não tem acesso. Tudo o que é exibido vem do cadastro do curso no backend.
export default function OfferScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <OfferGate courseId={Number(id)}>{(offer) => <OfferView offer={offer} />}</OfferGate>;
}

function OfferView({ offer }: { offer: Offer }) {
  const { curso: course, comercial: commerce, pagamentos: payments } = offer;
  const cover = fileUrl(course.imagemCapa);
  const card = payments.metodos.find((method) => method.forma === 'cartao');
  const pix = payments.metodos.find((method) => method.forma === 'pix');
  // A condição com mais parcelas, quando o provedor já informou os valores reais.
  const longest = card?.opcoes?.at(-1);
  const summary = course.descricao ?? course.subtitulo;
  const pending = offer.pedidoPendenteId;

  const buy = () =>
    pending !== null
      ? router.push({ pathname: '/order/[id]', params: { id: String(pending) } })
      : router.push({ pathname: '/checkout/[id]', params: { id: String(course.id) } });

  return (
    <View style={styles.screen}>
      {/* A capa do curso aparece só aqui, desfocada e suavizada, como ambientação. */}
      {cover !== null && (
        <Image source={{ uri: cover }} blurRadius={28} contentFit="cover" accessible={false} style={styles.fill} />
      )}
      {cover !== null && <View style={[styles.fill, styles.veil]} />}

      <SafeAreaView edges={['top', 'left', 'right']}>
        <View style={styles.header}>
          <View style={styles.brand}>
            <BrandMark size={28} />
            <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={styles.wordmark}>
              JOANALIA WARREN
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Fechar"
            hitSlop={6}
            onPress={() => router.back()}
            style={({ pressed }) => [styles.close, pressed && styles.pressed]}>
            <BrandIcon name="close" size={18} color={Brand.text} />
          </Pressable>
        </View>
      </SafeAreaView>

      <SafeAreaView edges={['bottom', 'left', 'right']} style={styles.body}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.intro}>
            <Text accessibilityRole="header" style={styles.title}>
              Quer ter acesso a este conteúdo exclusivo?
            </Text>
            <Text style={styles.subtitle}>Escolha uma das opções abaixo</Text>
          </View>

          <View style={styles.card}>
            <View style={styles.identity}>
              <Text accessibilityRole="header" style={styles.courseTitle}>
                {course.titulo}
              </Text>
              {course.instrutora !== null && <Text style={styles.instructor}>Instrutora: {course.instrutora}</Text>}
            </View>

            <View style={styles.prices}>
              <View style={styles.priceRow}>
                <Text style={styles.price}>{formatMoney(commerce.precoCentavos)}</Text>
                <Text style={styles.priceUnit}>à vista</Text>
              </View>
              {pix !== undefined && (
                <Text style={styles.condition}>
                  <Text style={styles.conditionLabel}>Pix: </Text>
                  {formatMoney(pix.totalCentavos)}
                  {pix.descontoCentavos > 0 ? ` · economia de ${formatMoney(pix.descontoCentavos)}` : ''}
                </Text>
              )}
              {card !== undefined && (
                <Text style={styles.condition}>
                  <Text style={styles.conditionLabel}>Cartão: </Text>
                  {longest && longest.parcelas > 1
                    ? `até ${longest.parcelas}x de ${formatMoney(longest.valorParcelaCentavos)}`
                    : card.maxParcelas > 1
                      ? `em até ${card.maxParcelas}x`
                      : 'à vista'}
                </Text>
              )}
            </View>

            {summary !== null && (
              <Text numberOfLines={4} style={styles.summary}>
                {summary}
              </Text>
            )}

            <View style={styles.details}>
              <Text style={styles.detail}>
                {formatModules(course.totalModulos)} · {formatLessons(course.totalAulas)}
              </Text>
              <Text style={styles.detail}>
                {commerce.prazoAcessoMeses === null
                  ? 'Acesso sem vencimento definido'
                  : `Acesso por ${formatAccessTerm(commerce.prazoAcessoMeses)} após a confirmação do pagamento`}
              </Text>
            </View>

            {!payments.disponivel && (
              <Text accessibilityLiveRegion="polite" style={styles.notice}>
                O pagamento pelo aplicativo ainda não está disponível. Você já pode conferir as condições; a
                compra será liberada em breve e nada será cobrado agora.
              </Text>
            )}
            <PrimaryButton label={pending !== null ? 'Acompanhar pagamento' : 'Comprar agora'} onPress={buy} />
          </View>

          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => router.back()}
            style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
            <Text style={styles.backText}>Voltar aos detalhes do curso</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Brand.background },
  fill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  // Véu branco-pérola sobre a capa desfocada: mantém a tela clara e o texto legível.
  veil: { backgroundColor: 'rgba(250, 245, 236, 0.72)' },
  header: {
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    paddingHorizontal: Gutter,
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 },
  wordmark: { fontFamily: Fonts.serif, fontSize: 15, letterSpacing: 0.8, color: Brand.text, flexShrink: 1 },
  close: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Brand.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1 },
  content: {
    flexGrow: 1,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    paddingHorizontal: Gutter,
    paddingTop: 18,
    paddingBottom: 28,
    gap: 22,
  },
  intro: { alignItems: 'center', gap: 8, paddingHorizontal: 8 },
  title: {
    fontFamily: Fonts.serifMedium,
    fontSize: 21,
    lineHeight: 29,
    letterSpacing: 1,
    color: Brand.text,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  subtitle: { fontFamily: Fonts.sans, fontSize: 14, lineHeight: 20, color: Brand.text, textAlign: 'center' },
  card: {
    gap: 16,
    padding: 22,
    borderRadius: Radius.hero,
    backgroundColor: Brand.card,
    boxShadow: '0 10px 30px rgba(72, 75, 60, 0.12)',
  },
  identity: { gap: 4 },
  courseTitle: {
    fontFamily: Fonts.serifMedium,
    fontSize: 24,
    lineHeight: 30,
    letterSpacing: 0.6,
    color: Brand.text,
    textTransform: 'uppercase',
  },
  instructor: { fontFamily: Fonts.sansMedium, fontSize: 13, lineHeight: 19, color: Brand.primaryDeep },
  prices: {
    gap: 6,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: Brand.primarySoft,
  },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  // Algarismos alinhados: no estilo antigo da Playfair o zero se confunde com a letra O.
  price: { fontFamily: Fonts.serifMedium, fontVariant: ['lining-nums'], fontSize: 30, lineHeight: 38, color: Brand.text },
  priceUnit: { fontFamily: Fonts.sans, fontSize: 14, color: Brand.muted },
  condition: { fontFamily: Fonts.sans, fontSize: 14, lineHeight: 21, color: Brand.text },
  conditionLabel: { fontFamily: Fonts.sansSemiBold },
  summary: { fontFamily: Fonts.sans, fontSize: 14, lineHeight: 21, color: Brand.muted },
  details: { gap: 4 },
  detail: { fontFamily: Fonts.sansMedium, fontSize: 13, lineHeight: 19, color: Brand.text },
  notice: {
    fontFamily: Fonts.sans,
    fontSize: 12.5,
    lineHeight: 18,
    color: Brand.text,
    backgroundColor: Brand.surfaceSoft,
    borderRadius: Radius.tile,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  back: { alignSelf: 'center', minHeight: 44, justifyContent: 'center' },
  backText: { fontFamily: Fonts.sansMedium, fontSize: 13.5, color: Brand.text, textDecorationLine: 'underline' },
  pressed: { opacity: 0.7 },
});
