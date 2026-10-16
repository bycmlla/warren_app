import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BrandIcon } from '@/components/brand-icon';
import { FormError } from '@/components/form';
import { LegalMeta, LegalText } from '@/components/legal-text';
import { PrimaryButton } from '@/components/primary-button';
import { ScreenHeader } from '@/components/screen-header';
import { Brand, Fonts, Gutter, Radius, Shadow } from '@/constants/brand';
import { useAuth } from '@/context/auth';
import { usePublicQuery } from '@/hooks/use-authorized-query';
import { ApiError } from '@/services/auth-api';
import { acceptTerms, fetchTerms, type TermsStatus } from '@/services/commerce-api';
import { errorMessage } from '@/utils/errors';
import { formatDateTime } from '@/utils/format';

const WIDTH = 640;

type Params = { courseId?: string; lessonId?: string; offer?: string };

/**
 * Termos de Uso. Aberta a partir de um curso (ao iniciar ou comprar), exige o aceite explícito
 * da versão vigente e então segue para a aula ou para a oferta; aberta pelo Perfil, serve para
 * consulta. O aceite é registrado no backend, que também o exige antes de qualquer compra.
 */
export default function TermsScreen() {
  const { data, error, loading, reload } = usePublicQuery(fetchTerms);

  if (data?.termos) return <Terms key={data.termos.id} data={data} onOutdated={reload} />;
  return (
    <View style={styles.screen}>
      <ScreenHeader title="Termos de Uso" />
      <View style={styles.missing}>
        {data !== undefined ? (
          <>
            <Text style={styles.text}>
              Os Termos de Uso ainda não foram publicados. Enquanto isso, a compra de cursos pelo aplicativo
              fica indisponível.
            </Text>
            <PrimaryButton variant="outline" label="Voltar" onPress={() => router.back()} />
          </>
        ) : error !== undefined ? (
          <>
            <Text accessibilityLiveRegion="polite" style={styles.text}>
              {error}
            </Text>
            <PrimaryButton variant="outline" label="Tentar novamente" onPress={reload} />
          </>
        ) : (
          loading && <ActivityIndicator color={Brand.primary} size="large" />
        )}
      </View>
    </View>
  );
}

function Terms({ data, onOutdated }: { data: TermsStatus; onOutdated: () => void }) {
  const params = useLocalSearchParams<Params>();
  const { user, authorized } = useAuth();
  // O aceite nunca vem marcado: é sempre uma ação do próprio usuário.
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string>();
  const document = data.termos;
  if (!document) return null;

  // A administradora não compra nem depende de aceite para abrir os cursos.
  const mustAccept = user !== null && user.role !== 'ADMIN' && data.aceite === null;

  const accept = async () => {
    if (!checked || saving) return;
    setFailure(undefined);
    setSaving(true);
    try {
      await authorized((token) => acceptTerms(token, document));
    } catch (cause) {
      setSaving(false);
      setFailure(errorMessage(cause));
      // Os termos mudaram enquanto a tela estava aberta: mostra a versão nova, sem aceite marcado.
      if (cause instanceof ApiError && cause.data.codigo === 'TERMOS_ATUALIZADOS') onOutdated();
      return;
    }
    // Aceite registrado: segue de onde o aluno estava (oferta do curso pago ou aula).
    if (params.offer && params.courseId) {
      router.replace({ pathname: '/offer/[id]', params: { id: params.courseId } });
    } else if (params.lessonId) {
      router.replace({ pathname: '/lesson/[id]', params: { id: params.lessonId } });
    } else {
      router.back();
    }
  };

  return (
    <View style={styles.screen}>
      <ScreenHeader />
      <View style={styles.body}>
        <View style={styles.intro}>
          <Text accessibilityRole="header" style={styles.title}>
            Termos de Uso
          </Text>
          <LegalMeta document={document} />
        </View>

        <View style={styles.reader}>
          <ScrollView contentContainerStyle={styles.readerContent} persistentScrollbar>
            <LegalText text={document.texto} />
          </ScrollView>
        </View>
      </View>

      <SafeAreaView edges={['bottom', 'left', 'right']} style={styles.footer}>
        <View style={styles.footerContent}>
          <Pressable
            accessibilityRole="link"
            onPress={() => router.push('/privacy')}
            hitSlop={6}
            style={({ pressed }) => pressed && styles.pressed}>
            <Text style={styles.link}>Ler a Política de Privacidade</Text>
          </Pressable>

          {mustAccept ? (
            <>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked }}
                accessibilityLabel="Li e concordo com os Termos de Uso"
                onPress={() => setChecked((current) => !current)}
                style={({ pressed }) => [styles.checkRow, pressed && styles.pressed]}>
                <View style={[styles.box, checked && styles.boxChecked]}>
                  {checked && <BrandIcon name="check" size={15} strokeWidth={2.2} color={Brand.white} />}
                </View>
                <Text style={styles.checkLabel}>Li e concordo com os Termos de Uso</Text>
              </Pressable>
              {failure !== undefined && <FormError message={failure} />}
              <PrimaryButton label="Aceitar e continuar" onPress={accept} disabled={!checked} loading={saving} />
              <PrimaryButton variant="outline" label="Não aceito" onPress={() => router.back()} />
              <Text style={styles.hint}>
                Sem o aceite não é possível iniciar um curso nem seguir para a compra. Aceitar os termos não
                autoriza nenhuma cobrança.
              </Text>
            </>
          ) : (
            <>
              {data.aceite !== null && (
                <Text style={styles.accepted}>
                  Você aceitou a versão {data.aceite.versao} em {formatDateTime(data.aceite.aceitoEm)}.
                </Text>
              )}
              <PrimaryButton variant="outline" label="Voltar" onPress={() => router.back()} />
            </>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Brand.background },
  missing: { flex: 1, justifyContent: 'center', padding: 28, gap: 14 },
  body: {
    flex: 1,
    width: '100%',
    maxWidth: WIDTH,
    alignSelf: 'center',
    paddingHorizontal: Gutter,
    paddingBottom: 14,
    gap: 14,
  },
  intro: { gap: 4 },
  title: { fontFamily: Fonts.serifMedium, fontSize: 28, lineHeight: 34, color: Brand.text },
  text: { fontFamily: Fonts.sans, fontSize: 14.5, lineHeight: 22, color: Brand.muted },
  reader: {
    flex: 1,
    borderRadius: Radius.card,
    backgroundColor: Brand.card,
    boxShadow: Shadow.field,
    overflow: 'hidden',
  },
  readerContent: { padding: 18 },
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
    gap: 10,
  },
  link: {
    fontFamily: Fonts.sansMedium,
    fontSize: 13,
    color: Brand.primaryDeep,
    textDecorationLine: 'underline',
  },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  box: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: Brand.primary,
    backgroundColor: Brand.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxChecked: { backgroundColor: Brand.primary },
  checkLabel: { flex: 1, fontFamily: Fonts.sansMedium, fontSize: 14, lineHeight: 20, color: Brand.text },
  hint: { fontFamily: Fonts.sans, fontSize: 12, lineHeight: 17, color: Brand.muted, textAlign: 'center' },
  accepted: { fontFamily: Fonts.sans, fontSize: 13, lineHeight: 19, color: Brand.text },
  pressed: { opacity: 0.7 },
});
