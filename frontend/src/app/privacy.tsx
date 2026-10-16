import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LegalMeta, LegalText } from '@/components/legal-text';
import { PrimaryButton } from '@/components/primary-button';
import { ScreenHeader } from '@/components/screen-header';
import { Brand, Fonts, Gutter } from '@/constants/brand';
import { usePublicQuery } from '@/hooks/use-authorized-query';
import { fetchPrivacy } from '@/services/commerce-api';

const loadPrivacy = () => fetchPrivacy();

// Política de Privacidade vigente, como publicada no backend. Leitura livre, sem login.
export default function PrivacyScreen() {
  const { data, error, loading, reload } = usePublicQuery(loadPrivacy);

  return (
    <View style={styles.screen}>
      <ScreenHeader />
      <SafeAreaView edges={['bottom', 'left', 'right']} style={styles.body}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text accessibilityRole="header" style={styles.title}>
            Política de Privacidade
          </Text>
          {data ? (
            <>
              <LegalMeta document={data} />
              <LegalText text={data.texto} />
            </>
          ) : data === null ? (
            <Text style={styles.text}>A Política de Privacidade ainda não foi publicada.</Text>
          ) : error !== undefined ? (
            <>
              <Text accessibilityLiveRegion="polite" style={styles.text}>
                {error}
              </Text>
              <PrimaryButton variant="outline" label="Tentar novamente" onPress={reload} />
            </>
          ) : (
            loading && <ActivityIndicator color={Brand.primary} size="large" style={styles.loading} />
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Brand.background },
  body: { flex: 1 },
  content: {
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
    paddingHorizontal: Gutter,
    paddingBottom: 32,
    gap: 12,
  },
  title: { fontFamily: Fonts.serifMedium, fontSize: 28, lineHeight: 34, color: Brand.text },
  text: { fontFamily: Fonts.sans, fontSize: 14.5, lineHeight: 22, color: Brand.muted },
  loading: { marginTop: 40 },
});
