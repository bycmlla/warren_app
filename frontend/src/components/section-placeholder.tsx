import { router } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BrandIcon, type IconName } from '@/components/brand-icon';
import { HomeHeader } from '@/components/home-header';
import { PrimaryButton } from '@/components/primary-button';
import { Brand, ContentWidth, Fonts } from '@/constants/brand';
import { openLogin, type ProtectedArea } from '@/hooks/use-protected-navigation';

type Action = { label: string; onPress: () => void };

type Props = {
  title: string;
  description: string;
  icon: IconName;
  action?: Action;
  secondaryAction?: Action;
};

export function SectionPlaceholder({ title, description, icon, action, secondaryAction }: Props) {
  return (
    <View style={styles.screen}>
      <HomeHeader />
      <SafeAreaView edges={['left', 'right']} style={styles.body}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.iconCircle}>
            <BrandIcon name={icon} size={30} strokeWidth={1.3} />
          </View>
          <Text accessibilityRole="header" style={styles.title}>
            {title}
          </Text>
          <Text style={styles.description}>{description}</Text>
          <View style={styles.actions}>
            {action && <PrimaryButton label={action.label} onPress={action.onPress} />}
            {secondaryAction && (
              <PrimaryButton
                variant="outline"
                label={secondaryAction.label}
                onPress={secondaryAction.onPress}
              />
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

/** Exibido quando um visitante chega a uma área restrita sem passar pelo login. */
export function AuthGate({ area, areaLabel }: { area: ProtectedArea; areaLabel: string }) {
  return (
    <SectionPlaceholder
      icon="lock"
      title="Entre para continuar"
      description={`Faça login ou crie sua conta para acessar ${areaLabel}.`}
      action={{ label: 'Entrar ou criar conta', onPress: () => openLogin(area) }}
      secondaryAction={{ label: 'Voltar ao início', onPress: () => router.navigate('/') }}
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Brand.background },
  body: { flex: 1 },
  content: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    maxWidth: ContentWidth,
    alignSelf: 'center',
    padding: 28,
    gap: 16,
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Brand.surfaceSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  title: {
    alignSelf: 'stretch',
    fontFamily: Fonts.serifMedium,
    fontSize: 26,
    lineHeight: 32,
    color: Brand.text,
    textAlign: 'center',
  },
  description: {
    fontFamily: Fonts.sans,
    fontSize: 14.5,
    lineHeight: 22,
    color: Brand.muted,
    textAlign: 'center',
    maxWidth: 320,
  },
  actions: { alignSelf: 'center', maxWidth: 320, width: '100%', gap: 10, marginTop: 8 },
});
