import type { ReactNode, RefObject } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/primary-button';
import { ScreenHeader } from '@/components/screen-header';
import { Brand, ContentWidth, Fonts, Gutter, Radius } from '@/constants/brand';

export { errorMessage } from '@/utils/errors';

type Props = {
  title: string;
  subtitle?: string;
  children: ReactNode;
  /** Voltar com destino nomeado (ex.: "Cursos"), em vez da seta simples para a tela anterior. */
  back?: { label: string; onPress: () => void };
  /** Presentes nas telas de listagem: habilitam o "puxar para atualizar". */
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Para a tela rolar até um trecho (ex.: o campo com erro). */
  scrollRef?: RefObject<ScrollView | null>;
};

/** Estrutura comum das telas abertas a partir do Painel: cabeçalho, título e rolagem. */
export function AdminScaffold({ title, subtitle, children, back, refreshing, onRefresh, scrollRef }: Props) {
  return (
    <View style={styles.screen}>
      <ScreenHeader
        title={back ? 'Painel Administrativo' : 'Painel'}
        backLabel={back?.label}
        onBack={back?.onPress}
      />
      <KeyboardAvoidingView behavior="padding" style={styles.body}>
        <SafeAreaView edges={['bottom', 'left', 'right']} style={styles.body}>
          <ScrollView
            ref={scrollRef}
            keyboardShouldPersistTaps="handled"
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
            <View style={styles.intro}>
              <Text accessibilityRole="header" style={styles.title}>
                {title}
              </Text>
              {subtitle !== undefined && <Text style={styles.subtitle}>{subtitle}</Text>}
            </View>
            {children}
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </View>
  );
}

/** Carregamento inicial e erro com "Tentar novamente" de uma consulta. */
export function QueryState({
  loading,
  error,
  hasData,
  onRetry,
}: {
  loading: boolean;
  error?: string;
  hasData: boolean;
  onRetry: () => void;
}) {
  if (error !== undefined) {
    return (
      <View style={styles.notice}>
        <Text accessibilityLiveRegion="polite" style={styles.noticeText}>
          {error}
        </Text>
        <PrimaryButton variant="outline" label="Tentar novamente" onPress={onRetry} />
      </View>
    );
  }
  if (loading && !hasData) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Brand.primary} size="large" />
      </View>
    );
  }
  return null;
}

/** Confirmação antes de uma ação que não pode ser desfeita. */
export function confirmAction(title: string, message: string, confirmLabel: string, onConfirm: () => void) {
  if (Platform.OS === 'web') {
    if (window.confirm(`${title}\n\n${message}`)) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: 'Cancelar', style: 'cancel' },
    { text: confirmLabel, style: 'destructive', onPress: onConfirm },
  ]);
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Brand.background },
  body: { flex: 1 },
  content: {
    flexGrow: 1,
    width: '100%',
    maxWidth: ContentWidth,
    alignSelf: 'center',
    paddingHorizontal: Gutter,
    paddingTop: 4,
    paddingBottom: 32,
    gap: 16,
  },
  intro: { gap: 4, marginBottom: 2 },
  title: { fontFamily: Fonts.serifMedium, fontSize: 28, lineHeight: 34, color: Brand.text },
  subtitle: { fontFamily: Fonts.sans, fontSize: 13.5, lineHeight: 20, color: Brand.muted },
  center: { paddingVertical: 48, alignItems: 'center' },
  notice: { gap: 12, padding: 16, borderRadius: Radius.card, backgroundColor: Brand.surfaceSoft },
  noticeText: { fontFamily: Fonts.sans, fontSize: 13.5, lineHeight: 20, color: Brand.text },
});
