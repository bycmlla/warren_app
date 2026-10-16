import type { ReactNode } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/screen-header';
import { Brand, Fonts, Gutter, Radius } from '@/constants/brand';

const WIDTH = 640;

type Props = {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  /** Ações fixas no rodapé (ex.: "Comprar agora"). */
  footer?: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
};

/** Estrutura das telas do aluno abertas sobre as abas: cabeçalho com Voltar, título e rolagem. */
export function StackScreen({ title, subtitle, children, footer, refreshing, onRefresh }: Props) {
  return (
    <View style={styles.screen}>
      <ScreenHeader />
      <SafeAreaView edges={footer ? ['left', 'right'] : ['bottom', 'left', 'right']} style={styles.body}>
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={
            onRefresh ? (
              <RefreshControl
                refreshing={refreshing ?? false}
                onRefresh={onRefresh}
                colors={[Brand.primary]}
                tintColor={Brand.primary}
              />
            ) : undefined
          }>
          {title !== undefined && (
            <View style={styles.intro}>
              <Text accessibilityRole="header" style={styles.title}>
                {title}
              </Text>
              {subtitle !== undefined && <Text style={styles.subtitle}>{subtitle}</Text>}
            </View>
          )}
          {children}
        </ScrollView>
      </SafeAreaView>
      {footer !== undefined && (
        <SafeAreaView edges={['bottom', 'left', 'right']} style={styles.footer}>
          <View style={styles.footerContent}>{footer}</View>
        </SafeAreaView>
      )}
    </View>
  );
}

export type DetailRow = { label: string; value: string; detail?: string; strong?: boolean };

/** Quadro de pares "rótulo — valor" (condições de um curso, resumo de uma compra). */
export function DetailCard({ rows }: { rows: (DetailRow | null | false | undefined)[] }) {
  const visible = rows.filter((row): row is DetailRow => Boolean(row));
  return (
    <View style={styles.card}>
      {visible.map((row, index) => (
        <View
          key={row.label}
          accessible
          accessibilityLabel={`${row.label}: ${row.value}${row.detail ? `. ${row.detail}` : ''}`}
          style={[styles.row, index > 0 && styles.divider]}>
          <View style={styles.rowTop}>
            <Text style={styles.label}>{row.label}</Text>
            <Text style={[styles.value, row.strong && styles.strong]}>{row.value}</Text>
          </View>
          {row.detail !== undefined && <Text style={styles.detail}>{row.detail}</Text>}
        </View>
      ))}
    </View>
  );
}

/** Aviso em destaque suave (pagamento indisponível, acesso perto de vencer). */
export function Notice({ children }: { children: ReactNode }) {
  return (
    <Text accessibilityLiveRegion="polite" style={styles.notice}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Brand.background },
  body: { flex: 1 },
  content: {
    flexGrow: 1,
    width: '100%',
    maxWidth: WIDTH,
    alignSelf: 'center',
    paddingHorizontal: Gutter,
    paddingTop: 4,
    paddingBottom: 28,
    gap: 16,
  },
  intro: { gap: 6, marginBottom: 2 },
  title: { fontFamily: Fonts.serifMedium, fontSize: 27, lineHeight: 34, color: Brand.text },
  subtitle: { fontFamily: Fonts.sans, fontSize: 14, lineHeight: 21, color: Brand.muted },
  footer: {
    backgroundColor: Brand.card,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Brand.hairline,
  },
  footerContent: {
    width: '100%',
    maxWidth: WIDTH,
    alignSelf: 'center',
    paddingHorizontal: Gutter,
    paddingTop: 12,
    paddingBottom: 10,
    gap: 8,
  },
  card: { borderRadius: Radius.field, backgroundColor: Brand.surfaceSoft, paddingHorizontal: 16 },
  row: { paddingVertical: 12, gap: 3 },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 16 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Brand.primarySoft },
  label: { fontFamily: Fonts.sans, fontSize: 13, color: Brand.muted },
  value: { flex: 1, fontFamily: Fonts.sansMedium, fontSize: 13.5, color: Brand.text, textAlign: 'right' },
  // Algarismos alinhados: no estilo antigo da Playfair o zero se confunde com a letra O.
  strong: { fontFamily: Fonts.serifMedium, fontVariant: ['lining-nums'], fontSize: 20, lineHeight: 26 },
  detail: { fontFamily: Fonts.sans, fontSize: 12, lineHeight: 17, color: Brand.muted },
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
});
