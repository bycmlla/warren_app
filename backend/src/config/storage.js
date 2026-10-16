const fs = require('node:fs');
const path = require('node:path');
const { metadadosDaMidia } = require('./ferramentasMidia');

// Arquivos enviados pela administração ficam no disco do servidor, fora do banco.
// imagens/ é público (capas e banners); midias/ só é servido a quem tem acesso à aula.
const RAIZ = process.env.STORAGE_DIR
  ? path.resolve(process.env.STORAGE_DIR)
  : path.join(__dirname, '..', '..', 'storage');

const megabytes = (variavel, padrao) => {
  const valor = Number(process.env[variavel]);
  return (Number.isFinite(valor) && valor > 0 ? valor : padrao) * 1024 * 1024;
};

const TIPOS = {
  imagem: {
    pasta: 'imagens',
    limite: megabytes('UPLOAD_MAX_IMAGEM_MB', 8),
    formatos: { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' },
  },
  // Foto de perfil: o aplicativo reduz a imagem antes de enviar, então o limite é bem menor.
  perfil: {
    pasta: 'imagens',
    limite: megabytes('UPLOAD_MAX_PERFIL_MB', 3),
    formatos: { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' },
  },
  video: {
    pasta: 'midias',
    limite: megabytes('UPLOAD_MAX_VIDEO_MB', 1024),
    formatos: { 'video/mp4': 'mp4', 'video/x-m4v': 'm4v', 'video/quicktime': 'mov', 'video/webm': 'webm' },
  },
  audio: {
    pasta: 'midias',
    limite: megabytes('UPLOAD_MAX_AUDIO_MB', 200),
    formatos: {
      'audio/mpeg': 'mp3',
      'audio/mp3': 'mp3',
      'audio/mp4': 'm4a',
      'audio/x-m4a': 'm4a',
      'audio/aac': 'aac',
      'audio/wav': 'wav',
      'audio/x-wav': 'wav',
      'audio/ogg': 'ogg',
    },
  },
};

const CONTENT_TYPES = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
};

const extensoes = (tipo) => new Set(Object.values(TIPOS[tipo].formatos));
const NOME_DE_ARQUIVO = /^[a-f0-9]{32}\.([a-z0-9]{2,4})$/;
const URL_DE_IMAGEM = /^\/arquivos\/imagens\/([a-f0-9]{32}\.(?:jpg|png|webp))$/;

const pasta = (nome) => path.join(RAIZ, nome);

function garantirPastas() {
  for (const nome of ['imagens', 'midias', 'miniaturas', 'reproducoes']) fs.mkdirSync(pasta(nome), { recursive: true });
}

const ascii = (buffer, inicio, fim) => buffer.toString('latin1', inicio, fim);

// Confere os primeiros bytes do arquivo, para não confiar só no tipo declarado pelo cliente.
function assinaturaValida(extensao, inicio) {
  if (inicio.length < 12) return false;
  const caixa = ascii(inicio, 4, 8);
  switch (extensao) {
    case 'jpg':
      return inicio[0] === 0xff && inicio[1] === 0xd8 && inicio[2] === 0xff;
    case 'png':
      return inicio[0] === 0x89 && ascii(inicio, 1, 4) === 'PNG';
    case 'webp':
      return ascii(inicio, 0, 4) === 'RIFF' && ascii(inicio, 8, 12) === 'WEBP';
    case 'mp4':
    case 'm4v':
    case 'm4a':
      return caixa === 'ftyp';
    case 'mov':
      return ['ftyp', 'moov', 'mdat', 'wide', 'free', 'skip'].includes(caixa);
    case 'webm':
      return inicio[0] === 0x1a && inicio[1] === 0x45 && inicio[2] === 0xdf && inicio[3] === 0xa3;
    case 'mp3':
      return ascii(inicio, 0, 3) === 'ID3' || (inicio[0] === 0xff && (inicio[1] & 0xe0) === 0xe0);
    case 'aac':
      return inicio[0] === 0xff && (inicio[1] & 0xf0) === 0xf0;
    case 'wav':
      return ascii(inicio, 0, 4) === 'RIFF' && ascii(inicio, 8, 12) === 'WAVE';
    case 'ogg':
      return ascii(inicio, 0, 4) === 'OggS';
    default:
      return false;
  }
}

// Tipo de aula ('video' | 'audio') compatível com um arquivo de mídia já enviado, ou null.
function tipoDaMidia(nome) {
  const extensao = NOME_DE_ARQUIVO.exec(nome ?? '')?.[1];
  if (!extensao) return null;
  if (extensoes('video').has(extensao)) return 'video';
  if (extensoes('audio').has(extensao)) return 'audio';
  return null;
}

const midiaExiste = (nome) => tipoDaMidia(nome) !== null && fs.existsSync(path.join(pasta('midias'), nome));

const FORMATOS_COM_DURACAO = new Set(['mp4', 'm4v', 'mov', 'm4a']);
const DURACAO_MAXIMA = 24 * 60 * 60;

/**
 * Duração, em segundos, de um vídeo ou áudio já enviado, lida do próprio arquivo: nos formatos
 * da família MP4 (mp4, m4v, mov, m4a) ela está na caixa `mvhd`, dentro de `moov`. Devolve null
 * quando o formato não traz essa informação de forma simples (webm, mp3, wav, ogg, aac) ou
 * quando o arquivo não pôde ser lido: nesses casos vale a duração informada pelo player.
 */
async function duracaoDaMidia(nome) {
  const extensao = NOME_DE_ARQUIVO.exec(nome ?? '')?.[1];
  if (!midiaExiste(nome)) return null;
  const metadata = await metadadosDaMidia(path.join(pasta('midias'), nome));
  if (metadata?.duration) return Math.max(1, Math.round(metadata.duration));
  if (!FORMATOS_COM_DURACAO.has(extensao)) return null;

  let arquivo;
  try {
    arquivo = await fs.promises.open(path.join(pasta('midias'), nome), 'r');
    const { size: tamanhoTotal } = await arquivo.stat();
    const ler = async (posicao, bytes) => {
      const dados = Buffer.alloc(bytes);
      const { bytesRead } = await arquivo.read(dados, 0, bytes, posicao);
      return bytesRead === bytes ? dados : null;
    };
    // Percorre as caixas entre `inicio` e `fim` até achar a do tipo pedido.
    const achar = async (tipo, inicio, fim) => {
      let posicao = inicio;
      for (let i = 0; i < 100000 && posicao + 8 <= fim; i += 1) {
        const cabecalho = await ler(posicao, Math.min(16, fim - posicao));
        if (!cabecalho) return null;
        let tamanho = cabecalho.readUInt32BE(0);
        let inicioDoConteudo = 8;
        if (tamanho === 1) {
          if (cabecalho.length < 16) return null;
          tamanho = Number(cabecalho.readBigUInt64BE(8));
          inicioDoConteudo = 16;
        } else if (tamanho === 0) {
          tamanho = fim - posicao;
        }
        if (tamanho < inicioDoConteudo) return null;
        if (ascii(cabecalho, 4, 8) === tipo) {
          return { inicio: posicao + inicioDoConteudo, fim: Math.min(posicao + tamanho, fim) };
        }
        posicao += tamanho;
      }
      return null;
    };

    const moov = await achar('moov', 0, tamanhoTotal);
    const mvhd = moov && (await achar('mvhd', moov.inicio, moov.fim));
    const dados = mvhd && mvhd.fim - mvhd.inicio >= 32 ? await ler(mvhd.inicio, 32) : null;
    if (!dados) return null;
    // Versão 1 usa datas e duração de 64 bits; a versão 0, de 32 bits.
    const [escala, duracao] =
      dados[0] === 1
        ? [dados.readUInt32BE(20), Number(dados.readBigUInt64BE(24))]
        : [dados.readUInt32BE(12), dados.readUInt32BE(16)];
    const segundos = escala > 0 ? Math.round(duracao / escala) : 0;
    return segundos > 0 && segundos <= DURACAO_MAXIMA ? segundos : null;
  } catch {
    return null;
  } finally {
    await arquivo?.close().catch(() => undefined);
  }
}

async function removerArquivo(nomeDaPasta, nome) {
  if (!NOME_DE_ARQUIVO.test(nome ?? '')) return;
  await fs.promises.rm(path.join(pasta(nomeDaPasta), nome), { force: true });
}

module.exports = {
  TIPOS,
  CONTENT_TYPES,
  URL_DE_IMAGEM,
  pasta,
  garantirPastas,
  assinaturaValida,
  tipoDaMidia,
  midiaExiste,
  duracaoDaMidia,
  removerArquivo,
};
