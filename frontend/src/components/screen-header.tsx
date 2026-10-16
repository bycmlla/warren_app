import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BrandIcon } from '@/components/brand-icon';
import { Brand, ContentWidth, Fonts, Gutter, Radius } from '@/constants/brand';

type Props = {
  title?: string;
  /** Nome do destino do Voltar (ex.: "Cursos"). Com ele, o botão mostra o texto e o título vai para a direita. */
  backLabel?: string;
  /** Substitui o comportamento padrão de voltar à tela anterior. */
  onBack?: () => void;
  /** Sem fundo próprio: quem usa o cabeçalho pinta a área atrás dele. */
  transparent?: boolean;
};

/** Cabeçalho das telas abertas sobre as abas (detalhes, login, telas do Painel). */
export function ScreenHeader({ title, backLabel, onBack, transparent = false }: Props) {
  const goBack = onBack ?? (() => (router.canGoBack() ? router.back() : router.replace('/')));
  const labeled = backLabel !== undefined;
  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={transparent ? undefined : styles.safeArea}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={labeled ? `Voltar para ${backLabel}` : 'Voltar'}
          hitSlop={4}
          onPress={goBack}
          style={({ pressed }) => [styles.back, labeled && styles.labeledBack, pressed && styles.pressed]}>
          <BrandIcon name="back" size={20} color={Brand.text} />
          {labeled && (
            <Text maxFontSizeMultiplier={1.2} style={styles.backText}>
              {backLabel}
            </Text>
          )}
        </Pressable>
        {title !== undefined && (
          <Text
            numberOfLines={1}
            maxFontSizeMultiplier={1.2}
            style={[styles.title, labeled && styles.sideTitle]}>
            {title}
          </Text>
        )}
        {!labeled && <View style={styles.spacer} />}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: Brand.background },
  header: {
    width: '100%',
    maxWidth: ContentWidth,
    alignSelf: 'center',
    paddingHorizontal: Gutter,
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  back: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Brand.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  labeledBack: {
    width: undefined,
    flexDirection: 'row',
    gap: 4,
    paddingLeft: 10,
    paddingRight: 16,
    borderRadius: Radius.pill,
  },
  backText: { fontFamily: Fonts.sansMedium, fontSize: 13.5, color: Brand.text },
  title: {
    flex: 1,
    fontFamily: Fonts.serif,
    fontSize: 15,
    letterSpacing: 0.8,
    color: Brand.text,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  // Ao lado de um Voltar com texto, o título vira uma identificação discreta à direita.
  sideTitle: {
    fontFamily: Fonts.sansMedium,
    fontSize: 10.5,
    letterSpacing: 1,
    color: Brand.muted,
    textAlign: 'right',
  },
  spacer: { width: 40 },
  pressed: { opacity: 0.65 },
});
