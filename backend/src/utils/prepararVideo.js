const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pasta, midiaExiste, tipoDaMidia, garantirPastas } = require('../config/storage');
const { metadadosDaMidia, executarFFmpeg } = require('../config/ferramentasMidia');
const trabalhos = new Map();
let conversoes = Promise.resolve();

const nomeDerivado = (nome, extensao) => `${crypto.createHash('sha256').update(`video-v1:${nome}`).digest('hex').slice(0, 32)}.${extensao}`;
const miniaturaDoArquivo = (nome) => path.join(pasta('miniaturas'), nomeDerivado(nome, 'jpg'));
const reproducaoDoArquivo = (nome) => path.join(pasta('reproducoes'), nomeDerivado(nome, 'mp4'));
const temReproducaoLeve = (nome) => typeof nome === 'string' && fs.existsSync(reproducaoDoArquivo(nome));

/** Gera frame e cópia de reprodução uma vez, com processos limitados e publicação atômica. */
function prepararVideo(nome) {
  if (tipoDaMidia(nome) !== 'video' || !midiaExiste(nome)) return Promise.resolve(null);
  const existente = trabalhos.get(nome);
  if (existente) return existente.promise;
  const controller = new AbortController();
  const promise = (async () => {
    const origem = path.join(pasta('midias'), nome);
    const metadata = await metadadosDaMidia(origem);
    if (!metadata?.video || !metadata.duration || controller.signal.aborted) return null;
    garantirPastas();
    const gerar = async (destino, args, timeout) => {
      if (fs.existsSync(destino)) return;
      const parcial = `${destino}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.parcial`;
      try {
        await executarFFmpeg([...args, '-y', parcial], { signal: controller.signal, timeout });
        if (!midiaExiste(nome)) return;
        const stat = await fs.promises.stat(parcial);
        if (stat.size > 0) await fs.promises.rename(parcial, destino);
      } finally { await fs.promises.rm(parcial, { force: true }).catch(() => undefined); }
    };
    await gerar(miniaturaDoArquivo(nome), ['-ss', String(Math.min(1, metadata.duration / 3)), '-i', origem,
      '-map', '0:v:0', '-frames:v', '1', '-vf', 'scale=320:180:force_original_aspect_ratio=increase,crop=320:180',
      '-threads', '1', '-q:v', '3', '-f', 'image2'], 30000);
    // Até 720p, 30 fps e 2,5 Mb/s: reduz transferência e decodificação no celular.
    const converter = () => gerar(reproducaoDoArquivo(nome), ['-i', origem, '-map', '0:v:0', '-map', '0:a:0?',
      '-vf', "scale=w='min(1280,iw)':h='min(720,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,fps=30",
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-maxrate', '2500k', '-bufsize', '5000k',
      '-pix_fmt', 'yuv420p', '-threads', '2', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-f', 'mp4'], 30 * 60 * 1000);
    conversoes = conversoes.catch(() => undefined).then(converter);
    await conversoes;
    return metadata;
  })().catch(() => null).finally(() => trabalhos.delete(nome));
  trabalhos.set(nome, { controller, promise });
  return promise;
}

// A requisição da miniatura espera somente o frame; a conversão longa continua em segundo plano.
async function obterMiniatura(nome) {
  if (midiaExiste(nome) && fs.existsSync(miniaturaDoArquivo(nome))) return miniaturaDoArquivo(nome);
  const preparing = prepararVideo(nome);
  while (trabalhos.has(nome)) {
    if (fs.existsSync(miniaturaDoArquivo(nome))) return miniaturaDoArquivo(nome);
    await Promise.race([preparing, new Promise((resolve) => setTimeout(resolve, 100))]);
  }
  return fs.existsSync(miniaturaDoArquivo(nome)) ? miniaturaDoArquivo(nome) : null;
}

async function removerDerivados(nome) {
  const trabalho = trabalhos.get(nome);
  if (trabalho) { trabalho.controller.abort(); await trabalho.promise; }
  for (const arquivo of [miniaturaDoArquivo(nome), reproducaoDoArquivo(nome)]) {
    await fs.promises.rm(arquivo, { force: true });
  }
}

module.exports = { prepararVideo, obterMiniatura, temReproducaoLeve, reproducaoDoArquivo, removerDerivados };
