const database = require('../config/database');
const fs = require('node:fs');
const path = require('node:path');
const { midiaExiste, tipoDaMidia, duracaoDaMidia, URL_DE_IMAGEM, pasta } = require('../config/storage');
const { emTransacao } = require('../utils/acessos');
const { linkSpotifyValido, recalcularTotais, removerMidiasSemUso, removerImagensSemUso } = require('../utils/cursos');
const { ErroRequisicao, rota, idDaRota, texto, listaDeIds } = require('../utils/http');
const { videosDaAula, duracaoTotal, arquivosDasAulas } = require('../utils/videos');

const TIPOS_DE_AULA = ['video', 'audio', 'spotify'];
const DURACAO_MAXIMA = 24 * 60 * 60;

async function exigirCurso(id) {
  const [cursos] = await database.execute('SELECT id FROM cursos WHERE id = ? LIMIT 1', [id]);
  if (!cursos[0]) throw new ErroRequisicao(404, 'Curso não encontrado.');
}

async function buscarModulo(id) {
  const [modulos] = await database.execute('SELECT id, curso_id FROM modulos WHERE id = ? LIMIT 1', [id]);
  if (!modulos[0]) throw new ErroRequisicao(404, 'Módulo não encontrado.');
  return modulos[0];
}

async function buscarAula(id) {
  const [aulas] = await database.execute(
    `SELECT a.id, a.modulo_id, a.tipo, a.arquivo, a.duracao_segundos, a.imagem_capa, m.curso_id
     FROM aulas a JOIN modulos m ON m.id = a.modulo_id
     WHERE a.id = ? LIMIT 1`,
    [id],
  );
  if (!aulas[0]) throw new ErroRequisicao(404, 'Aula não encontrada.');
  return aulas[0];
}

function camposDoModulo(corpo) {
  return {
    titulo: texto(corpo.titulo, 'o título do módulo', { max: 200, obrigatorio: true }),
    descricao: texto(corpo.descricao, 'descrição', { max: 5000 }),
  };
}

const MAXIMO_DE_VIDEOS = 30;

const duracaoInformada = (valor) => (Number.isInteger(valor) && valor > 0 && valor <= DURACAO_MAXIMA ? valor : null);

// A duração nunca é digitada: vem do próprio arquivo e, nos formatos em que ela não pode ser
// lida no servidor, do player do aplicativo, que a informa depois de carregar o arquivo.
const duracaoDe = async (arquivo, informada) => (await duracaoDaMidia(arquivo)) ?? duracaoInformada(informada);

/**
 * Dados de uma aula. Vídeo: um ou mais vídeos já enviados ao armazenamento, na ordem de
 * reprodução (`videos`: [{ id?, titulo?, arquivo, duracaoSegundos? }]). Áudio: um arquivo.
 * Spotify: um link válido. A duração da aula de vídeo é a soma das durações dos vídeos.
 */
async function camposDaAula(corpo) {
  const campos = {
    titulo: texto(corpo.titulo, 'o título da aula', { max: 200, obrigatorio: true }),
    descricao: texto(corpo.descricao, 'descrição', { max: 5000 }),
    imagem_capa: corpo.imagemCapa ?? null,
    tipo: corpo.tipo,
    arquivo: null,
    link_externo: null,
    duracao_segundos: null,
    // Aula de demonstração: qualquer aluno com conta assiste, mesmo sem acesso ao curso.
    demonstrativa: corpo.demonstrativa === true ? 1 : 0,
  };
  const videos = [];
  if (campos.imagem_capa !== null) {
    const nome = URL_DE_IMAGEM.exec(campos.imagem_capa)?.[1];
    if (!nome || !fs.existsSync(path.join(pasta('imagens'), nome))) throw new ErroRequisicao(400, 'Envie uma imagem válida para a capa da aula.');
  }

  if (!TIPOS_DE_AULA.includes(campos.tipo)) throw new ErroRequisicao(400, 'Selecione o tipo de mídia da aula.');

  if (campos.tipo === 'spotify') {
    if (!linkSpotifyValido(corpo.linkExterno)) {
      throw new ErroRequisicao(400, 'Informe um link válido do Spotify (https://open.spotify.com/...).');
    }
    campos.link_externo = corpo.linkExterno;
  } else if (campos.tipo === 'audio') {
    if (tipoDaMidia(corpo.arquivo) !== 'audio' || !midiaExiste(corpo.arquivo)) {
      throw new ErroRequisicao(400, 'Envie o arquivo de áudio da aula.');
    }
    campos.arquivo = corpo.arquivo;
    campos.duracao_segundos = await duracaoDe(corpo.arquivo, corpo.duracaoSegundos);
  } else {
    // Versões anteriores do aplicativo enviavam um único `arquivo` em vez da lista.
    const lista =
      corpo.videos ?? (corpo.arquivo ? [{ arquivo: corpo.arquivo, duracaoSegundos: corpo.duracaoSegundos }] : []);
    if (!Array.isArray(lista) || lista.length === 0) throw new ErroRequisicao(400, 'Envie ao menos um vídeo para a aula.');
    if (lista.length > MAXIMO_DE_VIDEOS) {
      throw new ErroRequisicao(400, `Uma aula aceita até ${MAXIMO_DE_VIDEOS} vídeos.`);
    }
    const ids = lista.map((item) => item?.id).filter((id) => id !== undefined && id !== null);
    if (!ids.every((id) => Number.isInteger(id) && id > 0) || new Set(ids).size !== ids.length) {
      throw new ErroRequisicao(400, 'Lista de vídeos inválida.');
    }
    for (const [indice, item] of lista.entries()) {
      if (tipoDaMidia(item?.arquivo) !== 'video' || !midiaExiste(item.arquivo)) {
        throw new ErroRequisicao(400, `Envie o arquivo do vídeo ${indice + 1}.`);
      }
      videos.push({
        id: item.id ?? null,
        titulo: texto(item.titulo, 'título do vídeo', { max: 200 }),
        arquivo: item.arquivo,
        duracao_segundos: await duracaoDe(item.arquivo, item.duracaoSegundos),
      });
    }
  }
  return { campos, videos };
}

/**
 * Grava os vídeos de uma aula na ordem recebida. Vídeos com `id` são atualizados — o progresso
 * dos alunos fica preso ao vídeo, não à posição, então reordenar ou renomear não o altera —;
 * sem `id`, são criados; os que saíram da lista são removidos. O progresso dos vídeos mantidos
 * continua associado aos mesmos IDs. Atualiza a duração e a conclusão com a lista atual.
 */
async function salvarVideos(conexao, aulaId, videos) {
  const atuais = await videosDaAula(aulaId, conexao);
  const porId = new Map(atuais.map((video) => [video.id, video]));
  if (videos.some((video) => video.id !== null && !porId.has(video.id))) {
    throw new ErroRequisicao(409, 'A lista de vídeos mudou. Atualize a tela e tente novamente.');
  }

  const mantidos = new Set(videos.map((video) => video.id));
  const removidos = atuais.filter((video) => !mantidos.has(video.id));
  if (removidos.length > 0) {
    const idsRemovidos = removidos.map((video) => video.id);
    await conexao.query('DELETE FROM aula_videos WHERE id IN (?)', [idsRemovidos]);
  }

  const semUso = removidos.map((video) => video.arquivo);
  for (const [indice, video] of videos.entries()) {
    const atual = video.id !== null ? porId.get(video.id) : null;
    if (!atual) {
      await conexao.execute(
        'INSERT INTO aula_videos (aula_id, titulo, arquivo, duracao_segundos, ordem) VALUES (?, ?, ?, ?, ?)',
        [aulaId, video.titulo, video.arquivo, video.duracao_segundos, indice + 1],
      );
      continue;
    }
    const mesmoArquivo = atual.arquivo === video.arquivo;
    await conexao.execute(
      'UPDATE aula_videos SET titulo = ?, arquivo = ?, duracao_segundos = ?, ordem = ? WHERE id = ?',
      [
        video.titulo,
        video.arquivo,
        // Sem leitura nova da duração, a do mesmo arquivo continua valendo.
        video.duracao_segundos ?? (mesmoArquivo ? atual.duracao_segundos : null),
        indice + 1,
        atual.id,
      ],
    );
    if (!mesmoArquivo) {
      semUso.push(atual.arquivo);
      // Arquivo trocado: o ponto de reprodução antigo não vale para o novo; a conclusão é mantida.
      await conexao.execute('UPDATE progresso_videos SET posicao_segundos = 0 WHERE video_id = ?', [atual.id]);
    }
  }

  if (videos.length > 0) {
    await conexao.execute('UPDATE aulas SET duracao_segundos = ? WHERE id = ?', [
      duracaoTotal(await videosDaAula(aulaId, conexao)),
      aulaId,
    ]);
    // Um vídeo novo exige sua própria conclusão; remover um pendente pode completar a aula.
    await conexao.execute(
      `UPDATE progresso_aulas p SET
         concluida_em = IF(NOT EXISTS (SELECT 1 FROM aula_videos v
           LEFT JOIN progresso_videos pv ON pv.video_id = v.id AND pv.usuario_id = p.usuario_id
           WHERE v.aula_id = p.aula_id AND COALESCE(pv.concluido, 0) = 0),
           COALESCE(p.concluida_em, NOW()), NULL),
         concluida = NOT EXISTS (SELECT 1 FROM aula_videos v
           LEFT JOIN progresso_videos pv ON pv.video_id = v.id AND pv.usuario_id = p.usuario_id
           WHERE v.aula_id = p.aula_id AND COALESCE(pv.concluido, 0) = 0)
       WHERE p.aula_id = ?`,
      [aulaId],
    );
  }
  return semUso;
}

// Aulas que alunos já iniciaram não são apagadas: o progresso deles seria perdido.
async function recusarSeHouverProgresso(condicao, parametro, mensagem) {
  const [[{ total }]] = await database.execute(
    `SELECT COUNT(*) AS total FROM progresso_aulas p
     JOIN aulas a ON a.id = p.aula_id JOIN usuarios u ON u.id = p.usuario_id
     WHERE ${condicao} AND u.tipo = 'aluno'`,
    [parametro],
  );
  if (Number(total) > 0) throw new ErroRequisicao(409, mensagem);
}

async function reordenar(tabela, coluna, donoId, ids) {
  const [existentes] = await database.execute(`SELECT id FROM ${tabela} WHERE ${coluna} = ?`, [donoId]);
  const conhecidos = new Set(existentes.map((linha) => linha.id));
  if (ids.length !== conhecidos.size || !ids.every((id) => conhecidos.has(id))) {
    throw new ErroRequisicao(409, 'A lista mudou. Atualize a tela e tente novamente.');
  }
  await database.query(
    `UPDATE ${tabela} SET ordem = CASE id ${ids.map(() => 'WHEN ? THEN ?').join(' ')} END WHERE id IN (?)`,
    [...ids.flatMap((id, indice) => [id, indice + 1]), ids],
  );
}

const criarModulo = rota(async (req, res) => {
  const cursoId = idDaRota(req.params.cursoId);
  await exigirCurso(cursoId);
  const campos = camposDoModulo(req.body || {});
  const [resultado] = await database.execute(
    `INSERT INTO modulos (curso_id, titulo, descricao, ordem)
     SELECT ?, ?, ?, COALESCE(MAX(ordem), 0) + 1 FROM modulos WHERE curso_id = ?`,
    [cursoId, campos.titulo, campos.descricao, cursoId],
  );
  res.status(201).json({ modulo: { id: resultado.insertId, ...campos, aulas: [] } });
});

const atualizarModulo = rota(async (req, res) => {
  const id = idDaRota(req.params.id);
  await buscarModulo(id);
  const campos = camposDoModulo(req.body || {});
  await database.execute('UPDATE modulos SET titulo = ?, descricao = ? WHERE id = ?', [campos.titulo, campos.descricao, id]);
  res.json({ message: 'Módulo atualizado.' });
});

const excluirModulo = rota(async (req, res) => {
  const id = idDaRota(req.params.id);
  const modulo = await buscarModulo(id);
  await recusarSeHouverProgresso(
    'a.modulo_id = ?',
    id,
    'Este módulo tem aulas já iniciadas por alunos e não pode ser excluído.',
  );
  const arquivos = await arquivosDasAulas('a.modulo_id = ?', id);
  await database.execute('DELETE FROM modulos WHERE id = ?', [id]);
  await removerMidiasSemUso(arquivos);
  await recalcularTotais(modulo.curso_id);
  res.json({ message: 'Módulo excluído.' });
});

const reordenarModulos = rota(async (req, res) => {
  const cursoId = idDaRota(req.params.cursoId);
  await exigirCurso(cursoId);
  await reordenar('modulos', 'curso_id', cursoId, listaDeIds(req.body?.ids));
  res.json({ message: 'Ordem atualizada.' });
});

// Sem `moduloId`, a aula entra no único módulo do curso; se o curso ainda não tem módulos,
// um módulo "Aulas" é criado — assim um curso simples não exige configurar módulos.
const criarAula = rota(async (req, res) => {
  const cursoId = idDaRota(req.params.cursoId);
  await exigirCurso(cursoId);
  const { campos, videos } = await camposDaAula(req.body || {});

  let moduloId = req.body.moduloId ?? null;
  if (moduloId !== null) {
    if (!Number.isInteger(moduloId) || (await buscarModulo(moduloId)).curso_id !== cursoId) {
      throw new ErroRequisicao(400, 'Módulo inválido para este curso.');
    }
  } else {
    const [modulos] = await database.execute('SELECT id FROM modulos WHERE curso_id = ? ORDER BY ordem, id', [cursoId]);
    if (modulos.length > 1) throw new ErroRequisicao(400, 'Selecione o módulo da aula.');
    moduloId =
      modulos[0]?.id ??
      (await database.execute("INSERT INTO modulos (curso_id, titulo, ordem) VALUES (?, 'Aulas', 1)", [cursoId]))[0]
        .insertId;
  }

  const aulaId = await emTransacao(async (conexao) => {
    const [resultado] = await conexao.execute(
      `INSERT INTO aulas (modulo_id, titulo, descricao, imagem_capa, tipo, arquivo, link_externo, duracao_segundos, demonstrativa, ordem)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(MAX(ordem), 0) + 1 FROM aulas WHERE modulo_id = ?`,
      [
        moduloId,
        campos.titulo,
        campos.descricao,
        campos.imagem_capa,
        campos.tipo,
        campos.arquivo,
        campos.link_externo,
        campos.duracao_segundos,
        campos.demonstrativa,
        moduloId,
      ],
    );
    await salvarVideos(conexao, resultado.insertId, videos);
    return resultado.insertId;
  });
  await recalcularTotais(cursoId);
  res.status(201).json({ aula: { id: aulaId, moduloId } });
});

const atualizarAula = rota(async (req, res) => {
  const id = idDaRota(req.params.id);
  const aula = await buscarAula(id);
  const { campos, videos } = await camposDaAula(req.body || {});
  if (req.body.imagemCapa === undefined) campos.imagem_capa = aula.imagem_capa;
  // O Spotify não informa duração: a que já estava cadastrada é mantida.
  if (campos.tipo === 'spotify' && aula.tipo === 'spotify') campos.duracao_segundos = aula.duracao_segundos;

  const semUso = await emTransacao(async (conexao) => {
    await conexao.execute('SELECT id FROM aulas WHERE id = ? FOR UPDATE', [id]);
    if (aula.tipo !== campos.tipo) {
      const [[{ total }]] = await conexao.execute(
        'SELECT COUNT(*) AS total FROM progresso_aulas WHERE aula_id = ?', [id],
      );
      if (Number(total) > 0) throw new ErroRequisicao(409, 'Esta aula já foi iniciada. Mantenha o tipo de mídia para preservar o progresso.');
    }
    // Versões anteriores do aplicativo enviam só o arquivo: ele continua sendo o primeiro vídeo.
    if (req.body.videos === undefined && videos.length === 1) {
      videos[0].id = (await videosDaAula(id, conexao))[0]?.id ?? null;
    }
    await conexao.execute(
      `UPDATE aulas SET titulo = ?, descricao = ?, imagem_capa = ?, tipo = ?, arquivo = ?, link_externo = ?, duracao_segundos = ?,
         demonstrativa = ?
       WHERE id = ?`,
      [
        campos.titulo,
        campos.descricao,
        campos.imagem_capa,
        campos.tipo,
        campos.arquivo,
        campos.link_externo,
        campos.duracao_segundos,
        campos.demonstrativa,
        id,
      ],
    );
    // Se a aula deixou de ser de vídeo, a lista fica vazia e os vídeos são removidos.
    return salvarVideos(conexao, id, videos);
  });
  await removerMidiasSemUso([...semUso, aula.arquivo !== campos.arquivo ? aula.arquivo : null]);
  if (aula.imagem_capa !== campos.imagem_capa) await removerImagensSemUso([aula.imagem_capa]);
  await recalcularTotais(aula.curso_id);
  res.json({ message: 'Aula atualizada.' });
});

const excluirAula = rota(async (req, res) => {
  const id = idDaRota(req.params.id);
  const aula = await buscarAula(id);
  await recusarSeHouverProgresso('a.id = ?', id, 'Esta aula já foi iniciada por alunos e não pode ser excluída.');
  const arquivos = await arquivosDasAulas('a.id = ?', id);
  await database.execute('DELETE FROM aulas WHERE id = ?', [id]);
  await removerMidiasSemUso(arquivos);
  await removerImagensSemUso([aula.imagem_capa]);
  await recalcularTotais(aula.curso_id);
  res.json({ message: 'Aula excluída.' });
});

const reordenarAulas = rota(async (req, res) => {
  const moduloId = idDaRota(req.params.id);
  await buscarModulo(moduloId);
  await reordenar('aulas', 'modulo_id', moduloId, listaDeIds(req.body?.ids));
  res.json({ message: 'Ordem atualizada.' });
});

module.exports = {
  criarModulo,
  atualizarModulo,
  excluirModulo,
  reordenarModulos,
  criarAula,
  atualizarAula,
  excluirAula,
  reordenarAulas,
};
