import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { AdminOnly } from '@/components/admin-only';
import { AdminScaffold, QueryState, errorMessage } from '@/components/admin-scaffold';
import { BrandIcon, type IconName } from '@/components/brand-icon';
import { ChoiceChips, FormError, IconButton, ImageField, SmallButton, SwitchRow, TextField } from '@/components/form';
import { PrimaryButton } from '@/components/primary-button';
import { VideoDurationProbe } from '@/components/video-duration-probe';
import { Brand, Fonts, Radius } from '@/constants/brand';
import { useAuth } from '@/context/auth';
import { useAuthorizedQuery } from '@/hooks/use-authorized-query';
import {
  createLesson,
  fetchAdminCourse,
  updateLesson,
  type AdminLesson,
  type LessonInput,
  type LessonType,
} from '@/services/admin-api';
import { pickFile, uploadFile } from '@/services/upload';
import { formatClock, formatDuration } from '@/utils/format';

const types: { value: LessonType; label: string; icon: IconName }[] = [
  { value: 'video', label: 'Vídeo', icon: 'video' },
  { value: 'audio', label: 'Áudio', icon: 'headphones' },
  { value: 'spotify', label: 'Spotify', icon: 'music' },
];

const SPOTIFY_URL = /^https:\/\/(open\.spotify\.com|spotify\.link)\/\S+$/i;

/** Um vídeo da aula no formulário. `id` só existe nos que já estão salvos. */
type VideoDraft = {
  key: string;
  id?: number;
  titulo: string;
  arquivo: string;
  /** Lida do arquivo pelo servidor ou, se ele não conseguir, pelo player deste aparelho. */
  duracaoSegundos: number | null;
  /** Arquivo recém-escolhido, ainda acessível no aparelho para a leitura da duração. */
  localUri?: string;
};

type AudioDraft = { arquivo: string; name: string; duracaoSegundos: number | null; localUri?: string };

export default function LessonFormScreen() {
  return (
    <AdminOnly>
      <Loader />
    </AdminOnly>
  );
}

function Loader() {
  const params = useLocalSearchParams<{ courseId: string; moduleId?: string; id?: string }>();
  const courseId = Number(params.courseId);
  const lessonId = params.id ? Number(params.id) : undefined;
  const load = useCallback((token: string) => fetchAdminCourse(token, courseId), [courseId]);
  const { data, error, loading, reload } = useAuthorizedQuery(load);
  const lesson = data?.modulos.flatMap((module) => module.aulas).find((item) => item.id === lessonId);

  if (data !== undefined && (lessonId === undefined || lesson)) {
    return (
      <LessonForm
        key={lesson?.id ?? 'new'}
        courseId={courseId}
        moduleId={params.moduleId ? Number(params.moduleId) : undefined}
        lesson={lesson}
      />
    );
  }
  return (
    <AdminScaffold title={lessonId === undefined ? 'Adicionar aula' : 'Editar aula'}>
      <QueryState
        loading={loading}
        error={error ?? (data ? 'Aula não encontrada.' : undefined)}
        hasData={false}
        onRetry={reload}
      />
    </AdminScaffold>
  );
}

function LessonForm({
  courseId,
  moduleId,
  lesson,
}: {
  courseId: number;
  moduleId?: number;
  lesson?: AdminLesson;
}) {
  const { authorized } = useAuth();
  const [titulo, setTitulo] = useState(lesson?.titulo ?? '');
  const [descricao, setDescricao] = useState(lesson?.descricao ?? '');
  const [imagemCapa, setImagemCapa] = useState(lesson?.imagemCapa ?? null);
  const [imageUploading, setImageUploading] = useState(false);
  const [tipo, setTipo] = useState<LessonType>(lesson?.tipo ?? 'video');
  const [link, setLink] = useState(lesson?.linkExterno ?? '');
  const [demonstrativa, setDemonstrativa] = useState(lesson?.demonstrativa ?? false);
  // Vídeos e áudio ficam guardados separadamente: trocar o tipo não descarta o que foi enviado.
  const [videos, setVideos] = useState<VideoDraft[]>(() =>
    (lesson?.videos ?? []).map((video) => ({
      key: `salvo-${video.id}`,
      id: video.id,
      titulo: video.titulo ?? '',
      arquivo: video.arquivo,
      duracaoSegundos: video.duracaoSegundos,
    }))
  );
  const [audio, setAudio] = useState<AudioDraft | undefined>(
    lesson?.tipo === 'audio' && lesson.arquivo
      ? { arquivo: lesson.arquivo, name: 'Arquivo enviado', duracaoSegundos: lesson.duracaoSegundos }
      : undefined
  );
  // Envio em andamento: em qual item (`novo` = vídeo sendo adicionado) e quanto já foi (0 a 1).
  const [upload, setUpload] = useState<{ target: string; fraction: number }>();
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const busy = upload !== undefined || imageUploading;

  // A duração da aula é a soma dos vídeos; só aparece quando a de todos é conhecida.
  const total =
    videos.length > 0 && videos.every((video) => video.duracaoSegundos)
      ? videos.reduce((sum, video) => sum + (video.duracaoSegundos ?? 0), 0)
      : null;

  // Escolhe um arquivo no aparelho e o envia ao armazenamento, mostrando o andamento.
  const send = async (kind: 'video' | 'audio', target: string) => {
    setError(undefined);
    try {
      const picked = await pickFile(kind);
      if (!picked) return undefined;
      setUpload({ target, fraction: 0 });
      const uploaded = await authorized((token) =>
        uploadFile(token, kind, picked, (fraction) => setUpload({ target, fraction }))
      );
      return { arquivo: uploaded.arquivo, duracaoSegundos: uploaded.duracaoSegundos ?? null, picked };
    } catch (cause) {
      setError(errorMessage(cause));
      return undefined;
    } finally {
      setUpload(undefined);
    }
  };

  const addVideo = async () => {
    const sent = await send('video', 'novo');
    if (!sent) return;
    setVideos((current) => [
      ...current,
      {
        key: sent.arquivo,
        titulo: '',
        arquivo: sent.arquivo,
        duracaoSegundos: sent.duracaoSegundos,
        localUri: sent.picked.uri,
      },
    ]);
  };

  // Trocar o arquivo mantém o vídeo (e a conclusão dos alunos que já o assistiram).
  const replaceVideo = async (key: string) => {
    const sent = await send('video', key);
    if (!sent) return;
    setVideos((current) =>
      current.map((video) =>
        video.key === key
          ? { ...video, arquivo: sent.arquivo, duracaoSegundos: sent.duracaoSegundos, localUri: sent.picked.uri }
          : video
      )
    );
  };

  const updateVideo = (key: string, changes: Partial<VideoDraft>) =>
    setVideos((current) => current.map((video) => (video.key === key ? { ...video, ...changes } : video)));

  const moveVideo = (index: number, step: -1 | 1) =>
    setVideos((current) => {
      const next = [...current];
      [next[index], next[index + step]] = [next[index + step], next[index]];
      return next;
    });

  const chooseAudio = async () => {
    const sent = await send('audio', 'audio');
    if (!sent) return;
    setAudio({
      arquivo: sent.arquivo,
      name: sent.picked.name,
      duracaoSegundos: sent.duracaoSegundos,
      localUri: sent.picked.uri,
    });
  };

  const save = async () => {
    if (saving || busy) return;
    if (!titulo.trim()) return setError('Informe o título da aula.');
    if (tipo === 'video' && videos.length === 0) return setError('Adicione ao menos um vídeo à aula.');
    if (tipo === 'audio' && !audio) return setError('Envie o arquivo de áudio da aula.');
    if (tipo === 'spotify' && !SPOTIFY_URL.test(link.trim())) {
      return setError('Informe um link válido do Spotify (https://open.spotify.com/...).');
    }

    setError(undefined);
    setSaving(true);
    const body: LessonInput = {
      titulo: titulo.trim(),
      descricao: descricao.trim() || null,
      imagemCapa,
      tipo,
      arquivo: tipo === 'audio' ? (audio?.arquivo ?? null) : null,
      linkExterno: tipo === 'spotify' ? link.trim() : null,
      duracaoSegundos: tipo === 'audio' ? (audio?.duracaoSegundos ?? null) : null,
      demonstrativa,
      ...(tipo === 'video' && {
        videos: videos.map((video) => ({
          id: video.id,
          titulo: video.titulo.trim() || null,
          arquivo: video.arquivo,
          duracaoSegundos: video.duracaoSegundos,
        })),
      }),
    };
    try {
      if (lesson) {
        await authorized((token) => updateLesson(token, lesson.id, body));
        router.back();
      } else {
        const created = await authorized((token) =>
          createLesson(token, courseId, { ...body, moduloId: moduleId })
        );
        // Volta ao conteúdo do mesmo curso, que destaca a aula recém-criada.
        router.dismissTo({
          pathname: '/admin/course-content',
          params: { id: String(courseId), novo: String(created.aula.id) },
        });
      }
    } catch (cause) {
      setError(errorMessage(cause));
      setSaving(false);
    }
  };

  return (
    <AdminScaffold title={lesson ? 'Editar aula' : 'Adicionar aula'}>
      <TextField label="Título" value={titulo} onChangeText={setTitulo} maxLength={200} />
      <TextField
        label="Descrição (opcional)"
        value={descricao}
        onChangeText={setDescricao}
        maxLength={5000}
        multiline
      />
      <ChoiceChips label="Tipo de mídia" options={types} value={tipo} onChange={setTipo} />
      <ImageField label="Capa da aula (opcional)" value={imagemCapa} onChange={setImagemCapa} onUploading={setImageUploading}
        hint="Sem capa, a miniatura é gerada automaticamente a partir do primeiro vídeo." />

      {tipo === 'video' && (
        <View style={styles.section}>
          <Text style={styles.label}>Vídeos da aula</Text>
          <Text style={styles.hint}>
            Um ou mais vídeos, reproduzidos nesta ordem. Formatos aceitos: mp4, m4v, mov ou webm, até 1 GB cada.
          </Text>

          {videos.map((video, index) => (
            <View key={video.key} style={styles.video}>
              <View style={styles.videoTop}>
                <View style={styles.number}>
                  <Text style={styles.numberText}>{index + 1}</Text>
                </View>
                <TextInput
                  accessibilityLabel={`Título do vídeo ${index + 1}`}
                  placeholder={`Título do vídeo ${index + 1} (opcional)`}
                  placeholderTextColor={Brand.muted}
                  selectionColor={Brand.primary}
                  value={video.titulo}
                  onChangeText={(value) => updateVideo(video.key, { titulo: value })}
                  maxLength={200}
                  style={styles.videoTitle}
                />
              </View>
              <Duration seconds={video.duracaoSegundos} exact />
              {upload?.target === video.key && <ProgressBar fraction={upload.fraction} />}
              <View style={styles.actions}>
                <IconButton
                  icon="up"
                  label={`Mover vídeo ${index + 1} para cima`}
                  onPress={() => moveVideo(index, -1)}
                  disabled={index === 0 || busy}
                />
                <IconButton
                  icon="down"
                  label={`Mover vídeo ${index + 1} para baixo`}
                  onPress={() => moveVideo(index, 1)}
                  disabled={index === videos.length - 1 || busy}
                />
                <View style={styles.spacer} />
                <SmallButton
                  label={upload?.target === video.key ? `Enviando… ${Math.round(upload.fraction * 100)}%` : 'Trocar arquivo'}
                  onPress={() => replaceVideo(video.key)}
                  disabled={busy}
                />
                <IconButton
                  icon="trash"
                  tone="danger"
                  label={`Remover vídeo ${index + 1}`}
                  onPress={() => setVideos((current) => current.filter((item) => item.key !== video.key))}
                  disabled={busy}
                />
              </View>
              {video.duracaoSegundos === null && video.localUri !== undefined && (
                <VideoDurationProbe
                  key={video.localUri}
                  uri={video.localUri}
                  onDuration={(seconds) => updateVideo(video.key, { duracaoSegundos: seconds })}
                />
              )}
            </View>
          ))}

          {upload?.target === 'novo' && <ProgressBar fraction={upload.fraction} />}
          <View style={styles.row}>
            <SmallButton
              icon="plus"
              label={
                upload?.target === 'novo'
                  ? `Enviando… ${Math.round(upload.fraction * 100)}%`
                  : videos.length === 0
                    ? 'Adicionar vídeo'
                    : 'Adicionar outro vídeo'
              }
              onPress={addVideo}
              disabled={busy}
            />
          </View>
          {videos.length > 0 && (
            <View style={styles.total}>
              <Text style={styles.label}>Duração da aula</Text>
              <Duration seconds={total} />
            </View>
          )}
        </View>
      )}

      {tipo === 'audio' && (
        <View style={styles.section}>
          <Text style={styles.label}>Arquivo de áudio</Text>
          <Text style={styles.hint}>
            {audio
              ? `${audio.name} — enviado ao armazenamento.`
              : 'Formatos aceitos: mp3, m4a, aac, wav ou ogg, até 200 MB.'}
          </Text>
          {audio !== undefined && <Duration seconds={audio.duracaoSegundos} />}
          {upload?.target === 'audio' && <ProgressBar fraction={upload.fraction} />}
          <View style={styles.row}>
            <SmallButton
              label={
                upload?.target === 'audio'
                  ? `Enviando… ${Math.round(upload.fraction * 100)}%`
                  : audio
                    ? 'Trocar arquivo'
                    : 'Escolher áudio'
              }
              onPress={chooseAudio}
              disabled={busy}
            />
          </View>
          {audio !== undefined && audio.duracaoSegundos === null && audio.localUri !== undefined && (
            <DurationProbe
              key={audio.localUri}
              uri={audio.localUri}
              onDuration={(seconds) => setAudio((current) => current && { ...current, duracaoSegundos: seconds })}
            />
          )}
        </View>
      )}

      {tipo === 'spotify' && (
        <TextField
          label="Link do Spotify"
          hint="Cole o endereço de uma faixa, episódio ou playlist: https://open.spotify.com/..."
          value={link}
          onChangeText={setLink}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          maxLength={500}
        />
      )}

      <SwitchRow
        label="Aula demonstrativa"
        description={
          demonstrativa
            ? 'Qualquer aluno com conta assiste a esta aula, mesmo sem ter o curso. As demais continuam protegidas.'
            : 'Só quem tem acesso ao curso assiste a esta aula.'
        }
        value={demonstrativa}
        onValueChange={setDemonstrativa}
      />

      {error !== undefined && <FormError message={error} />}
      <PrimaryButton
        label={lesson ? 'Salvar alterações' : 'Adicionar aula'}
        onPress={save}
        loading={saving}
        disabled={busy}
      />
    </AdminScaffold>
  );
}

/**
 * Duração identificada automaticamente, com o ícone de relógio. `exact` mostra minutos e segundos
 * (para cada vídeo); sem ele, o formato resumido da aula ("25 min"). Sem valor, avisa que ainda
 * não foi identificada, em vez de mostrar um número que não existe.
 */
function Duration({ seconds, exact = false }: { seconds: number | null; exact?: boolean }) {
  return (
    <View style={styles.duration}>
      <BrandIcon name="clock" size={14} strokeWidth={1.5} color={Brand.muted} />
      <Text style={styles.durationText}>
        {seconds ? (exact ? formatClock(seconds) : formatDuration(seconds)) : 'Duração ainda não identificada'}
      </Text>
    </View>
  );
}

function ProgressBar({ fraction }: { fraction: number }) {
  const percent = Math.round(fraction * 100);
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: percent }}
      style={styles.track}>
      <View style={[styles.fill, { width: `${percent}%` }]} />
    </View>
  );
}

/**
 * Lê a duração do arquivo recém-escolhido com o player do aparelho, sem reproduzir nada. Só é
 * usado quando o servidor não consegue ler a duração do formato enviado.
 */
function DurationProbe({ uri, onDuration }: { uri: string; onDuration: (seconds: number) => void }) {
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);
  const duration = status.isLoaded && Number.isFinite(status.duration) ? Math.round(status.duration) : 0;

  useEffect(() => {
    if (duration > 0) onDuration(duration);
    // onDuration muda a cada renderização; só a duração lida importa aqui.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duration]);

  return null;
}

const styles = StyleSheet.create({
  section: { gap: 10, padding: 14, borderRadius: Radius.card, backgroundColor: Brand.surfaceSoft },
  label: { fontFamily: Fonts.sansMedium, fontSize: 12.5, color: Brand.text },
  hint: { fontFamily: Fonts.sans, fontSize: 12.5, lineHeight: 18, color: Brand.muted },
  video: { gap: 8, padding: 12, borderRadius: Radius.tile, backgroundColor: Brand.card },
  videoTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  number: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: Brand.surfaceSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  numberText: { fontFamily: Fonts.sansSemiBold, fontSize: 12.5, color: Brand.primaryDeep },
  videoTitle: {
    flex: 1,
    minHeight: 42,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: Radius.tile,
    borderWidth: 1,
    borderColor: Brand.surface,
    fontFamily: Fonts.sans,
    fontSize: 14.5,
    color: Brand.text,
  },
  duration: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  durationText: { fontFamily: Fonts.sans, fontSize: 12.5, lineHeight: 18, color: Brand.muted },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  spacer: { flex: 1 },
  row: { flexDirection: 'row' },
  total: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingTop: 2 },
  track: { alignSelf: 'stretch', height: 6, borderRadius: 3, backgroundColor: Brand.surface, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3, backgroundColor: Brand.primary },
});
