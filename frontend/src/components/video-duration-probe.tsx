import { useEventListener } from 'expo';
import { useVideoPlayer } from 'expo-video';
import { useRef } from 'react';

export function VideoDurationProbe({ uri, onDuration }: { uri: string; onDuration: (seconds: number) => void }) {
  const player = useVideoPlayer(uri);
  const reported = useRef(false);
  useEventListener(player, 'sourceLoad', ({ duration }) => {
    if (reported.current || !Number.isFinite(duration) || duration <= 0) return;
    reported.current = true;
    onDuration(Math.max(1, Math.round(duration)));
  });
  return null;
}
