type VideoProgress = { duracaoSegundos: number | null; posicaoSegundos: number; concluido: boolean };

export function lessonDuration(videos: VideoProgress[]) {
  return videos.length > 0 && videos.every((video) => (video.duracaoSegundos ?? 0) > 0)
    ? videos.reduce((sum, video) => sum + (video.duracaoSegundos ?? 0), 0) : null;
}

/** Sem duração completa, só as conclusões confirmadas contribuem para o percentual. */
export function lessonPercent(videos: VideoProgress[]) {
  if (videos.length === 0) return 0;
  const total = lessonDuration(videos);
  const fraction = total === null
    ? videos.filter((video) => video.concluido).length / videos.length
    : videos.reduce((sum, video) => sum + (video.concluido ? video.duracaoSegundos!
      : Math.min(video.posicaoSegundos, video.duracaoSegundos!)), 0) / total;
  // Só todos os vídeos concluídos podem indicar 100%.
  return videos.every((video) => video.concluido) ? 100 : Math.min(99, Math.floor(fraction * 100));
}

export const resumePoint = (position: number, duration: number) =>
  Number.isFinite(position) && Number.isFinite(duration) && duration > 0
    ? Math.min(Math.max(0, position), Math.max(0, duration - 0.1)) : 0;
