import { router, useFocusEffect } from 'expo-router';
import { useCallback, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/primary-button';
import { ScreenHeader } from '@/components/screen-header';
import { AuthGate } from '@/components/section-placeholder';
import { Brand, Fonts } from '@/constants/brand';
import { useAuth } from '@/context/auth';
import { useAuthorizedQuery } from '@/hooks/use-authorized-query';
import { ApiError } from '@/services/auth-api';
import { fetchOffer, type Offer } from '@/services/commerce-api';

type Result = { offer: Offer } | { blocked: string; message: string };

/**
 * Carrega a oferta de um curso pago e só mostra o conteúdo quando o backend a entrega.
 * O backend recusa a oferta sem o aceite dos Termos de Uso vigentes (o aluno é levado à tela de
 * termos), para quem já tem acesso ao curso e para cursos que não estão à venda.
 */
export function OfferGate({ courseId, children }: { courseId: number; children: (offer: Offer) => ReactNode }) {
  const { user } = useAuth();
  if (!user) return <AuthGate area="profile" areaLabel="a oferta deste curso" />;
  return <Loader courseId={courseId}>{children}</Loader>;
}

function Loader({ courseId, children }: { courseId: number; children: (offer: Offer) => ReactNode }) {
  const load = useCallback(
    async (token: string): Promise<Result> => {
      try {
        return { offer: await fetchOffer(token, courseId) };
      } catch (cause) {
        const refused = cause instanceof ApiError && (cause.status === 409 || cause.status === 428);
        if (refused && typeof cause.data.codigo === 'string') {
          return { blocked: cause.data.codigo, message: cause.message };
        }
        throw cause;
      }
    },
    [courseId]
  );
  const { data, error, loading, reload } = useAuthorizedQuery(load);
  const blocked = data !== undefined && 'blocked' in data ? data : undefined;
  const termsPending = blocked?.blocked === 'TERMOS_PENDENTES';

  // Chegou aqui sem aceitar os termos (navegação direta, termos atualizados): volta para eles.
  useFocusEffect(
    useCallback(() => {
      if (termsPending) {
        router.replace({ pathname: '/terms', params: { courseId: String(courseId), offer: '1' } });
      }
    }, [termsPending, courseId])
  );

  if (data !== undefined && 'offer' in data) return children(data.offer);
  return (
    <View style={styles.screen}>
      <ScreenHeader />
      <View style={styles.center}>
        {blocked !== undefined && !termsPending ? (
          <>
            <Text accessibilityLiveRegion="polite" style={styles.text}>
              {blocked.message}
            </Text>
            <PrimaryButton label="Voltar ao curso" onPress={() => router.back()} />
          </>
        ) : error !== undefined ? (
          <>
            <Text accessibilityLiveRegion="polite" style={styles.text}>
              {error}
            </Text>
            <PrimaryButton variant="outline" label="Tentar novamente" onPress={reload} />
          </>
        ) : (
          (loading || termsPending) && <ActivityIndicator color={Brand.primary} size="large" />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Brand.background },
  center: { flex: 1, justifyContent: 'center', padding: 28, gap: 14 },
  text: { fontFamily: Fonts.sans, fontSize: 14.5, lineHeight: 22, color: Brand.muted, textAlign: 'center' },
});
