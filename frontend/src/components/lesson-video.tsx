import { useEventListener } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { memo, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import type { LessonVideoProps } from '@/components/lesson-video.types';
import { Brand, Fonts, Radius } from '@/constants/brand';
import { resumePoint } from '@/utils/lesson-progress';

export const VideoLesson = memo(function VideoLesson({ source, resumeAt, onProgress, onEnd, autoPlay = false, onPause, onDuration, onRetry }: LessonVideoProps) {
  const [failed, setFailed] = useState(false);
  const [startAt] = useState(resumeAt);
  const resumed = useRef(false);
  const played = useRef(false);
  const reported = useRef(false);
  const videoSource = useMemo(() => ({ uri: source.uri, headers: { Authorization: `Bearer ${source.token}` } }), [source.uri, source.token]);
  const player = useVideoPlayer(videoSource, (created) => {
    created.timeUpdateEventInterval = 2;
    created.bufferOptions = { preferredForwardBufferDuration: 20, minBufferForPlayback: 2 };
  });
  const prepare = (duration: number) => {
    const knownDuration = Number.isFinite(duration) && duration > 0;
    if (knownDuration && !reported.current) { reported.current = true; onDuration(duration); }
    if (resumed.current) return;
    resumed.current = true;
    played.current = player.playing;
    const start = knownDuration ? resumePoint(startAt, duration) : Math.max(0, startAt);
    if (start > 0) player.seekBy(start - player.currentTime);
    if (autoPlay) player.play();
  };
  useEventListener(player, 'sourceLoad', ({ duration }) => prepare(duration));
  useEventListener(player, 'statusChange', ({ status }) => {
    setFailed(status === 'error');
    if (status === 'readyToPlay') prepare(player.duration);
  });
  useEventListener(player, 'timeUpdate', ({ currentTime }) => {
    if (resumed.current && played.current) onProgress(currentTime);
  });
  useEventListener(player, 'playingChange', ({ isPlaying }) => {
    if (!resumed.current) return;
    if (isPlaying) played.current = true;
    else if (played.current) onPause?.(player.currentTime);
  });
  useEventListener(player, 'playToEnd', () => {
    if (!resumed.current || !played.current) return;
    const duration = Number.isFinite(player.duration) && player.duration > 0
      ? Math.max(player.duration, player.currentTime) : player.currentTime;
    if (duration > 0) { if (!reported.current) onDuration(duration); onEnd(duration); }
  });
  return <>
    <VideoView player={player} nativeControls contentFit="contain" fullscreenOptions={{ enable: true }} style={styles.video} />
    {failed && <Pressable accessibilityRole="button" onPress={onRetry}>
      <Text style={styles.error}>Não foi possível carregar o vídeo. Toque para tentar novamente.</Text>
    </Pressable>}
  </>;
});

const styles = StyleSheet.create({
  video: { width: '100%', aspectRatio: 16 / 9, borderRadius: Radius.card, backgroundColor: '#1E1F19' },
  error: { fontFamily: Fonts.sans, fontSize: 13, lineHeight: 19, color: Brand.danger },
});
