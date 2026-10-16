import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import * as Linking from 'expo-linking';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BrandIcon } from '@/components/brand-icon';
import { VideoLesson } from '@/components/lesson-video';
import { PrimaryButton } from '@/components/primary-button';
import { ScreenHeader } from '@/components/screen-header';
import { AuthGate } from '@/components/section-placeholder';
import { ApiUrl } from '@/constants/api';
import { Brand, Fonts, Gutter, Radius, Shadow } from '@/constants/brand';
import { useAuth } from '@/context/auth';
import { useAuthorizedQuery } from '@/hooks/use-authorized-query';
import { useStableEvent } from '@/hooks/use-stable-event';
import {
  fetchLesson,
  saveLessonProgress,
  type LessonDetail,
  type LessonVideo,
  type ProgressResult,
  type VideoProgressResult,
} from '@/services/catalog-api';
import { pendingProgress, persistProgress, syncProgress } from '@/services/progress-sync';
import { errorMessage } from '@/utils/errors';
import { formatClock, formatDuration } from '@/utils/format';
import { lessonDuration, lessonPercent, resumePoint } from '@/utils/lesson-progress';

const DETAIL_WIDTH = 640;
/** Intervalo mínimo, em segundos, entre os checkpoints durante a reprodução. */
const SAVE_EVERY = 10;

// Reprodução de uma aula. O backend só entrega a aula a quem tem acesso e já a desbloqueou.
export default function LessonScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  if (!user) return <AuthGate area="profile" areaLabel="esta aula" />;
  return <Loader key={`${user.id}-${id}`} lessonId={Number(id)} />;
}

function Loader({ lessonId }: { lessonId: number }) {
  const { user } = useAuth();
  const userId = user!.id;
  const load = useCallback(async (token: string) => {
    await syncProgress(userId, token).catch(() => undefined);
    const detail = await fetchLesson(token, lessonId);
    const pending = (await pendingProgress(userId)).filter((entry) => entry.lessonId === lessonId);
    for (const entry of pending) {
      const video = detail.videos.find((item) => item.id === entry.videoId);
      if (video && (!entry.mediaVersion || entry.mediaVersion === video.versaoMidia)) video.posicaoSegundos = entry.seconds;
      else if (entry.videoId === null) detail.aula.posicaoSegundos = entry.seconds;
    }
    const last = pending.sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (last?.videoId && detail.videos.some((video) => video.id === last.videoId)) detail.videoAtualId = last.videoId;
    return detail;
  }, [lessonId, userId]);
  const { data, error, loading, reload } = useAuthorizedQuery(load);

  if (data !== undefined) return <Lesson data={data} />;
  return (
    <View style={styles.screen}>
      <ScreenHeader />
      <View style={styles.missing}>
        {error !== undefined ? (
          <>
            <Text accessibilityLiveRegion="polite" style={styles.text}>
              {error}
            </Text>
            <PrimaryButton label="Voltar" onPress={() => router.back()} />
            <PrimaryButton variant="outline" label="Tentar novamente" onPress={reload} />
          </>
        ) : (
          loading && <ActivityIndicator color={Brand.primary} size="large" />
        )}
      </View>
    </View>
  );
}

function Lesson({ data }: { data: LessonDetail }) {
  const { aula: lesson, curso: course } = data;
  const { authorized, token, user } = useAuth();
  const userId = user!.id;
  const isVideo = lesson.tipo === 'video';
  const [result, setResult] = useState<ProgressResult>();
  const [notice, setNotice] = useState<string>();
  const [finishing, setFinishing] = useState(false);
  const [syncNotice, setSyncNotice] = useState<string>();

  // Aulas de vídeo: a lista com o progresso de cada vídeo, o vídeo em reprodução e o resultado
  // do último salvamento (que diz se a aula ficou concluída).
  const [videos, setVideos] = useState(data.videos);
  const [currentId, setCurrentId] = useState(data.videoAtualId ?? data.videos[0]?.id ?? null);
  const [videoResult, setVideoResult] = useState<VideoProgressResult>();
  // Muda a cada troca de vídeo ou reinício, para o player ser recriado no ponto certo.
  const [session, setSession] = useState(() => ({ count: 0, autoPlay: false, fromStart: false,
    resumeAt: data.videos.find((video) => video.id === currentId)?.posicaoSegundos ?? lesson.posicaoSegundos }));
  const current = videos.find((video) => video.id === currentId);

  const startAt = isVideo ? (current?.posicaoSegundos ?? 0) : lesson.posicaoSegundos;
  const position = useRef(startAt);
  const savedAt = useRef(startAt);
  const finished = useRef(false);
  const durations = useRef(new Map(data.videos.map((video) => [video.id, video.duracaoSegundos])));
  const lastSaveTime = useRef(0);
  const sessionKey = `${currentId}-${session.count}`;
  const activeSession = useRef(sessionKey);
  useLayoutEffect(() => { activeSession.current = sessionKey; }, [sessionKey]);
  const mounted = useRef(true);

  const latest = videoResult ?? result;
  const done = isVideo ? videos.length > 0 && videos.every((video) => video.concluido) : (result?.concluida ?? lesson.concluida);
  const next = latest ? latest.proxima : data.proxima;
  const watched = videos.filter((video) => video.concluido).length;
  const percent = lessonPercent(videos);
  const duration = isVideo ? lessonDuration(videos) : lesson.duracaoSegundos;
  const [webPaths, setWebPaths] = useState(() => new Map(data.videos.map((video) => [video.id, video.midiaWeb])));
  const mediaPath = Platform.OS === 'web' ? lesson.midiaWeb : lesson.midia;
  const videoPath = current ? (Platform.OS === 'web' ? webPaths.get(current.id) ?? current.midiaWeb : current.midia) : null;
  const media = useMemo(() => mediaPath !== null && token !== null ? { uri: `${ApiUrl}${mediaPath}`, token } : null, [mediaPath, token]);
  const videoSource = useMemo(() => videoPath !== null && token !== null ? { uri: `${ApiUrl}${videoPath}`, token } : null, [videoPath, token]);

  const patchVideo = (id: number, changes: Partial<LessonVideo>) =>
    setVideos((list) => {
      const target = list.find((video) => video.id === id);
      if (!target || Object.entries(changes).every(([key, value]) => target[key as keyof LessonVideo] === value)) return list;
      return list.map((video) => video.id === id ? { ...video, ...changes } : video);
    });

  // Salva o ponto de reprodução: do vídeo em reprodução ou, nas aulas de áudio, da própria aula.
  const savePosition = async (seconds: number, finalizado = false) => {
    if (!Number.isFinite(seconds) || seconds < 0 || token === null) return;
    savedAt.current = seconds;
    lastSaveTime.current = Date.now();
    if (isVideo) {
      if (currentId === null) return;
      patchVideo(currentId, { posicaoSegundos: Math.round(seconds) });
    }
    try {
      const response = await authorized((session_) => persistProgress(userId, session_, {
        lessonId: lesson.id, videoId: isVideo ? currentId : null, seconds,
        finished: finalizado, duration: isVideo ? durations.current.get(currentId!) ?? undefined : undefined,
        mediaVersion: isVideo ? current?.versaoMidia : undefined,
        updatedAt: Date.now(),
      }));
      if (mounted.current) {
        const pending = await pendingProgress(userId);
        setSyncNotice(pending.length > 0 ? 'Há progresso aguardando salvamento. Tentaremos novamente.' : undefined);
        if (response === undefined && isVideo) setNotice('Esta aula foi atualizada. Volte ao curso e abra-a novamente para continuar.');
        if (response && 'aulaConcluida' in response) {
          patchVideo(currentId!, { concluido: response.concluido, duracaoSegundos: response.duracaoSegundos });
          setVideoResult(response);
        }
      }
      return response;
    } catch (cause) {
      if (mounted.current) setSyncNotice(`${errorMessage(cause)} Tentaremos novamente.`);
      if (finalizado) throw cause;
    }
  };

  // Chamado pelos players a cada atualização: guarda a posição e salva de tempos em tempos.
  const onProgress = (seconds: number) => {
    if (activeSession.current !== sessionKey) return;
    position.current = seconds;
    if (Date.now() - lastSaveTime.current >= SAVE_EVERY * 1000 && Math.abs(seconds - savedAt.current) >= 1) void savePosition(seconds);
  };
  // Ao pausar, salva na hora (se a posição mudou desde o último salvamento).
  const onPause = (seconds: number) => {
    if (activeSession.current !== sessionKey) return;
    position.current = seconds;
    if (Math.abs(seconds - savedAt.current) >= 0.1) void savePosition(seconds);
  };

  // Troca o vídeo em reprodução (ou reinicia o atual), salvando antes o ponto do que estava tocando.
  const playVideo = (id: number, options: { autoPlay: boolean; fromStart?: boolean }) => {
    if (currentId !== null && id !== currentId && position.current !== savedAt.current) void savePosition(position.current);
    const target = videos.find((video) => video.id === id);
    const start = options.fromStart ? 0 : (target?.posicaoSegundos ?? 0);
    position.current = start;
    savedAt.current = start;
    lastSaveTime.current = Date.now();
    finished.current = false;
    activeSession.current = `${id}-${session.count + 1}`;
    setNotice(undefined);
    setCurrentId(id);
    setSession((value) => ({ count: value.count + 1, autoPlay: options.autoPlay, fromStart: options.fromStart ?? false, resumeAt: start }));
  };

  const restartVideo = () => {
    if (currentId === null) return;
    void savePosition(0);
    playVideo(currentId, { autoPlay: true, fromStart: true });
  };

  // Fim de um vídeo: conclui esse vídeo; a aula só fica concluída quando todos terminarem.
  // Havendo um próximo vídeo na sequência, ele começa em seguida.
  const finishVideo = async (seconds: number) => {
    if (activeSession.current !== sessionKey || finished.current || currentId === null) return;
    finished.current = true;
    setNotice(undefined);
    const videoId = currentId;
    position.current = seconds;
    const saving = savePosition(seconds, true);
    const following = videos[videos.findIndex((video) => video.id === videoId) + 1];
    if (following) playVideo(following.id, { autoPlay: true });
    try {
      const saved = await saving;
      if (!mounted.current || !saved || !('aulaConcluida' in saved)) return;
      if (!following && !saved.aulaConcluida) {
        const missing = saved.totalVideos - saved.videosConcluidos;
        setNotice(
          missing === 1
            ? 'Falta 1 vídeo para concluir esta aula.'
            : `Faltam ${missing} vídeos para concluir esta aula.`
        );
      }
    } catch (cause) {
      if (activeSession.current === sessionKey) finished.current = false;
      if (mounted.current) setNotice(errorMessage(cause));
    }
  };

  // Conclui a aula: ao fim da reprodução (áudio) ou manualmente (Spotify).
  const finish = async (seconds: number) => {
    if (finished.current) return;
    finished.current = true;
    setNotice(undefined);
    setFinishing(true);
    try {
      setResult(
        await authorized((session_) =>
          saveLessonProgress(session_, lesson.id, { posicaoSegundos: seconds, finalizada: true })
        )
      );
    } catch (cause) {
      finished.current = false;
      setNotice(errorMessage(cause));
    } finally {
      setFinishing(false);
    }
  };

  // Ao sair da tela, salva a posição para o aluno continuar de onde parou.
  const leave = useRef(() => undefined as void);
  useEffect(() => {
    leave.current = () => {
      if (lesson.tipo !== 'spotify' && position.current !== savedAt.current) void savePosition(position.current);
    };
  });
  useEffect(() => {
    mounted.current = true;
    lastSaveTime.current = Date.now();
    const flush = () => leave.current();
    const state = AppState.addEventListener('change', (value) => { if (value !== 'active') flush(); });
    const visibility = () => { if (document.visibilityState === 'hidden') flush(); };
    if (Platform.OS === 'web') {
      window.addEventListener('pagehide', flush);
      document.addEventListener('visibilitychange', visibility);
    }
    return () => {
      flush();
      mounted.current = false;
      state.remove();
      if (Platform.OS === 'web') {
        window.removeEventListener('pagehide', flush);
        document.removeEventListener('visibilitychange', visibility);
      }
    };
  }, []);
  useEffect(() => {
    const retry = async () => {
      try {
        const responses = await authorized((session_) => syncProgress(userId, session_));
        if (!mounted.current) return;
        for (const [key, response] of responses) {
          if (!key.startsWith(`${lesson.id}.`) || !('aulaConcluida' in response)) continue;
          patchVideo(Number(key.split('.')[1]), { concluido: response.concluido, duracaoSegundos: response.duracaoSegundos });
          setVideoResult(response);
        }
        const remaining = await pendingProgress(userId);
        if (mounted.current) setSyncNotice(remaining.length > 0 ? 'Há progresso aguardando salvamento. Tentaremos novamente.' : undefined);
      } catch { if (mounted.current) setSyncNotice('O progresso aguarda salvamento. Tentaremos novamente quando a conexão voltar.'); }
    };
    const timer = setInterval(() => { void retry(); }, 15000);
    const state = AppState.addEventListener('change', (value) => { if (value === 'active') void retry(); });
    if (Platform.OS === 'web') window.addEventListener('online', retry);
    return () => {
      clearInterval(timer);
      state.remove();
      if (Platform.OS === 'web') window.removeEventListener('online', retry);
    };
    // A sessão e o usuário ficam fixos durante a montagem desta aula.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const retryVideo = async () => {
    if (currentId === null) return;
    try {
      const refreshed = await authorized((session_) => fetchLesson(session_, lesson.id));
      const target = refreshed.videos.find((video) => video.id === currentId) ?? refreshed.videos[0];
      if (!target) return setNotice('Esta aula ainda não tem vídeos disponíveis.');
      if (target.versaoMidia === current?.versaoMidia) target.posicaoSegundos = position.current;
      setVideos(refreshed.videos);
      durations.current = new Map(refreshed.videos.map((video) => [video.id, video.duracaoSegundos]));
      setWebPaths(new Map(refreshed.videos.map((video) => [video.id, video.midiaWeb])));
      position.current = target.posicaoSegundos;
      savedAt.current = target.posicaoSegundos;
      finished.current = false;
      activeSession.current = `${target.id}-${session.count + 1}`;
      setCurrentId(target.id);
      setVideoResult(undefined);
      setNotice(undefined);
      setSession((value) => ({ count: value.count + 1, autoPlay: true, fromStart: false, resumeAt: target.posicaoSegundos }));
    } catch (cause) { setNotice(errorMessage(cause)); }
  };

  const openSpotify = async () => {
    setNotice(undefined);
    try {
      if (lesson.linkExterno) await Linking.openURL(lesson.linkExterno);
    } catch {
      setNotice('Não foi possível abrir o Spotify neste dispositivo.');
    }
  };

  const playerProgress = useStableEvent(onProgress, sessionKey);
  const playerPause = useStableEvent(onPause, sessionKey);
  const playerEnd = useStableEvent(finishVideo, sessionKey);
  const playerRetry = useStableEvent(retryVideo, sessionKey);
  const playerDuration = useStableEvent((seconds: number) => {
    if (!current) return;
    durations.current.set(current.id, seconds);
    if (current.duracaoSegundos === null) {
      patchVideo(current.id, { duracaoSegundos: Math.max(1, Math.round(seconds)) });
      void savePosition(position.current);
    }
  }, sessionKey);

  return (
    <View style={styles.screen}>
      <ScreenHeader title={`Aula ${data.posicao} de ${data.total}`} />
      <SafeAreaView edges={['bottom', 'left', 'right']} style={styles.body}>
        <ScrollView contentContainerStyle={styles.content}>
          {isVideo && current && videoSource && (
            <View style={styles.videoBox}>
              <VideoLesson
                key={`${current.id}-${session.count}`}
                source={videoSource}
                resumeAt={session.resumeAt}
                autoPlay={session.autoPlay}
                onProgress={playerProgress}
                onPause={playerPause}
                onEnd={playerEnd}
                onDuration={playerDuration}
                onRetry={playerRetry}
              />
              <View style={styles.playerBar}>
                <Text numberOfLines={1} style={styles.playing}>
                  {videos.length > 1
                    ? `Vídeo ${videos.indexOf(current) + 1} de ${videos.length}${current.titulo ? ` · ${current.titulo}` : ''}`
                    : ''}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  hitSlop={8}
                  onPress={restartVideo}
                  style={({ pressed }) => pressed && styles.pressed}>
                  <Text style={styles.link}>Recomeçar do início</Text>
                </Pressable>
              </View>
            </View>
          )}
          {isVideo && videos.length === 0 && (
            <Text style={styles.playerError}>Esta aula ainda não tem vídeos disponíveis.</Text>
          )}
          {lesson.tipo === 'audio' && media && (
            <AudioLesson source={media} resumeAt={lesson.posicaoSegundos} onProgress={onProgress} onPause={onPause} onEnd={finish} />
          )}
          {lesson.tipo === 'spotify' && (
            <View style={styles.spotify}>
              <View style={styles.spotifyIcon}>
                <BrandIcon name="music" size={28} strokeWidth={1.3} />
              </View>
              <Text style={styles.text}>Esta aula é reproduzida no Spotify.</Text>
              <PrimaryButton label="Abrir no Spotify" onPress={openSpotify} style={styles.wide} />
            </View>
          )}

          <View style={styles.block}>
            <Text style={styles.tag}>{course.titulo}</Text>
            <Text accessibilityRole="header" style={styles.title}>
              {lesson.titulo}
            </Text>
            {lesson.descricao !== null && <Text style={styles.text}>{lesson.descricao}</Text>}
            {/* Duração total da aula (não o tempo assistido); só aparece quando é conhecida. */}
            {duration !== null && duration > 0 && (
              <View accessible accessibilityLabel={`Duração: ${formatDuration(duration)}`} style={styles.duration}>
                <BrandIcon name="clock" size={15} strokeWidth={1.5} color={Brand.muted} />
                <Text style={styles.durationText}>{formatDuration(duration)}</Text>
              </View>
            )}
          </View>

          {isVideo && videos.length > 1 && (
            <View style={styles.videoList}>
              {videos.map((video, index) => (
                <VideoRow
                  key={video.id}
                  video={video}
                  number={index + 1}
                  selected={video.id === currentId}
                  divided={index > 0}
                  onPress={() => video.id !== currentId && playVideo(video.id, { autoPlay: true })}
                />
              ))}
            </View>
          )}

          {isVideo && videos.length > 0 && !done && (
            <View style={styles.progress}>
              <Text style={styles.progressText}>
                {percent}% da aula · {watched} de {videos.length} {videos.length === 1 ? 'vídeo concluído' : 'vídeos concluídos'}
              </Text>
              <View
                accessibilityRole="progressbar"
                accessibilityValue={{ min: 0, max: 100, now: percent }}
                style={styles.track}>
                <View style={[styles.fill, { width: `${percent}%` }]} />
              </View>
            </View>
          )}

          {notice !== undefined && (
            <Text accessibilityLiveRegion="polite" style={styles.notice}>
              {notice}
            </Text>
          )}
          {syncNotice !== undefined && <Text accessibilityLiveRegion="polite" style={styles.notice}>{syncNotice}</Text>}

          {done ? (
            <View style={styles.done}>
              <View style={styles.doneIcon}>
                <BrandIcon name="check" size={16} strokeWidth={2} color={Brand.white} />
              </View>
              <Text style={styles.doneText}>
                {latest?.cursoConcluido ? 'Aula concluída. Você concluiu o curso!' : 'Aula concluída.'}
              </Text>
            </View>
          ) : (
            lesson.tipo === 'spotify' && (
              <PrimaryButton
                variant="outline"
                label="Marcar como concluída"
                onPress={() => finish(0)}
                loading={finishing}
              />
            )
          )}

          {done && next !== null && next.estado !== 'bloqueada' && (
            <PrimaryButton
              label={`Próxima aula: ${next.titulo}`}
              onPress={() => router.replace({ pathname: '/lesson/[id]', params: { id: String(next.id) } })}
            />
          )}
          <PrimaryButton variant="outline" label="Voltar ao curso" onPress={() => router.dismissTo({ pathname: '/course/[id]', params: { id: String(course.id) } })} />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

/** Linha de um vídeo na lista da aula: número, título, duração e situação para este aluno. */
function VideoRow({
  video,
  number,
  selected,
  divided,
  onPress,
}: {
  video: LessonVideo;
  number: number;
  selected: boolean;
  divided: boolean;
  onPress: () => void;
}) {
  const title = video.titulo ?? `Vídeo ${number}`;
  const state = selected ? 'Selecionado' : video.concluido ? 'Concluído' : video.posicaoSegundos > 0 ? 'Em andamento' : null;
  const meta = [video.duracaoSegundos ? formatClock(video.duracaoSegundos) : null, state].filter(Boolean).join(' · ');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={[`Vídeo ${number}`, title, meta, video.concluido && selected ? 'Concluído' : null].filter(Boolean).join(', ')}
      onPress={onPress}
      style={({ pressed }) => [styles.videoRow, divided && styles.videoDivider, selected && styles.videoSelected, pressed && styles.pressed]}>
      <View style={[styles.videoNumber, video.concluido && styles.videoNumberDone, selected && !video.concluido && styles.videoNumberSelected]}>
        {video.concluido ? (
          <BrandIcon name="check" size={14} strokeWidth={2.2} color={Brand.white} />
        ) : (
          <Text style={[styles.videoNumberText, selected && styles.videoNumberTextSelected]}>{number}</Text>
        )}
      </View>
      <View style={styles.videoText}>
        <Text numberOfLines={2} style={[styles.videoTitle, selected && styles.videoTitleSelected]}>
          {title}
        </Text>
        {meta !== '' && <Text style={styles.videoMeta}>{meta}</Text>}
      </View>
    </Pressable>
  );
}

type PlayerProps = {
  source: { uri: string; token: string };
  resumeAt: number;
  onProgress: (seconds: number) => void;
  onEnd: (seconds: number) => void;
  /** Começa a tocar assim que o vídeo carrega (troca de vídeo, avanço automático). */
  autoPlay?: boolean;
  onPause?: (seconds: number) => void;
};

function AudioLesson({ source, resumeAt, onProgress, onEnd, onPause }: PlayerProps) {
  const player = useAudioPlayer(
    { uri: source.uri, headers: { Authorization: `Bearer ${source.token}` } },
    { updateInterval: 500 }
  );
  const status = useAudioPlayerStatus(player);
  const resumed = useRef(false);
  const ended = useRef(false);
  const played = useRef(false);
  const duration = Number.isFinite(status.duration) ? status.duration : 0;
  const atEnd = duration > 0 && status.currentTime >= duration - 0.3;

  useEffect(() => {
    if (!status.isLoaded || duration <= 0 || resumed.current) return;
    resumed.current = true;
    const start = resumePoint(resumeAt, duration);
    if (start > 0) player.seekTo(start);
  }, [status.isLoaded, duration, resumeAt, player]);

  useEffect(() => {
    if (status.playing) played.current = true;
    if (status.isLoaded && resumed.current && played.current) {
      if (status.playing) onProgress(status.currentTime);
      else onPause?.(status.currentTime);
    }
    // onProgress muda a cada renderização; só a posição importa aqui.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.isLoaded, status.currentTime, status.playing]);

  useEffect(() => {
    if (!status.didJustFinish || ended.current) return;
    ended.current = true;
    onEnd(Math.max(duration, status.currentTime));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.didJustFinish]);

  const toggle = async () => {
    if (status.playing) return player.pause();
    if (atEnd) {
      ended.current = false;
      await player.seekTo(0);
    }
    return player.play();
  };
  const seekBy = (delta: number) =>
    player.seekTo(Math.min(Math.max(status.currentTime + delta, 0), Math.max(duration - 0.5, 0)));

  return (
    <View style={styles.audio}>
      <View style={styles.audioControls}>
        <SeekButton label="Voltar 15 segundos" text="−15s" onPress={() => seekBy(-15)} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={status.playing ? 'Pausar' : 'Reproduzir'}
          disabled={!status.isLoaded}
          onPress={toggle}
          style={({ pressed }) => [styles.playButton, pressed && styles.pressed]}>
          {status.isLoaded ? (
            <BrandIcon name={status.playing ? 'pause' : 'play'} size={26} color={Brand.white} filled strokeWidth={2} />
          ) : (
            <ActivityIndicator color={Brand.white} />
          )}
        </Pressable>
        <SeekButton label="Avançar 15 segundos" text="+15s" onPress={() => seekBy(15)} />
      </View>
      <View
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: Math.round(duration), now: Math.round(status.currentTime) }}
        style={styles.track}>
        <View style={[styles.fill, { width: `${duration > 0 ? Math.min(100, (status.currentTime / duration) * 100) : 0}%` }]} />
      </View>
      <View style={styles.times}>
        <Text style={styles.time}>{formatClock(status.currentTime)}</Text>
        <Text style={styles.time}>{duration > 0 ? formatClock(duration) : '--:--'}</Text>
      </View>
    </View>
  );
}

function SeekButton({ label, text, onPress }: { label: string; text: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [styles.seekButton, pressed && styles.pressed]}>
      <Text style={styles.seekText}>{text}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Brand.background },
  body: { flex: 1 },
  content: {
    width: '100%',
    maxWidth: DETAIL_WIDTH,
    alignSelf: 'center',
    paddingHorizontal: Gutter,
    paddingTop: 4,
    paddingBottom: 28,
    gap: 18,
  },
  missing: { flex: 1, justifyContent: 'center', padding: 28, gap: 12 },
  block: { gap: 8 },
  tag: {
    fontFamily: Fonts.sansMedium,
    fontSize: 11,
    letterSpacing: 0.9,
    color: Brand.primaryDeep,
    textTransform: 'uppercase',
  },
  title: { fontFamily: Fonts.serifMedium, fontSize: 26, lineHeight: 32, color: Brand.text },
  text: { fontFamily: Fonts.sans, fontSize: 14.5, lineHeight: 22, color: Brand.muted, textAlign: 'left' },
  videoBox: { gap: 8 },
  video: { width: '100%', aspectRatio: 16 / 9, borderRadius: Radius.card, backgroundColor: '#1E1F19' },
  playerError: { fontFamily: Fonts.sans, fontSize: 13, lineHeight: 19, color: Brand.danger },
  playerBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  playing: { flex: 1, fontFamily: Fonts.sansMedium, fontSize: 12.5, color: Brand.text },
  link: { fontFamily: Fonts.sansMedium, fontSize: 12.5, color: Brand.primaryDeep, textDecorationLine: 'underline' },
  duration: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  durationText: { fontFamily: Fonts.sansMedium, fontSize: 13, color: Brand.muted },
  videoList: { borderRadius: Radius.card, backgroundColor: Brand.card, boxShadow: Shadow.field, overflow: 'hidden' },
  videoRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 14, paddingVertical: 9 },
  videoDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Brand.primarySoft },
  videoSelected: { backgroundColor: Brand.surfaceSoft },
  videoNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Brand.surfaceSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoNumberDone: { backgroundColor: Brand.primary },
  videoNumberSelected: { backgroundColor: Brand.card, borderWidth: 1.5, borderColor: Brand.primary },
  videoNumberText: { fontFamily: Fonts.sansSemiBold, fontSize: 12.5, color: Brand.muted },
  videoNumberTextSelected: { color: Brand.primaryDeep },
  videoText: { flex: 1, gap: 1 },
  videoTitle: { fontFamily: Fonts.sansMedium, fontSize: 14, lineHeight: 19, color: Brand.text },
  videoTitleSelected: { color: Brand.primaryDeep },
  videoMeta: { fontFamily: Fonts.sans, fontSize: 12, lineHeight: 17, color: Brand.muted },
  progress: { gap: 6 },
  progressText: { fontFamily: Fonts.sansMedium, fontSize: 13, color: Brand.text },
  audio: {
    gap: 12,
    padding: 20,
    borderRadius: Radius.hero,
    backgroundColor: Brand.card,
    boxShadow: Shadow.card,
  },
  audioControls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 22, paddingBottom: 6 },
  playButton: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: Brand.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  seekButton: {
    minWidth: 56,
    minHeight: 44,
    borderRadius: Radius.pill,
    backgroundColor: Brand.surfaceSoft,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  seekText: { fontFamily: Fonts.sansMedium, fontSize: 13, color: Brand.text },
  track: { height: 6, borderRadius: 3, backgroundColor: Brand.surface, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3, backgroundColor: Brand.primary },
  times: { flexDirection: 'row', justifyContent: 'space-between' },
  time: { fontFamily: Fonts.sans, fontSize: 12, color: Brand.muted, fontVariant: ['tabular-nums'] },
  spotify: {
    alignItems: 'center',
    gap: 12,
    padding: 22,
    borderRadius: Radius.hero,
    backgroundColor: Brand.surfaceSoft,
  },
  spotifyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Brand.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wide: { alignSelf: 'stretch' },
  notice: {
    fontFamily: Fonts.sans,
    fontSize: 13,
    lineHeight: 19,
    color: Brand.text,
    backgroundColor: Brand.surfaceSoft,
    borderRadius: Radius.tile,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  done: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  doneIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Brand.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneText: { flex: 1, fontFamily: Fonts.sansMedium, fontSize: 14, lineHeight: 20, color: Brand.text },
  pressed: { opacity: 0.75 },
});
