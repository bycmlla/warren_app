import type { IconName } from '@/components/brand-icon';
import type { LessonType } from '@/services/admin-api';

export const lessonIcons: Record<LessonType, IconName> = {
  video: 'video',
  audio: 'headphones',
  spotify: 'music',
};
