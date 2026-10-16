import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from '@/components/avatar';
import { BrandIcon, BrandMark } from '@/components/brand-icon';
import { Brand, ContentWidth, Fonts, Gutter } from '@/constants/brand';
import { useAuth } from '@/context/auth';
import { useProtectedNavigation } from '@/hooks/use-protected-navigation';

export function HomeHeader() {
  const openProtected = useProtectedNavigation();
  const { user } = useAuth();
  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.safeArea}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Joanalia Warren, início"
          onPress={() => router.navigate('/')}
          style={({ pressed }) => [styles.logoButton, pressed && styles.pressed]}>
          <BrandMark size={30} />
          <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={styles.wordmark}>
            JOANALIA WARREN
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Perfil"
          hitSlop={4}
          onPress={() => openProtected('profile')}
          style={({ pressed }) => [styles.profile, pressed && styles.pressed]}>
          {user ? (
            <Avatar name={user.nome} photoUrl={user.fotoPerfil} size={40} />
          ) : (
            <BrandIcon name="identity" size={20} strokeWidth={1.4} />
          )}
        </Pressable>
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
    justifyContent: 'space-between',
    gap: 12,
  },
  logoButton: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexShrink: 1,
  },
  wordmark: {
    fontFamily: Fonts.serif,
    fontSize: 15,
    letterSpacing: 0.8,
    color: Brand.text,
    flexShrink: 1,
  },
  profile: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Brand.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.65 },
});
