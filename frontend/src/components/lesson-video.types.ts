export type LessonVideoProps = {
  source: { uri: string; token: string };
  resumeAt: number;
  autoPlay?: boolean;
  onProgress: (seconds: number) => void;
  onPause?: (seconds: number) => void;
  onEnd: (seconds: number) => void;
  onDuration: (seconds: number) => void;
  onRetry: () => void;
};
