import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BrandIcon } from '@/components/brand-icon';
import { fileUrl } from '@/constants/api';
import { Brand, Fonts, Radius, Shadow } from '@/constants/brand';
import type { CourseSummary } from '@/services/catalog-api';
import { formatLessons } from '@/utils/format';
import { pushOnce } from '@/utils/navigation';

type Props = {
  course: CourseSummary;
  width?: number;
  variant?: 'compact' | 'large';
  /**
   * Em Explorar: se o usuário já tem acesso ao curso (compra aprovada ou liberação). Sem o campo
   * (ex.: administradora, que acessa tudo), nenhum selo de acesso é mostrado.
   */
  owned?: boolean;
};

export const openCourse = (id: number) => {
  pushOnce({ pathname: '/course/[id]', params: { id: String(id) } });
};

/**
 * Cartão de um curso publicado. Abre os detalhes do curso.
 * Na Home (compacto) mostra só capa, título, descrição resumida e quantidade de aulas: a seção
 * já identifica o grupo. Em Explorar (grande) mostra também a categoria e se é gratuito.
 * As informações de compra ficam na tela de detalhes do curso.
 */
export function CourseCard({ course, width, variant = 'compact', owned }: Props) {
  const large = variant === 'large';
  const cover = fileUrl(course.imagemCapa);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={course.titulo}
      accessibilityHint="Abre os detalhes"
      onPress={() => openCourse(course.id)}
      style={({ pressed }) => [
        styles.card,
        large && styles.largeCard,
        width !== undefined && { width },
        pressed && styles.pressed,
      ]}>
      {cover ? (
        <Image
          source={{ uri: cover }}
          style={[styles.image, large && styles.largeImage]}
          contentFit="cover"
          // Mantém a capa também na memória: ao voltar para a lista ela não é decodificada de novo.
          cachePolicy="memory-disk"
          accessible={false}
        />
      ) : (
        <View style={[styles.image, large && styles.largeImage, styles.noImage]}>
          <BrandIcon name="library" size={26} strokeWidth={1.3} color={Brand.muted} />
        </View>
      )}
      <View style={[styles.body, large && styles.largeBody]}>
        {large && course.categoria !== null && (
          <Text numberOfLines={1} style={styles.tag}>
            {course.categoria}
          </Text>
        )}
        <Text numberOfLines={2} style={[styles.title, large && styles.largeTitle]}>
          {course.titulo}
        </Text>
        {course.subtitulo !== null && (
          <Text
            numberOfLines={large ? 3 : 2}
            style={[styles.description, large && styles.largeDescription]}>
            {course.subtitulo}
          </Text>
        )}
        {large && owned !== undefined && course.tipoAcesso !== 'gratuito' && (
          <View style={styles.access}>
            <BrandIcon name={owned ? 'check' : 'lock'} size={12} strokeWidth={owned ? 2 : 1.6} color={owned ? Brand.primaryDeep : Brand.muted} />
            <Text style={[styles.accessText, owned && styles.accessOwned]}>{owned ? 'Adquirido' : 'Não adquirido'}</Text>
          </View>
        )}
        <Text style={styles.meta}>
          {[formatLessons(course.totalAulas), large && course.gratuito ? 'Gratuito' : null]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Brand.card,
    borderRadius: Radius.card,
    padding: 7,
    gap: 10,
    boxShadow: Shadow.card,
  },
  largeCard: { borderRadius: Radius.cardLarge, padding: 12, gap: 14 },
  image: { width: '100%', aspectRatio: 1.9, borderRadius: 12, backgroundColor: Brand.surface },
  largeImage: { aspectRatio: 16 / 9 },
  noImage: { alignItems: 'center', justifyContent: 'center', backgroundColor: Brand.surfaceSoft },
  body: { paddingHorizontal: 6, paddingBottom: 10, gap: 5 },
  largeBody: { paddingHorizontal: 4, paddingBottom: 6 },
  tag: {
    fontFamily: Fonts.sansMedium,
    fontSize: 10,
    letterSpacing: 0.6,
    color: Brand.primaryDeep,
    textTransform: 'uppercase',
  },
  title: { fontFamily: Fonts.serif, fontSize: 17, lineHeight: 21, color: Brand.text },
  largeTitle: { fontSize: 20, lineHeight: 26 },
  description: { fontFamily: Fonts.sans, fontSize: 12, lineHeight: 17, color: Brand.muted },
  largeDescription: { fontSize: 13.5, lineHeight: 20 },
  meta: { fontFamily: Fonts.sans, fontSize: 11.5, lineHeight: 16, color: Brand.muted },
  access: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  accessText: { fontFamily: Fonts.sansMedium, fontSize: 11.5, lineHeight: 16, color: Brand.muted },
  accessOwned: { color: Brand.primaryDeep },
  pressed: { opacity: 0.8 },
});
