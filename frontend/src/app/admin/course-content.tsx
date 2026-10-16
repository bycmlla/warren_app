import { Image } from 'expo-image';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { AdminOnly } from '@/components/admin-only';
import { AdminScaffold, QueryState, confirmAction, errorMessage } from '@/components/admin-scaffold';
import { BrandIcon } from '@/components/brand-icon';
import { FormError, IconButton, SmallButton, TextField } from '@/components/form';
import { PrimaryButton } from '@/components/primary-button';
import { fileUrl } from '@/constants/api';
import { Brand, Fonts, Gutter, Radius, Shadow } from '@/constants/brand';
import { lessonIcons } from '@/constants/lessons';
import { useAuth } from '@/context/auth';
import { useAuthorizedQuery } from '@/hooks/use-authorized-query';
import {
  createModule,
  deleteLesson,
  deleteModule,
  fetchAdminCourse,
  lessonTypeLabels,
  reorderLessons,
  reorderModules,
  setCourseStatus,
  statusLabels,
  updateModule,
  type AdminCourse,
  type AdminLesson,
  type AdminModule,
} from '@/services/admin-api';
import { publishError } from '@/utils/errors';
import { formatClock, formatLessons } from '@/utils/format';

/** Título do módulo que o backend cria quando uma aula é adicionada a um curso sem módulos. */
const DEFAULT_MODULE = 'Aulas';

const formatModules = (count: number) => (count === 1 ? '1 módulo' : `${count} módulos`);

export default function CourseContentScreen() {
  return (
    <AdminOnly>
      <CourseContent />
    </AdminOnly>
  );
}

const swapped = <T,>(items: T[], index: number, delta: -1 | 1) => {
  const next = [...items];
  [next[index], next[index + delta]] = [next[index + delta], next[index]];
  return next;
};

const backToCourses = () => router.dismissTo('/admin/courses');

function CourseContent() {
  // `novo`: id da aula recém-criada, informado pelo formulário de aula ao voltar para cá.
  const params = useLocalSearchParams<{ id: string; novo?: string }>();
  const courseId = Number(params.id);
  const newLessonId = params.novo ? Number(params.novo) : undefined;
  const { authorized } = useAuth();
  const load = useCallback((token: string) => fetchAdminCourse(token, courseId), [courseId]);
  const { data, error, loading, reload } = useAuthorizedQuery(load);
  const [notice, setNotice] = useState<string>();
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});
  // undefined = fechado; null = novo módulo; objeto = módulo em edição.
  const [editing, setEditing] = useState<AdminModule | null>();

  // Ao voltar de outra tela (ex.: depois de adicionar uma aula), o aviso anterior não vale mais.
  useFocusEffect(useCallback(() => () => setNotice(undefined), []));

  const run = async (action: (token: string) => Promise<unknown>, format = errorMessage) => {
    setNotice(undefined);
    // Depois de outra ação, a aula criada antes deixa de ser "a nova".
    if (newLessonId !== undefined) router.setParams({ novo: undefined });
    try {
      await authorized(action);
    } catch (cause) {
      setNotice(format(cause));
    }
    reload();
  };

  const openLesson = (target: { moduleId?: number; lessonId?: number } = {}) =>
    router.push({
      pathname: '/admin/lesson-form',
      params: {
        courseId: String(courseId),
        ...(target.moduleId !== undefined && { moduleId: String(target.moduleId) }),
        ...(target.lessonId !== undefined && { id: String(target.lessonId) }),
      },
    });

  const editCourse = () =>
    router.push({ pathname: '/admin/course-form', params: { id: String(courseId) } });

  const removeLesson = (lesson: AdminLesson) =>
    confirmAction('Excluir aula', `Excluir a aula "${lesson.titulo}"? Esta ação não pode ser desfeita.`, 'Excluir', () =>
      run((token) => deleteLesson(token, lesson.id))
    );

  const removeModule = (module: AdminModule) =>
    confirmAction(
      'Excluir módulo',
      module.aulas.length === 0
        ? `Excluir o módulo "${module.titulo}"?`
        : `Excluir o módulo "${module.titulo}" e ${module.aulas.length === 1 ? 'a aula dele' : `as ${module.aulas.length} aulas dele`}? Esta ação não pode ser desfeita.`,
      'Excluir',
      () => run((token) => deleteModule(token, module.id))
    );

  const course = data?.curso;
  const modules = data?.modulos ?? [];
  const lessonCount = modules.reduce((total, module) => total + module.aulas.length, 0);
  // Curso simples: as aulas estão no módulo padrão, que não precisa aparecer como módulo.
  const simple = modules.length === 1 && modules[0].titulo === DEFAULT_MODULE;
  // Número de cada aula na ordem de reprodução do curso inteiro.
  const order = new Map(modules.flatMap((module) => module.aulas).map((lesson, index) => [lesson.id, index + 1]));

  const lessonRows = (module: AdminModule, flat = false) =>
    module.aulas.map((lesson, index) => (
      <LessonRow
        key={lesson.id}
        lesson={lesson}
        number={order.get(lesson.id) ?? index + 1}
        isNew={lesson.id === newLessonId}
        divided={!flat || index > 0}
        first={index === 0}
        last={index === module.aulas.length - 1}
        onEdit={() => openLesson({ lessonId: lesson.id })}
        onRemove={() => removeLesson(lesson)}
        onMove={(delta) =>
          run((token) => reorderLessons(token, module.id, swapped(module.aulas, index, delta).map((item) => item.id)))
        }
      />
    ));

  return (
    <AdminScaffold
      title="Conteúdo do curso"
      subtitle="Organize os módulos e as aulas que os alunos vão assistir ou ouvir."
      back={{ label: 'Cursos', onPress: backToCourses }}
      refreshing={loading && data !== undefined}
      onRefresh={reload}>
      <QueryState loading={loading} error={error} hasData={data !== undefined} onRetry={reload} />

      {course !== undefined && (
        <>
          <CourseSummary
            course={course}
            counts={simple || modules.length === 0 ? formatLessons(lessonCount) : `${formatModules(modules.length)} · ${formatLessons(lessonCount)}`}
            onEdit={editCourse}
          />
          {notice !== undefined && <FormError message={notice} />}

          {lessonCount === 0 && (modules.length === 0 || simple) && (
            <View style={styles.empty}>
              <View style={styles.emptyIcon}>
                <BrandIcon name="play" size={24} strokeWidth={1.4} />
              </View>
              <Text accessibilityRole="header" style={styles.emptyTitle}>
                Vamos adicionar o primeiro conteúdo?
              </Text>
              <Text style={styles.emptyText}>
                Seu curso já foi criado. Agora adicione as aulas que os alunos irão assistir ou ouvir.
              </Text>
              <View style={styles.emptyActions}>
                <PrimaryButton label="Adicionar primeira aula" onPress={() => openLesson()} />
                <PrimaryButton variant="outline" label="Organizar em módulos" onPress={() => setEditing(null)} />
              </View>
              <Text style={styles.hint}>
                Você pode adicionar aulas diretamente ou organizá-las em módulos, como Introdução, Práticas e
                Finalização.
              </Text>
            </View>
          )}

          {simple && lessonCount > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text accessibilityRole="header" style={styles.heading}>
                  Aulas
                </Text>
                <Text style={styles.detail}>{formatLessons(lessonCount)}</Text>
              </View>
              <View style={styles.card}>{lessonRows(modules[0], true)}</View>
              <View style={styles.addActions}>
                <PrimaryButton label="Adicionar aula" onPress={() => openLesson()} />
                <PrimaryButton variant="outline" label="Adicionar módulo" onPress={() => setEditing(null)} />
              </View>
              <Text style={styles.hint}>
                Uma aula é um vídeo, áudio ou link do Spotify. Um módulo é uma divisão do curso que reúne
                várias aulas.
              </Text>
            </View>
          )}

          {!simple && modules.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text accessibilityRole="header" style={styles.heading}>
                  Módulos e aulas
                </Text>
                <Text style={styles.detail}>
                  {formatModules(modules.length)} · {formatLessons(lessonCount)}
                </Text>
              </View>

              {modules.map((module, moduleIndex) => {
                const open = !collapsed[module.id];
                return (
                  <View key={module.id} style={styles.card}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ expanded: open }}
                      accessibilityLabel={`Módulo ${moduleIndex + 1}, ${module.titulo}, ${formatLessons(module.aulas.length)}`}
                      onPress={() => setCollapsed((current) => ({ ...current, [module.id]: open }))}
                      style={({ pressed }) => [styles.moduleHeader, pressed && styles.pressed]}>
                      <View style={styles.flex}>
                        <Text style={styles.tag}>
                          Módulo {moduleIndex + 1} · {formatLessons(module.aulas.length)}
                        </Text>
                        <Text style={styles.moduleTitle}>{module.titulo}</Text>
                      </View>
                      <BrandIcon name={open ? 'up' : 'down'} size={18} color={Brand.muted} />
                    </Pressable>

                    {open && (
                      <>
                        {module.descricao !== null && <Text style={styles.detail}>{module.descricao}</Text>}
                        <View style={styles.actions}>
                          <IconButton
                            icon="up"
                            label={`Mover módulo ${module.titulo} para cima`}
                            disabled={moduleIndex === 0}
                            onPress={() =>
                              run((token) => reorderModules(token, courseId, swapped(modules, moduleIndex, -1).map((item) => item.id)))
                            }
                          />
                          <IconButton
                            icon="down"
                            label={`Mover módulo ${module.titulo} para baixo`}
                            disabled={moduleIndex === modules.length - 1}
                            onPress={() =>
                              run((token) => reorderModules(token, courseId, swapped(modules, moduleIndex, 1).map((item) => item.id)))
                            }
                          />
                          <View style={styles.flex} />
                          <SmallButton icon="edit" label="Editar módulo" onPress={() => setEditing(module)} />
                          <IconButton
                            icon="trash"
                            tone="danger"
                            label={`Excluir módulo ${module.titulo}`}
                            onPress={() => removeModule(module)}
                          />
                        </View>
                        {lessonRows(module)}
                        {module.aulas.length === 0 && (
                          <Text style={[styles.detail, styles.divided]}>Este módulo ainda não tem aulas.</Text>
                        )}
                        <SmallButton
                          icon="plus"
                          label="Adicionar aula neste módulo"
                          onPress={() => openLesson({ moduleId: module.id })}
                        />
                      </>
                    )}
                  </View>
                );
              })}

              <PrimaryButton variant="outline" label="Adicionar módulo" onPress={() => setEditing(null)} />
            </View>
          )}

          <Publication
            course={course}
            lessonCount={lessonCount}
            onEdit={editCourse}
            onChange={(status) => run((token) => setCourseStatus(token, courseId, status), publishError)}
          />
        </>
      )}

      {editing !== undefined && (
        <ModuleDialog
          key={editing?.id ?? 'new'}
          module={editing}
          onClose={() => setEditing(undefined)}
          onSave={async (body) => {
            await authorized((token) =>
              editing ? updateModule(token, editing.id, body) : createModule(token, courseId, body)
            );
            setEditing(undefined);
            reload();
          }}
        />
      )}
    </AdminScaffold>
  );
}

/** Identifica o curso que está sendo editado: capa, nome, status e contagens. */
function CourseSummary({ course, counts, onEdit }: { course: AdminCourse; counts: string; onEdit: () => void }) {
  const cover = fileUrl(course.imagemCapa);
  const published = course.status === 'publicado';
  return (
    <View style={[styles.card, styles.summary]}>
      {cover ? (
        <Image source={{ uri: cover }} contentFit="cover" accessible={false} style={styles.cover} />
      ) : (
        <View style={[styles.cover, styles.noCover]}>
          <BrandIcon name="library" size={22} strokeWidth={1.3} color={Brand.muted} />
        </View>
      )}
      <View style={styles.summaryText}>
        <Text style={styles.tag}>Curso</Text>
        <Text numberOfLines={2} style={styles.courseTitle}>
          {course.titulo}
        </Text>
        <View style={styles.summaryMeta}>
          <View style={[styles.statusTag, published && styles.publishedTag]}>
            <Text style={[styles.statusText, published && styles.publishedText]}>
              {statusLabels[course.status]}
            </Text>
          </View>
          <Text style={styles.detail}>{counts}</Text>
        </View>
        <SmallButton icon="edit" label="Editar informações" onPress={onEdit} />
      </View>
    </View>
  );
}

function LessonRow({
  lesson,
  number,
  isNew,
  divided,
  first,
  last,
  onEdit,
  onRemove,
  onMove,
}: {
  lesson: AdminLesson;
  number: number;
  isNew: boolean;
  divided: boolean;
  first: boolean;
  last: boolean;
  onEdit: () => void;
  onRemove: () => void;
  onMove: (delta: -1 | 1) => void;
}) {
  return (
    <View style={[styles.lesson, divided && styles.divided, isNew && styles.newLesson]}>
      <View style={styles.lessonMain}>
        <View style={[styles.lessonIcon, isNew && styles.newLessonIcon]}>
          <BrandIcon name={lessonIcons[lesson.tipo]} size={16} strokeWidth={1.4} />
        </View>
        <View style={styles.flex}>
          <Text style={styles.tag}>
            Aula {number}
            {isNew ? ' · adicionada agora' : ''}
          </Text>
          <Text numberOfLines={2} style={styles.lessonTitle}>
            {lesson.titulo}
          </Text>
          <Text style={styles.detail}>
            {[
              lessonTypeLabels[lesson.tipo],
              lesson.videos.length > 1 ? `${lesson.videos.length} vídeos` : null,
              lesson.duracaoSegundos ? formatClock(lesson.duracaoSegundos) : null,
              lesson.demonstrativa ? 'Demonstrativa' : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>
      </View>
      <View style={styles.actions}>
        <IconButton
          icon="up"
          label={`Mover aula ${lesson.titulo} para cima`}
          disabled={first}
          onPress={() => onMove(-1)}
        />
        <IconButton
          icon="down"
          label={`Mover aula ${lesson.titulo} para baixo`}
          disabled={last}
          onPress={() => onMove(1)}
        />
        <View style={styles.flex} />
        <SmallButton icon="edit" label="Editar" onPress={onEdit} />
        <IconButton icon="trash" tone="danger" label={`Excluir aula ${lesson.titulo}`} onPress={onRemove} />
      </View>
    </View>
  );
}

/**
 * Seção de publicação: mostra o status e o que falta para publicar. O botão só fica disponível
 * quando os requisitos estão atendidos; o backend valida de novo ao publicar.
 */
function Publication({
  course,
  lessonCount,
  onEdit,
  onChange,
}: {
  course: AdminCourse;
  lessonCount: number;
  onEdit: () => void;
  onChange: (status: 'publicado' | 'rascunho') => void;
}) {
  const requirements = [
    { label: 'Ao menos uma aula cadastrada', met: lessonCount > 0 },
    { label: 'Descrição do curso', met: Boolean(course.descricao), editable: true },
    { label: 'Categoria selecionada', met: course.categoriaId !== null, editable: true },
    // Curso pago: precisa de preço e de ao menos uma forma de pagamento habilitada.
    ...(course.tipoAcesso === 'pago'
      ? [
          {
            label: 'Preço e forma de pagamento',
            met: Boolean(course.precoCentavos) && (course.pixHabilitado || course.cartaoHabilitado),
            editable: true,
          },
        ]
      : []),
  ];
  const ready = requirements.every((item) => item.met);
  const published = course.status === 'publicado';

  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.heading}>
        Publicação
      </Text>
      <View style={styles.publication}>
        <Text style={styles.publicationStatus}>
          {published
            ? 'Publicado: visível para os alunos no aplicativo.'
            : course.status === 'arquivado'
              ? 'Arquivado: fora do aplicativo, com o progresso dos alunos preservado.'
              : 'Rascunho: ainda não aparece para os alunos.'}
        </Text>

        {!published && (
          <>
            <Text style={styles.detail}>
              {ready ? 'Tudo pronto para publicar.' : 'Para publicar, falta completar:'}
            </Text>
            {requirements.map((item) => (
              <View
                key={item.label}
                accessible
                accessibilityLabel={`${item.label}: ${item.met ? 'concluído' : 'pendente'}`}
                style={styles.requirement}>
                <View style={[styles.check, item.met && styles.checkMet]}>
                  {item.met && <BrandIcon name="check" size={12} strokeWidth={2.4} color={Brand.white} />}
                </View>
                <Text style={[styles.requirementText, item.met && styles.requirementMet]}>{item.label}</Text>
              </View>
            ))}
            {requirements.some((item) => item.editable && !item.met) && (
              <SmallButton icon="edit" label="Completar informações do curso" onPress={onEdit} />
            )}
          </>
        )}

        {published ? (
          <PrimaryButton variant="outline" label="Despublicar" onPress={() => onChange('rascunho')} />
        ) : (
          <PrimaryButton label="Publicar curso" onPress={() => onChange('publicado')} disabled={!ready} />
        )}
      </View>
    </View>
  );
}

function ModuleDialog({
  module,
  onClose,
  onSave,
}: {
  module: AdminModule | null;
  onClose: () => void;
  onSave: (body: { titulo: string; descricao: string | null }) => Promise<void>;
}) {
  const [titulo, setTitulo] = useState(module?.titulo ?? '');
  const [descricao, setDescricao] = useState(module?.descricao ?? '');
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (saving) return;
    if (!titulo.trim()) return setError('Informe o título do módulo.');
    setError(undefined);
    setSaving(true);
    try {
      await onSave({ titulo: titulo.trim(), descricao: descricao.trim() || null });
    } catch (cause) {
      setError(errorMessage(cause));
      setSaving(false);
    }
  };

  return (
    <Modal transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.dialog}>
          <Text accessibilityRole="header" style={styles.dialogTitle}>
            {module ? 'Editar módulo' : 'Novo módulo'}
          </Text>
          {module === null && (
            <Text style={styles.detail}>
              Um módulo é uma divisão do curso, como Introdução ou Práticas. Depois de criá-lo, adicione as
              aulas dentro dele.
            </Text>
          )}
          <TextField label="Título" value={titulo} onChangeText={setTitulo} maxLength={200} autoFocus />
          <TextField
            label="Descrição (opcional)"
            value={descricao}
            onChangeText={setDescricao}
            maxLength={5000}
            multiline
          />
          {error !== undefined && <FormError message={error} />}
          <PrimaryButton label={module ? 'Salvar' : 'Criar módulo'} onPress={save} loading={saving} />
          <PrimaryButton variant="outline" label="Cancelar" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  section: { gap: 12, marginTop: 8 },
  sectionHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  heading: { fontFamily: Fonts.serifMedium, fontSize: 20, lineHeight: 26, color: Brand.text },
  detail: { fontFamily: Fonts.sans, fontSize: 12.5, lineHeight: 18, color: Brand.muted },
  hint: { fontFamily: Fonts.sans, fontSize: 12.5, lineHeight: 18, color: Brand.muted, textAlign: 'center' },
  tag: {
    fontFamily: Fonts.sansMedium,
    fontSize: 10,
    letterSpacing: 0.6,
    color: Brand.primaryDeep,
    textTransform: 'uppercase',
  },
  card: {
    gap: 12,
    padding: 14,
    borderRadius: Radius.card,
    backgroundColor: Brand.card,
    boxShadow: Shadow.card,
  },
  summary: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  cover: { width: 84, height: 84, borderRadius: 12, backgroundColor: Brand.surface },
  noCover: { alignItems: 'center', justifyContent: 'center', backgroundColor: Brand.surfaceSoft },
  summaryText: { flex: 1, alignItems: 'flex-start', gap: 6 },
  courseTitle: { fontFamily: Fonts.serifMedium, fontSize: 20, lineHeight: 25, color: Brand.text },
  summaryMeta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 2 },
  statusTag: {
    borderRadius: Radius.pill,
    backgroundColor: Brand.surface,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  statusText: { fontFamily: Fonts.sansMedium, fontSize: 11, color: Brand.text },
  publishedTag: { backgroundColor: Brand.primary },
  publishedText: { color: Brand.white },
  empty: {
    alignItems: 'center',
    gap: 10,
    padding: 22,
    borderRadius: Radius.hero,
    backgroundColor: Brand.surfaceSoft,
  },
  emptyIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: Brand.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    alignSelf: 'stretch',
    fontFamily: Fonts.serifMedium,
    fontSize: 21,
    lineHeight: 27,
    color: Brand.text,
    textAlign: 'center',
  },
  emptyText: {
    fontFamily: Fonts.sans,
    fontSize: 14,
    lineHeight: 21,
    color: Brand.text,
    textAlign: 'center',
    maxWidth: 320,
  },
  emptyActions: { alignSelf: 'stretch', gap: 10, marginVertical: 6 },
  addActions: { gap: 10 },
  moduleHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  moduleTitle: { fontFamily: Fonts.serif, fontSize: 18, lineHeight: 23, color: Brand.text },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  divided: {
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Brand.primarySoft,
  },
  lesson: { gap: 10 },
  newLesson: {
    marginHorizontal: -8,
    paddingHorizontal: 8,
    paddingBottom: 8,
    borderRadius: Radius.tile,
    backgroundColor: Brand.surfaceSoft,
  },
  lessonMain: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  lessonIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Brand.surfaceSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  newLessonIcon: { backgroundColor: Brand.card },
  lessonTitle: { fontFamily: Fonts.sansMedium, fontSize: 14.5, lineHeight: 20, color: Brand.text },
  publication: { gap: 12, padding: 16, borderRadius: Radius.card, backgroundColor: Brand.surfaceSoft },
  publicationStatus: { fontFamily: Fonts.sansMedium, fontSize: 13.5, lineHeight: 20, color: Brand.text },
  requirement: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  check: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Brand.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkMet: { backgroundColor: Brand.primary, borderColor: Brand.primary },
  requirementText: { flex: 1, fontFamily: Fonts.sans, fontSize: 13.5, lineHeight: 19, color: Brand.text },
  requirementMet: { color: Brand.muted },
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: Gutter,
    backgroundColor: 'rgba(72, 75, 60, 0.45)',
  },
  dialog: {
    width: '100%',
    maxWidth: 460,
    alignSelf: 'center',
    gap: 14,
    padding: 20,
    borderRadius: Radius.hero,
    backgroundColor: Brand.background,
  },
  dialogTitle: { fontFamily: Fonts.serifMedium, fontSize: 22, lineHeight: 28, color: Brand.text },
  pressed: { opacity: 0.7 },
});
