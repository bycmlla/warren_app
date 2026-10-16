import { Image } from 'expo-image';
import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { QueryState } from '@/components/admin-scaffold';
import { BrandIcon } from '@/components/brand-icon';
import { openCourse } from '@/components/course-card';
import { PrimaryButton } from '@/components/primary-button';
import { AuthGate } from '@/components/section-placeholder';
import { StackScreen } from '@/components/stack-screen';
import { fileUrl } from '@/constants/api';
import { Brand, Fonts, Radius, Shadow } from '@/constants/brand';
import { useAuth } from '@/context/auth';
import { useAuthorizedQuery } from '@/hooks/use-authorized-query';
import { accessStatusLabels, fetchMyCourses, type MyCourse } from '@/services/commerce-api';
import { formatDate, formatLessons } from '@/utils/format';

// Cursos comprados ou liberados pela administração (com a situação do acesso) e os gratuitos
// que o aluno já começou.
export default function MyCoursesScreen() {
  const { user } = useAuth();
  if (!user) return <AuthGate area="profile" areaLabel="seus cursos" />;
  return <MyCourses />;
}

function MyCourses() {
  const { data, error, loading, reload } = useAuthorizedQuery(fetchMyCourses);
  return (
    <StackScreen
      title="Meus cursos"
      subtitle="Seus cursos, o prazo de acesso de cada um e o seu progresso."
      refreshing={loading && data !== undefined}
      onRefresh={reload}>
      <QueryState loading={loading} error={data === undefined ? error : undefined} hasData={data !== undefined} onRetry={reload} />
      {data?.length === 0 && (
        <View style={styles.empty}>
          <Text style={styles.text}>
            Você ainda não tem cursos por aqui. Os cursos que você comprar, receber ou começar aparecem nesta
            tela.
          </Text>
          <PrimaryButton label="Explorar conteúdos" onPress={() => router.navigate('/explore')} />
        </View>
      )}
      {data?.map((course) => <CourseRow key={course.id} course={course} />)}
    </StackScreen>
  );
}

function CourseRow({ course }: { course: MyCourse }) {
  const cover = fileUrl(course.imagemCapa);
  const active = course.situacao === 'ativo' || course.situacao === 'gratuito';
  const period =
    course.situacao === 'gratuito'
      ? null
      : [
          course.inicioEm ? `Início em ${formatDate(course.inicioEm)}` : null,
          course.expiraEm ? `vencimento em ${formatDate(course.expiraEm)}` : 'sem vencimento',
        ]
          .filter(Boolean)
          .join(' · ');

  return (
    <View style={styles.card}>
      <View style={styles.top}>
        {cover ? (
          <Image source={{ uri: cover }} contentFit="cover" accessible={false} style={styles.cover} />
        ) : (
          <View style={[styles.cover, styles.noCover]}>
            <BrandIcon name="library" size={22} strokeWidth={1.3} color={Brand.muted} />
          </View>
        )}
        <View style={styles.info}>
          <Text numberOfLines={2} style={styles.title}>
            {course.titulo}
          </Text>
          <Text style={[styles.status, !active && styles.statusOff]}>{accessStatusLabels[course.situacao]}</Text>
          {period !== null && <Text style={styles.meta}>{period}</Text>}
        </View>
      </View>

      <View style={styles.progress}>
        <View style={styles.progressTop}>
          <Text style={styles.meta}>
            {course.aulasConcluidas} de {formatLessons(course.totalAulas)} concluídas
          </Text>
          <Text style={styles.percent}>{course.percentual}%</Text>
        </View>
        <View
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: 100, now: course.percentual }}
          style={styles.track}>
          <View style={[styles.fill, { width: `${course.percentual}%` }]} />
        </View>
      </View>

      {course.pertoDeVencer && (
        <Text accessibilityRole="alert" style={styles.warning}>
          {course.diasRestantes === 0
            ? 'Seu acesso termina hoje.'
            : `Seu acesso termina em ${course.diasRestantes} ${course.diasRestantes === 1 ? 'dia' : 'dias'}.`}
        </Text>
      )}
      {!active && (
        <Text style={styles.meta}>
          {course.situacao === 'agendado'
            ? 'O acesso ainda não começou.'
            : 'As aulas estão bloqueadas, mas o seu progresso continua guardado.'}
        </Text>
      )}

      <PrimaryButton
        variant={active ? 'solid' : 'outline'}
        label={!active ? 'Ver curso' : course.aulasConcluidas > 0 ? 'Continuar' : 'Iniciar'}
        onPress={() => openCourse(course.id)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { gap: 14, paddingVertical: 12 },
  text: { fontFamily: Fonts.sans, fontSize: 14.5, lineHeight: 22, color: Brand.muted },
  card: { gap: 12, padding: 14, borderRadius: Radius.card, backgroundColor: Brand.card, boxShadow: Shadow.card },
  top: { flexDirection: 'row', gap: 12 },
  cover: { width: 84, height: 84, borderRadius: 12, backgroundColor: Brand.surface },
  noCover: { alignItems: 'center', justifyContent: 'center', backgroundColor: Brand.surfaceSoft },
  info: { flex: 1, gap: 3 },
  title: { fontFamily: Fonts.serif, fontSize: 18, lineHeight: 23, color: Brand.text },
  status: { fontFamily: Fonts.sansMedium, fontSize: 12.5, color: Brand.primaryDeep },
  statusOff: { color: Brand.danger },
  meta: { fontFamily: Fonts.sans, fontSize: 12.5, lineHeight: 18, color: Brand.muted },
  progress: { gap: 6 },
  progressTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 },
  percent: { fontFamily: Fonts.sansSemiBold, fontSize: 12.5, color: Brand.primaryDeep },
  track: { height: 6, borderRadius: 3, backgroundColor: Brand.surface, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3, backgroundColor: Brand.primary },
  warning: {
    fontFamily: Fonts.sansMedium,
    fontSize: 12.5,
    lineHeight: 18,
    color: Brand.text,
    backgroundColor: Brand.surfaceSoft,
    borderRadius: Radius.tile,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
});
