const fs = require('node:fs');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const executar = promisify(execFile);
const ffmpeg = process.env.FFMPEG_PATH || require('ffmpeg-static');
const ffprobe = process.env.FFPROBE_PATH || require('ffprobe-static').path;
const cache = new Map();

// Limita processos e compartilha leituras simultâneas do mesmo arquivo imutável.
let ativos = 0;
const espera = [];
async function limitado(operacao) {
  if (ativos >= 2) await new Promise((resolve) => espera.push(resolve));
  else ativos += 1;
  try { return await operacao(); }
  finally { const proximo = espera.shift(); if (proximo) proximo(); else ativos -= 1; }
}

async function metadadosDaMidia(caminho) {
  try {
    const stat = await fs.promises.stat(caminho);
    const version = `${stat.size}:${stat.mtimeMs}`;
    const anterior = cache.get(caminho);
    if (anterior?.version === version) return anterior.promise;
    const promise = limitado(async () => {
      try {
        const { stdout } = await executar(ffprobe, ['-v', 'error', '-show_entries',
          'format=duration,size,bit_rate:stream=codec_type,codec_name,duration,width,height', '-of', 'json', caminho],
        { windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024 });
        const dados = JSON.parse(stdout);
        const video = dados.streams?.find((stream) => stream.codec_type === 'video');
        const duration = Number(video?.duration ?? dados.format?.duration);
        return { duration: Number.isFinite(duration) && duration > 0 && duration <= 86400 ? duration : null,
          video: Boolean(video), width: video?.width ?? null, height: video?.height ?? null,
          bitrate: Number(dados.format?.bit_rate) || null };
      } catch { return null; }
    });
    if (cache.size >= 256) cache.delete(cache.keys().next().value);
    cache.set(caminho, { version, promise });
    return promise;
  } catch { return null; }
}

const executarFFmpeg = (argumentos, opcoes = {}) => limitado(() => executar(ffmpeg,
  ['-nostdin', '-hide_banner', '-loglevel', 'error', ...argumentos],
  { windowsHide: true, timeout: 30 * 60 * 1000, maxBuffer: 1024 * 1024, ...opcoes }));

module.exports = { metadadosDaMidia, executarFFmpeg };
