import type { CourseLesson } from '@/services/catalog-api';

export function courseLessonState(lesson: Pick<CourseLesson, 'estado' | 'bloqueio' | 'demonstrativa'>) {
  if (lesson.bloqueio === 'acesso') return 'acesso';
  if (lesson.bloqueio === 'sequencia') return 'sequencia';
  if (lesson.bloqueio === 'login') return 'login';
  if (lesson.estado === 'concluida') return 'concluida';
  return lesson.demonstrativa && lesson.estado === null ? 'demonstracao' : 'disponivel';
}

export const courseLessonLabels = {
  acesso: 'Sem acesso', sequencia: 'Aguardando', login: 'Entrar', concluida: 'Concluída',
  demonstracao: 'Demonstração', disponivel: 'Disponível',
} as const;

export const courseLessonDescriptions = {
  acesso: 'Bloqueada por acesso ao curso', sequencia: 'Bloqueada até concluir as aulas anteriores',
  login: 'Faça login para assistir', concluida: 'Aula concluída', demonstracao: 'Aula demonstrativa', disponivel: 'Aula disponível',
} as const;
