import { router } from 'expo-router';

import { AuthGate, SectionPlaceholder } from '@/components/section-placeholder';
import { useAuth } from '@/context/auth';

// Pendente: não há backend nem armazenamento offline para downloads.
export default function DownloadsScreen() {
  const { user } = useAuth();
  if (!user) return <AuthGate area="downloads" areaLabel="seus downloads" />;

  return (
    <SectionPlaceholder
      icon="download"
      title="Downloads"
      description="Esta área ainda está em preparação. Em breve, os conteúdos que você baixar ficarão disponíveis aqui."
      action={{ label: 'Ver conteúdos', onPress: () => router.navigate('/') }}
    />
  );
}
