import { memo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import type { LessonVideoProps } from '@/components/lesson-video.types';
import { Brand, Fonts, Radius } from '@/constants/brand';
import { resumePoint } from '@/utils/lesson-progress';

/** O elemento web usa a URL assinada; os controles nativos mantêm seek, volume e tela cheia. */
export const VideoLesson = memo(function VideoLesson({ source, resumeAt, autoPlay, onProgress, onPause, onEnd, onDuration, onRetry }: LessonVideoProps) {
  const ready = useRef(false);
  const played = useRef(false);
  const [failed, setFailed] = useState(false);
  return <>
    <video src={source.uri} controls playsInline preload="auto"
      style={{ width: '100%', aspectRatio: '16 / 9', borderRadius: Radius.card, backgroundColor: '#1E1F19' }}
      onLoadedMetadata={(event) => {
        const video = event.currentTarget;
        if (ready.current) return;
        ready.current = true;
        const knownDuration = Number.isFinite(video.duration) && video.duration > 0;
        if (knownDuration) onDuration(video.duration);
        try { video.currentTime = knownDuration ? resumePoint(resumeAt, video.duration) : Math.max(0, resumeAt); }
        catch { /* O arquivo pode não permitir seek até que mais dados tenham sido carregados. */ }
        if (autoPlay) void video.play().catch(() => undefined);
      }}
      onPlay={() => { played.current = true; }}
      onTimeUpdate={(event) => { if (ready.current && played.current) onProgress(event.currentTarget.currentTime); }}
      onPause={(event) => { if (ready.current && played.current) onPause?.(event.currentTarget.currentTime); }}
      onEnded={(event) => {
        if (!ready.current || !played.current) return;
        const video = event.currentTarget;
        const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : video.currentTime;
        if (duration > 0) { onDuration(duration); onEnd(duration); }
      }}
      onError={() => setFailed(true)}
    />
    {failed && <Pressable accessibilityRole="button" onPress={onRetry}>
      <Text style={styles.error}>Não foi possível carregar o vídeo. Toque para tentar novamente.</Text>
    </Pressable>}
  </>;
});

const styles = StyleSheet.create({ error: { fontFamily: Fonts.sans, fontSize: 13, lineHeight: 19, color: Brand.danger } });
