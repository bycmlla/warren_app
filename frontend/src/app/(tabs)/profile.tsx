import { router, type Href } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BrandIcon, type IconName } from '@/components/brand-icon';
import { HomeHeader } from '@/components/home-header';
import { PrimaryButton } from '@/components/primary-button';
import { ProfilePhotoEditor } from '@/components/profile-photo-editor';
import { AuthGate } from '@/components/section-placeholder';
import { Brand, ContentWidth, Fonts, Gutter, Radius, Shadow } from '@/constants/brand';
import { useAuth } from '@/context/auth';

const studentLinks: { icon: IconName; label: string; href: Href }[] = [
  { icon: 'library', label: 'Meus cursos', href: '/my-courses' },
  { icon: 'receipt', label: 'Histórico de compras', href: '/purchases' },
];
const legalLinks: { icon: IconName; label: string; href: Href }[] = [
  { icon: 'document', label: 'Termos de Uso', href: '/terms' },
  { icon: 'lock', label: 'Política de Privacidade', href: '/privacy' },
];

// Perfil pessoal, igual para alunos e para a administradora (que ganha só a identificação
// e não tem cursos nem compras próprios).
// As ferramentas administrativas ficam exclusivamente na aba Painel.
export default function ProfileScreen() {
  const { user, signOut } = useAuth();
  if (!user) return <AuthGate area="profile" areaLabel="seu perfil" />;

  const leave = async () => {
    router.navigate('/');
    await signOut();
  };

  return (
    <View style={styles.screen}>
      <HomeHeader />
      <SafeAreaView edges={['left', 'right']} style={styles.body}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text accessibilityRole="header" style={styles.title}>
            Perfil
          </Text>
          <View style={styles.card}>
            <ProfilePhotoEditor user={user} />
            <View style={styles.identity}>
              <Text style={styles.name}>{user.nome}</Text>
              {user.role === 'ADMIN' && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>Administradora</Text>
                </View>
              )}
            </View>
          </View>

          <View style={styles.info}>
            <InfoRow label="E-mail" value={user.email} />
            {user.telefone !== null && <InfoRow label="Telefone" value={user.telefone} divided />}
          </View>

          <View style={styles.links}>
            {[...(user.role === 'ADMIN' ? [] : studentLinks), ...legalLinks].map((link, index) => (
              <Pressable
                key={link.label}
                accessibilityRole="button"
                accessibilityLabel={link.label}
                onPress={() => router.push(link.href)}
                android_ripple={{ color: Brand.surface }}
                style={({ pressed }) => [styles.link, index > 0 && styles.infoDivider, pressed && styles.pressed]}>
                <View style={styles.linkIcon}>
                  <BrandIcon name={link.icon} size={17} strokeWidth={1.4} />
                </View>
                <Text style={styles.linkLabel}>{link.label}</Text>
                <BrandIcon name="chevron" size={18} color={Brand.muted} />
              </Pressable>
            ))}
          </View>

          <PrimaryButton variant="outline" label="Sair da conta" onPress={leave} />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function InfoRow({ label, value, divided = false }: { label: string; value: string; divided?: boolean }) {
  return (
    <View style={[styles.infoRow, divided && styles.infoDivider]}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Brand.background },
  body: { flex: 1 },
  content: {
    width: '100%',
    maxWidth: ContentWidth,
    alignSelf: 'center',
    paddingHorizontal: Gutter,
    paddingTop: 10,
    paddingBottom: 28,
    gap: 16,
  },
  title: { fontFamily: Fonts.serifMedium, fontSize: 28, lineHeight: 34, color: Brand.text },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    padding: 18,
    borderRadius: Radius.cardLarge,
    backgroundColor: Brand.card,
    boxShadow: Shadow.card,
  },
  identity: { flex: 1, alignItems: 'flex-start', gap: 8 },
  name: { fontFamily: Fonts.serif, fontSize: 20, lineHeight: 26, color: Brand.text },
  badge: {
    borderRadius: Radius.pill,
    backgroundColor: Brand.surface,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: {
    fontFamily: Fonts.sansMedium,
    fontSize: 11,
    letterSpacing: 0.3,
    color: Brand.primaryDeep,
  },
  info: {
    borderRadius: Radius.card,
    backgroundColor: Brand.surfaceSoft,
    paddingHorizontal: 16,
    marginBottom: 4,
  },
  links: {
    borderRadius: Radius.card,
    backgroundColor: Brand.card,
    boxShadow: Shadow.card,
    overflow: 'hidden',
    marginBottom: 4,
  },
  link: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 58, paddingHorizontal: 14 },
  linkIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: Brand.surfaceSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkLabel: { flex: 1, fontFamily: Fonts.sansMedium, fontSize: 14.5, color: Brand.text },
  pressed: { opacity: 0.75 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 16, paddingVertical: 13 },
  infoDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Brand.primarySoft },
  infoLabel: { fontFamily: Fonts.sans, fontSize: 13, color: Brand.muted },
  infoValue: {
    flex: 1,
    fontFamily: Fonts.sansMedium,
    fontSize: 13,
    color: Brand.text,
    textAlign: 'right',
  },
});
