import { Tabs, TabList, TabSlot, TabTrigger, type TabTriggerSlotProps } from 'expo-router/ui';
import { Pressable, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BrandIcon, type IconName } from '@/components/brand-icon';
import { Brand, ContentWidth, Fonts } from '@/constants/brand';
import { useAuth } from '@/context/auth';
import { openLogin, protectedRoutes, type ProtectedArea } from '@/hooks/use-protected-navigation';

export default function BrandTabs() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  return (
    <Tabs style={styles.container}>
      <TabSlot style={styles.slot} />
      <TabList asChild>
        <SafeAreaView edges={['bottom', 'left', 'right']} style={styles.navigation}>
          <TabTrigger name="home" href="/" asChild>
            <TabButton icon="home">Início</TabButton>
          </TabTrigger>
          {/* O catálogo é público: visitantes também exploram os cursos. */}
          <TabTrigger name="explore" href="/explore" asChild>
            <TabButton icon="compass">Explorar</TabButton>
          </TabTrigger>
          <TabTrigger name="downloads" href={protectedRoutes.downloads} asChild>
            <TabButton icon="download" protectedArea="downloads">
              Downloads
            </TabButton>
          </TabTrigger>
          {/* A rota do Painel fica sempre registrada, para o número de abas visíveis poder mudar sem
              reconfigurar a navegação; o botão só existe para ADMIN e a tela valida o acesso. */}
          <TabTrigger name="panel" href="/panel" asChild>
            <TabButton icon="dashboard" hidden={!isAdmin}>
              Painel
            </TabButton>
          </TabTrigger>
          <TabTrigger name="profile" href={protectedRoutes.profile} asChild>
            <TabButton icon="profile" protectedArea="profile">
              Perfil
            </TabButton>
          </TabTrigger>
        </SafeAreaView>
      </TabList>
    </Tabs>
  );
}

function TabButton({
  children,
  isFocused,
  icon,
  protectedArea,
  hidden = false,
  onPress,
  ...props
}: TabTriggerSlotProps & { icon: IconName; protectedArea?: ProtectedArea; hidden?: boolean }) {
  const { user } = useAuth();
  if (hidden) return null;
  return (
    <Pressable
      {...props}
      // Visitantes não entram nas áreas restritas: vão ao login e retornam à área depois.
      onPress={(event) => (protectedArea && !user ? openLogin(protectedArea) : onPress?.(event))}
      accessibilityRole="tab"
      accessibilityState={{ selected: isFocused }}
      style={({ pressed }) => [styles.tabButton, pressed && styles.pressed]}>
      <BrandIcon
        name={icon}
        color={isFocused ? Brand.primary : Brand.muted}
        size={23}
        strokeWidth={isFocused ? 1.8 : 1.4}
        filled={isFocused && icon === 'home'}
      />
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.85}
        maxFontSizeMultiplier={1.3}
        style={[styles.label, isFocused && styles.activeLabel]}>
        {children}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Brand.background },
  slot: { flex: 1 },
  navigation: {
    backgroundColor: Brand.card,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Brand.hairline,
    flexDirection: 'row',
    width: '100%',
    maxWidth: ContentWidth,
    alignSelf: 'center',
  },
  tabButton: {
    flex: 1,
    minHeight: 62,
    paddingTop: 10,
    paddingBottom: 8,
    paddingHorizontal: 2,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  label: { fontFamily: Fonts.sans, fontSize: 11.5, textAlign: 'center', color: Brand.muted },
  activeLabel: { fontFamily: Fonts.sansSemiBold, color: Brand.primaryDeep },
  pressed: { opacity: 0.6 },
});
