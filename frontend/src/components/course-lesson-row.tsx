import { Image } from 'expo-image';
import { memo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BrandIcon, type IconName } from '@/components/brand-icon';
import { fileUrl } from '@/constants/api';
import { Brand, Fonts } from '@/constants/brand';
import { lessonIcons } from '@/constants/lessons';
import { lessonTypeLabels } from '@/services/admin-api';
import type { CourseLesson } from '@/services/catalog-api';
import { courseLessonDescriptions, courseLessonLabels, courseLessonState } from '@/utils/course-lesson-state';
import { formatDuration } from '@/utils/format';

export const CourseLessonRow = memo(function CourseLessonRow({ lesson, divided, onPress }: {
  lesson: CourseLesson; divided: boolean; onPress: () => void;
}) {
  const state = courseLessonState(lesson);
  const done = lesson.estado === 'concluida';
  const blocked = state === 'acesso' || state === 'sequencia';
  const color = state === 'acesso' ? Brand.danger : state === 'sequencia' ? Brand.warning
    : state === 'concluida' ? Brand.primaryDeep : Brand.muted;
  const icon: IconName = blocked ? 'lock' : state === 'concluida' ? 'check' : state === 'login' ? 'profile' : 'play';
  const label = lesson.tipo === 'video' && lesson.totalVideos > 1 ? `${lesson.totalVideos} vídeos` : lessonTypeLabels[lesson.tipo];
  const meta = [label, formatDuration(lesson.duracaoSegundos)].filter(Boolean).join(' • ');
  return <Pressable accessibilityRole="button"
    accessibilityLabel={[lesson.titulo, meta, courseLessonDescriptions[state], done && blocked ? 'Aula já concluída' : null].filter(Boolean).join(', ')}
    onPress={onPress} style={({ pressed }) => [styles.row, divided && styles.divider, pressed && styles.pressed]}>
    <Thumbnail key={lesson.thumbnail ?? 'fallback'} lesson={lesson} />
    <View style={styles.text}>
      <Text numberOfLines={2} style={[styles.title, blocked && styles.locked]}>{lesson.titulo}</Text>
      <Text numberOfLines={2} style={styles.meta}>{meta}</Text>
    </View>
    <View style={styles.state}>
      <BrandIcon name={icon} size={17} strokeWidth={state === 'concluida' ? 2 : 1.7} color={color} />
      <Text style={[styles.stateText, { color }]}>{courseLessonLabels[state]}</Text>
    </View>
  </Pressable>;
});

function Thumbnail({ lesson }: { lesson: CourseLesson }) {
  const [failed, setFailed] = useState(false);
  const uri = fileUrl(lesson.thumbnail);
  return <View style={styles.thumbnail}>
    {uri && !failed ? <Image source={{ uri }} contentFit="cover" cachePolicy="memory-disk" transition={100}
      accessibilityLabel={`Miniatura de ${lesson.titulo}`} onError={() => setFailed(true)} style={styles.image} />
      : <View accessible={false} style={styles.fallback}>
        <View style={styles.fallbackGlow} />
        <BrandIcon name={lessonIcons[lesson.tipo]} size={20} strokeWidth={1.2} color={Brand.primaryDeep} />
      </View>}
    {lesson.estado === 'concluida' && lesson.bloqueio === 'acesso' && <View style={styles.completed}>
      <BrandIcon name="check" size={11} color={Brand.white} strokeWidth={2} />
    </View>}
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 11, minHeight: 76, paddingHorizontal: 14, paddingVertical: 11 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Brand.primarySoft },
  thumbnail: { width: 70, height: 45, borderRadius: 9, overflow: 'hidden', backgroundColor: Brand.surfaceSoft },
  image: { width: '100%', height: '100%' },
  fallback: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Brand.surface },
  fallbackGlow: { position: 'absolute', width: 58, height: 58, borderRadius: 29, right: -18, top: -16, backgroundColor: Brand.surfaceSoft },
  completed: { position: 'absolute', bottom: 3, right: 3, borderRadius: 9, padding: 3, backgroundColor: Brand.primaryDeep },
  text: { flex: 1, gap: 3 },
  title: { fontFamily: Fonts.sansMedium, fontSize: 14, lineHeight: 19, color: Brand.text },
  locked: { color: Brand.muted },
  meta: { fontFamily: Fonts.sans, fontSize: 11.5, lineHeight: 16, color: Brand.muted },
  state: { width: 66, alignItems: 'center', gap: 4 },
  stateText: { fontFamily: Fonts.sansMedium, fontSize: 10, lineHeight: 14, textAlign: 'center' },
  pressed: { opacity: 0.75 },
});
