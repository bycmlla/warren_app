export function VideoDurationProbe({ uri, onDuration }: { uri: string; onDuration: (seconds: number) => void }) {
  return <video src={uri} muted preload="metadata" style={{ display: 'none' }} onLoadedMetadata={(event) => {
    const duration = event.currentTarget.duration;
    if (Number.isFinite(duration) && duration > 0) onDuration(Math.max(1, Math.round(duration)));
  }} />;
}
