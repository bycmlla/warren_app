const path = require('node:path');
const database = require('../config/database');
const { CONTENT_TYPES, pasta, midiaExiste } = require('../config/storage');
const { conteudoDoCurso, estadosDasAulas, situacaoDeAcesso, aulasConcluidas, recalcularTotais } = require('../utils/cursos');
const { emTransacao } = require('../utils/acessos');
const { gerarTokenDeMidia } = require('../config/auth');
const { ErroRequisicao, rota, idDaRota } = require('../utils/http');
const { exigirAceiteParaConteudo } = require('../utils/termos');
const { videosDaAula, duracaoTotal } = require('../utils/videos');
const { prepararVideo, temReproducaoLeve, reproducaoDoArquivo } = require('../utils/prepararVideo');

// O áudio mantém a regra existente. Vídeos precisam chegar ao final com uma tolerância curta.
const FRACAO_MINIMA = 0.9; // Mantém a regra existente apenas para áudio.
const chegouAoFim = (posicao, duracao) => duracao > 0 && posicao >= duracao - Math.min(2, duracao * 0.02);

const SEM_ACESSO = {
  vencido: 'Seu prazo de acesso a este curso terminou.',
  revogado: 'Seu acesso a este curso foi encerrado.',
  agendado: 'Seu acesso a este curso ainda não começou.',
};

/**
 * Carrega a aula e confirma que o usuário pode abri-la agora: curso publicado (ou ADMIN),
 * Termos de Uso aceitos, direito de acesso válido ao curso e, na progressão sequencial, aulas
 * anteriores concluídas. Aulas demonstrativas abrem para qualquer aluno com conta, fora da
 * sequência, exceto nos cursos restritos, que exigem autorização em todas as aulas.
 */
async function aulaLiberada(aulaId, usuario) {
  const [linhas] = await database.execute(
    `SELECT a.id, a.titulo, a.descricao, a.tipo, a.arquivo, a.link_externo, a.duracao_segundos,
            a.demonstrativa, c.id AS curso_id, c.titulo AS curso_titulo, c.status, c.tipo_acesso,
            c.progressao_sequencial
     FROM aulas a JOIN modulos m ON m.id = a.modulo_id JOIN cursos c ON c.id = m.curso_id
     WHERE a.id = ? LIMIT 1`,
    [aulaId],
  );
  const aula = linhas[0];
  const curso = aula && { id: aula.curso_id, status: aula.status, tipo_acesso: aula.tipo_acesso };
  if (!aula || (curso.status !== 'publicado' && usuario.role !== 'ADMIN')) {
    throw new ErroRequisicao(404, 'Aula não encontrada.');
  }
  await exigirAceiteParaConteudo(usuario);
  const situacao = await situacaoDeAcesso(usuario, curso);
  const demonstracao = situacao.estado !== 'liberado';
  if (demonstracao && (curso.tipo_acesso === 'restrito' || aula.demonstrativa !== 1)) {
    throw new ErroRequisicao(403, SEM_ACESSO[situacao.motivo] ?? 'Seu acesso a este curso ainda não está liberado.', {
      codigo: 'SEM_ACESSO',
    });
  }

  const aulas = (await conteudoDoCurso(curso.id)).flatMap((modulo) => modulo.aulas);
  const concluidas = await aulasConcluidas(usuario.id, curso.id);
  const indice = aulas.findIndex((item) => item.id === aula.id);
  // Sem acesso ao curso, só a própria aula demonstrativa fica aberta.
  const estados = demonstracao
    ? aulas.map((item, i) => (concluidas.has(item.id) ? 'concluida' : i === indice ? 'disponivel' : 'bloqueada'))
    : estadosDasAulas(aulas, concluidas, aula.progressao_sequencial === 1);
  if (estados[indice] === 'bloqueada') {
    throw new ErroRequisicao(403, 'Conclua as aulas anteriores para liberar esta aula.', { codigo: 'BLOQUEADA' });
  }
  return { aula, aulas, estados, indice, demonstracao };
}

const vizinha = (aulas, estados, indice) =>
  aulas[indice] ? { id: aulas[indice].id, titulo: aulas[indice].titulo, estado: estados[indice] } : null;

// Estados das aulas do curso depois que esta aula passa a contar como concluída.
const estadosApos = (aulas, estados, aula) =>
  estadosDasAulas(
    aulas,
    new Set(aulas.filter((item, i) => estados[i] === 'concluida' || item.id === aula.id).map((item) => item.id)),
    aula.progressao_sequencial === 1,
  );

function posicaoInformada(valor) {
  const posicao = valor ?? 0;
  if (typeof posicao !== 'number' || !Number.isFinite(posicao) || posicao < 0 || posicao > 24 * 60 * 60) {
    throw new ErroRequisicao(400, 'Posição de reprodução inválida.');
  }
  return Math.round(posicao);
}

// Vídeos da aula com o progresso do próprio usuário em cada um, na ordem de reprodução.
async function videosComProgresso(aulaId, usuarioId, conexao = database) {
  const videos = await videosDaAula(aulaId, conexao);
  if (videos.length === 0) return [];
  const [progressos] = await conexao.query(
    'SELECT video_id, posicao_segundos, concluido FROM progresso_videos WHERE usuario_id = ? AND video_id IN (?)',
    [usuarioId, videos.map((video) => video.id)],
  );
  const porVideo = new Map(progressos.map((progresso) => [progresso.video_id, progresso]));
  return videos.map((video) => ({
    ...video,
    posicao_segundos: porVideo.get(video.id)?.posicao_segundos ?? 0,
    concluido: porVideo.get(video.id)?.concluido === 1,
  }));
}

/**
 * Vídeo em que a aula deve reabrir: o último que o aluno assistiu; se ele já foi concluído,
 * o próximo ainda não concluído; sem histórico, o primeiro não concluído (ou o primeiro).
 */
function videoParaRetomar(videos, ultimoId) {
  if (videos.length === 0) return null;
  const ultimo = videos.findIndex((video) => video.id === ultimoId);
  if (ultimo >= 0 && !videos[ultimo].concluido) return videos[ultimo].id;
  const depois = videos.slice(ultimo + 1).find((video) => !video.concluido);
  const pendente = depois ?? videos.find((video) => !video.concluido);
  return (pendente ?? videos[Math.max(ultimo, 0)]).id;
}

const obterAula = rota(async (req, res) => {
  const id = idDaRota(req.params.id);
  const { aula, aulas, estados, indice, demonstracao } = await aulaLiberada(id, req.usuario);
  const [progressos] = await database.execute(
    `SELECT posicao_segundos, ultimo_video_id, concluida FROM progresso_aulas
     WHERE usuario_id = ? AND aula_id = ? LIMIT 1`,
    [req.usuario.id, id],
  );
  const videos = aula.tipo === 'video' ? await videosComProgresso(id, req.usuario.id) : [];
  const midiaWeb = (caminho) => `${caminho}${caminho.includes('?') ? '&' : '?'}acesso=${gerarTokenDeMidia(req.usuario.id, caminho.split('?')[0])}`;
  const caminhoVideo = (video) => {
    void prepararVideo(video.arquivo);
    return `/api/aulas/${aula.id}/videos/${video.id}/midia?perfil=${temReproducaoLeve(video.arquivo) ? 'leve' : 'original'}&v=${video.arquivo}`;
  };

  res.json({
    aula: {
      id: aula.id,
      titulo: aula.titulo,
      descricao: aula.descricao,
      tipo: aula.tipo,
      // Duração total da aula (soma dos vídeos); null enquanto não for conhecida.
      duracaoSegundos: aula.tipo === 'video' ? duracaoTotal(videos) : aula.duracao_segundos,
      linkExterno: aula.tipo === 'spotify' ? aula.link_externo : null,
      // Áudio: o arquivo da aula. Vídeo: o primeiro vídeo; cada um tem o seu endereço em `videos`.
      midia: aula.tipo === 'spotify' ? null : `/api/aulas/${aula.id}/midia`,
      midiaWeb: aula.tipo === 'spotify' ? null : midiaWeb(`/api/aulas/${aula.id}/midia`),
      posicaoSegundos: progressos[0]?.posicao_segundos ?? 0,
      concluida: aula.tipo === 'video'
        ? videos.length > 0 && videos.every((video) => video.concluido)
        : progressos[0]?.concluida === 1,
    },
    videos: videos.map((video) => ({
      id: video.id,
      versaoMidia: video.arquivo,
      titulo: video.titulo,
      duracaoSegundos: video.duracao_segundos,
      midia: caminhoVideo(video),
      midiaWeb: midiaWeb(caminhoVideo(video)),
      posicaoSegundos: video.posicao_segundos,
      concluido: video.concluido,
    })),
    videoAtualId: videoParaRetomar(videos, progressos[0]?.ultimo_video_id ?? null),
    curso: { id: aula.curso_id, titulo: aula.curso_titulo },
    posicao: indice + 1,
    total: aulas.length,
    demonstracao,
    proxima: demonstracao ? null : vizinha(aulas, estados, indice + 1),
  });
});

// Envia um arquivo de mídia com suporte a Range (o player pede trechos conforme a reprodução).
async function enviarMidia(res, arquivo, perfil = 'original') {
  if (!midiaExiste(arquivo)) throw new ErroRequisicao(404, 'O arquivo desta aula não está disponível.');
  const leve = perfil === 'leve';
  if (leve && !temReproducaoLeve(arquivo)) throw new ErroRequisicao(404, 'Recarregue a aula para atualizar o vídeo.');
  await new Promise((resolve, reject) => {
    res.sendFile(
      leve ? path.basename(reproducaoDoArquivo(arquivo)) : arquivo,
      {
        // A cópia leve fica em outra pasta; com `root`, o nome do arquivo não pode ser um caminho absoluto.
        root: pasta(leve ? 'reproducoes' : 'midias'),
        headers: {
          'Content-Type': leve ? 'video/mp4' : CONTENT_TYPES[arquivo.split('.').pop()],
          'Cache-Control': 'private, no-store',
        },
      },
      (error) => {
        // Interrupções do player (troca de posição, saída da tela) não são erros do servidor.
        if (error && !res.headersSent) return reject(error);
        return resolve();
      },
    );
  });
}

// Entrega o áudio da aula (ou, numa aula de vídeo, o primeiro vídeo) somente a quem pode abri-la.
const transmitirMidia = rota(async (req, res) => {
  const { aula } = await aulaLiberada(idDaRota(req.params.id), req.usuario);
  const arquivo = aula.tipo === 'video' ? (await videosDaAula(aula.id))[0]?.arquivo : aula.arquivo;
  await enviarMidia(res, aula.tipo === 'spotify' ? null : arquivo);
});

async function videoDaAula(aulaId, videoId) {
  const video = (await videosDaAula(aulaId)).find((item) => item.id === videoId);
  if (!video) throw new ErroRequisicao(404, 'Vídeo não encontrado nesta aula.');
  return video;
}

// Entrega um dos vídeos da aula, com as mesmas verificações de acesso da própria aula.
const transmitirVideo = rota(async (req, res) => {
  const { aula } = await aulaLiberada(idDaRota(req.params.id), req.usuario);
  const video = await videoDaAula(aula.id, idDaRota(req.params.videoId));
  if (req.query.v !== undefined && req.query.v !== video.arquivo) throw new ErroRequisicao(409, 'O vídeo foi substituído. Atualize a aula.', { codigo: 'VIDEO_SUBSTITUIDO' });
  // O perfil fica fixo na URL: nunca troca o arquivo no meio de uma sequência de pedidos Range.
  await enviarMidia(res, video.arquivo, req.query.perfil === 'leve' ? 'leve' : 'original');
});

/**
 * Salva o ponto de reprodução de um vídeo e, com `finalizado: true`, conclui esse vídeo (se a
 * posição chegar ao final, com até dois segundos de tolerância). A aula só é concluída quando todos os seus vídeos
 * estiverem concluídos. Tudo é gravado para o usuário da sessão: o progresso de um aluno nunca
 * toca o de outro. Um vídeo ou uma aula concluídos permanecem concluídos ao serem revistos.
 */
const registrarProgressoDoVideo = rota(async (req, res) => {
  const id = idDaRota(req.params.id);
  const { aula, aulas, estados, indice, demonstracao } = await aulaLiberada(id, req.usuario);
  const corpo = req.body || {};
  const posicao = posicaoInformada(corpo.posicaoSegundos);
  if (corpo.finalizado !== undefined && typeof corpo.finalizado !== 'boolean') {
    throw new ErroRequisicao(400, 'O campo finalizado deve ser verdadeiro ou falso.');
  }

  if (corpo.duracaoSegundos !== undefined &&
      (typeof corpo.duracaoSegundos !== 'number' || !Number.isFinite(corpo.duracaoSegundos) ||
       corpo.duracaoSegundos <= 0 || corpo.duracaoSegundos > 86400)) {
    throw new ErroRequisicao(400, 'Duração do vídeo inválida.');
  }
  const salvo = await emTransacao(async (conexao) => {
    // Serializa conclusões simultâneas e alterações da lista da mesma aula.
    await conexao.execute('SELECT id FROM aulas WHERE id = ? FOR UPDATE', [id]);
    const video = (await videosDaAula(id, conexao)).find((item) => item.id === idDaRota(req.params.videoId));
    if (!video || aula.tipo !== 'video') throw new ErroRequisicao(404, 'Vídeo não encontrado nesta aula.');
    if (corpo.versaoMidia !== undefined && corpo.versaoMidia !== video.arquivo) {
      throw new ErroRequisicao(409, 'O arquivo deste vídeo foi substituído. Atualize a aula.', { codigo: 'VIDEO_SUBSTITUIDO' });
    }
    // O player informa metadados reais para formatos cuja duração não pôde ser lida no servidor.
    const novaDuracao = !video.duracao_segundos && corpo.duracaoSegundos !== undefined;
    if (novaDuracao) {
      video.duracao_segundos = Math.max(1, Math.round(corpo.duracaoSegundos));
      await conexao.execute('UPDATE aula_videos SET duracao_segundos = ? WHERE id = ?', [video.duracao_segundos, video.id]);
    }
    const concluir = corpo.finalizado === true ? 1 : 0;
    if (concluir && !chegouAoFim(posicao, video.duracao_segundos)) {
      throw new ErroRequisicao(422, 'Assista ao vídeo até o fim para concluí-lo.', { codigo: 'INCOMPLETA' });
    }
    const ponto = video.duracao_segundos ? Math.min(posicao, video.duracao_segundos) : posicao;
    await conexao.execute(
      `INSERT INTO progresso_videos (usuario_id, video_id, posicao_segundos, concluido, concluido_em)
       VALUES (?, ?, ?, ?, IF(?, NOW(), NULL))
       ON DUPLICATE KEY UPDATE
         posicao_segundos = VALUES(posicao_segundos),
         concluido_em = IF(concluido = 0 AND VALUES(concluido) = 1, NOW(), concluido_em),
         concluido = GREATEST(concluido, VALUES(concluido))`,
      [req.usuario.id, video.id, ponto, concluir, concluir],
    );

    const videos = await videosComProgresso(id, req.usuario.id, conexao);
    const concluidos = videos.filter((item) => item.concluido).length;
    const todos = videos.length > 0 && concluidos === videos.length ? 1 : 0;
    const duracao = duracaoTotal(videos);
    if (novaDuracao) await conexao.execute('UPDATE aulas SET duracao_segundos = ? WHERE id = ?', [duracao, id]);
    // A aula guarda o último vídeo assistido (para reabrir nele) e a própria conclusão.
    await conexao.execute(
      `INSERT INTO progresso_aulas (usuario_id, aula_id, posicao_segundos, ultimo_video_id, concluida, concluida_em)
       VALUES (?, ?, ?, ?, ?, IF(?, NOW(), NULL))
       ON DUPLICATE KEY UPDATE
         posicao_segundos = VALUES(posicao_segundos),
         ultimo_video_id = VALUES(ultimo_video_id),
         concluida_em = IF(concluida = 0 AND VALUES(concluida) = 1, NOW(), concluida_em),
         concluida = VALUES(concluida)`,
      [req.usuario.id, id, ponto, video.id, todos, todos],
    );
    return { videos, concluidos, todos, video, duracao, novaDuracao };
  });
  const { videos, concluidos, todos, video, duracao, novaDuracao } = salvo;
  if (novaDuracao) await recalcularTotais(aula.curso_id);
  const aulaConcluida = todos === 1;
  const novosEstados = aulaConcluida ? estadosApos(aulas, estados, aula) : estados;
  res.json({
    concluido: videos.find((item) => item.id === video.id).concluido,
    videosConcluidos: concluidos,
    totalVideos: videos.length,
    duracaoSegundos: video.duracao_segundos,
    duracaoAulaSegundos: duracao,
    aulaConcluida,
    cursoConcluido: novosEstados.every((estado) => estado === 'concluida'),
    proxima: demonstracao ? null : vizinha(aulas, novosEstados, indice + 1),
  });
});

/**
 * Salva a posição de reprodução e, com `finalizada: true`, conclui a aula. Vale para as aulas
 * de áudio (concluídas se a posição cobrir quase toda a duração) e do Spotify (concluídas
 * manualmente, pois a reprodução acontece fora do aplicativo). Aulas de vídeo são concluídas
 * pelos seus vídeos: aqui só é aceito concluí-las se todos já estiverem concluídos.
 */
const registrarProgresso = rota(async (req, res) => {
  const id = idDaRota(req.params.id);
  const { aula, aulas, estados, indice, demonstracao } = await aulaLiberada(id, req.usuario);
  const corpo = req.body || {};
  const posicao = posicaoInformada(corpo.posicaoSegundos);
  if (corpo.finalizada !== undefined && typeof corpo.finalizada !== 'boolean') {
    throw new ErroRequisicao(400, 'O campo finalizada deve ser verdadeiro ou falso.');
  }

  let concluir = corpo.finalizada === true;
  if (concluir && aula.tipo === 'video') {
    const videos = await videosComProgresso(id, req.usuario.id);
    if (videos.length === 0 || videos.some((video) => !video.concluido)) {
      throw new ErroRequisicao(422, 'Assista a todos os vídeos da aula para concluí-la.', { codigo: 'INCOMPLETA' });
    }
  } else if (concluir && aula.tipo === 'audio' && aula.duracao_segundos > 0) {
    if (posicao < aula.duracao_segundos * FRACAO_MINIMA) {
      throw new ErroRequisicao(422, 'Assista à aula até o fim para concluí-la.', { codigo: 'INCOMPLETA' });
    }
  }
  concluir = concluir ? 1 : 0;

  // Uma aula concluída permanece concluída, mesmo ao ser revista.
  await database.execute(
    `INSERT INTO progresso_aulas (usuario_id, aula_id, posicao_segundos, concluida, concluida_em)
     VALUES (?, ?, ?, ?, IF(?, NOW(), NULL))
     ON DUPLICATE KEY UPDATE
       posicao_segundos = VALUES(posicao_segundos),
       concluida_em = IF(concluida = 0 AND VALUES(concluida) = 1, NOW(), concluida_em),
       concluida = GREATEST(concluida, VALUES(concluida))`,
    [req.usuario.id, id, posicao, concluir, concluir],
  );

  const concluida = concluir === 1 || estados[indice] === 'concluida';
  const novosEstados = concluida ? estadosApos(aulas, estados, aula) : estados;
  res.json({
    concluida,
    cursoConcluido: novosEstados.every((estado) => estado === 'concluida'),
    proxima: demonstracao ? null : vizinha(aulas, novosEstados, indice + 1),
  });
});

module.exports = { obterAula, transmitirMidia, transmitirVideo, registrarProgresso, registrarProgressoDoVideo, chegouAoFim };
