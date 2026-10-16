const database = require('../config/database');
const { URL_DE_IMAGEM } = require('../config/storage');
const {
  SECOES,
  STATUS,
  conteudoDoCurso,
  removerImagensSemUso,
  removerMidiasSemUso,
} = require('../utils/cursos');
const { COLUNAS_COMERCIAIS, camposComerciais, pendenciasComerciais } = require('../utils/comercial');
const { emTransacao, validarSelecaoDeAcessos, aplicarSelecaoDeAcessos } = require('../utils/acessos');
const { ErroRequisicao, rota, idDaRota, texto, booleano } = require('../utils/http');
const { videosDoCurso, arquivosDasAulas } = require('../utils/videos');

// cursos.status aceita 'rascunho', 'publicado' e 'arquivado' (padrão 'rascunho').
// Um status nulo é tratado como rascunho, que é o padrão da coluna.
const STATUS_PADRAO = 'rascunho';

const COLUNAS = `c.id, c.titulo, c.subtitulo, c.descricao, c.instrutora, c.imagem_capa, c.imagem_banner,
  c.categoria_id, COALESCE(k.nome, c.categoria) AS categoria, c.secao, c.destaque,
  c.progressao_sequencial, c.status, c.total_aulas, c.duracao_minutos, c.atualizado_em, ${COLUNAS_COMERCIAIS}`;

const paraResposta = (curso) => ({
  id: curso.id,
  titulo: curso.titulo,
  subtitulo: curso.subtitulo,
  descricao: curso.descricao,
  instrutora: curso.instrutora,
  imagemCapa: curso.imagem_capa,
  imagemBanner: curso.imagem_banner,
  categoriaId: curso.categoria_id,
  categoria: curso.categoria,
  secao: curso.secao,
  destaque: curso.destaque === 1,
  tipoAcesso: curso.tipo_acesso,
  gratuito: curso.tipo_acesso === 'gratuito',
  precoCentavos: curso.preco_centavos,
  pixHabilitado: curso.pix_habilitado === 1,
  pixDescontoPercentual: Number(curso.pix_desconto_percentual),
  cartaoHabilitado: curso.cartao_habilitado === 1,
  cartaoMaxParcelas: curso.cartao_max_parcelas,
  cartaoParcelasSemJuros: curso.cartao_parcelas_sem_juros,
  prazoAcessoMeses: curso.prazo_acesso_meses,
  sequencial: curso.progressao_sequencial === 1,
  status: curso.status || STATUS_PADRAO,
  totalAulas: curso.total_aulas ?? 0,
  duracaoMinutos: curso.duracao_minutos ?? 0,
  atualizadoEm: curso.atualizado_em,
});

async function buscarCurso(id) {
  const [cursos] = await database.execute(
    `SELECT ${COLUNAS} FROM cursos c LEFT JOIN categorias k ON k.id = c.categoria_id WHERE c.id = ? LIMIT 1`,
    [id],
  );
  if (!cursos[0]) throw new ErroRequisicao(404, 'Curso não encontrado.');
  return cursos[0];
}

function imagem(valor, campo) {
  const url = texto(valor, campo, { max: 500 });
  if (url !== null && !URL_DE_IMAGEM.test(url) && !/^https?:\/\/\S+$/i.test(url)) {
    throw new ErroRequisicao(400, `A ${campo} informada é inválida.`);
  }
  return url;
}

// Rascunhos podem ficar incompletos: só o título é obrigatório para salvar.
async function camposDoCurso(corpo) {
  const campos = {
    titulo: texto(corpo.titulo, 'o título do curso', { max: 200, obrigatorio: true }),
    subtitulo: texto(corpo.subtitulo, 'subtítulo', { max: 255 }),
    descricao: texto(corpo.descricao, 'descrição', { max: 10000 }),
    instrutora: texto(corpo.instrutora, 'instrutora', { max: 150 }),
    imagem_capa: imagem(corpo.imagemCapa, 'imagem de capa'),
    imagem_banner: imagem(corpo.imagemBanner, 'imagem de banner'),
    categoria_id: corpo.categoriaId ?? null,
    secao: corpo.secao ?? null,
    ...camposComerciais(corpo),
    destaque: booleano(corpo.destaque ?? false, 'destaque'),
    progressao_sequencial: booleano(corpo.sequencial ?? true, 'progressão sequencial'),
  };

  if (campos.secao !== null && !SECOES.includes(campos.secao)) {
    throw new ErroRequisicao(400, 'Seção da Home inválida.');
  }
  if (campos.categoria_id !== null) {
    if (!Number.isInteger(campos.categoria_id)) throw new ErroRequisicao(400, 'Categoria inválida.');
    const [categorias] = await database.execute('SELECT 1 FROM categorias WHERE id = ? LIMIT 1', [campos.categoria_id]);
    if (categorias.length === 0) throw new ErroRequisicao(400, 'A categoria selecionada não existe mais.');
  }
  return campos;
}

/**
 * O que falta para o curso poder estar publicado: os dados que o aluno vê (descrição, categoria
 * e ao menos uma aula) e, em curso pago, preço válido e forma de pagamento.
 */
function pendenciasDePublicacao(curso) {
  const pendencias = [];
  if (!curso.descricao) pendencias.push({ campo: 'descricao', mensagem: 'Escreva a descrição do curso.' });
  if (curso.categoria_id === null) pendencias.push({ campo: 'categoria', mensagem: 'Selecione uma categoria.' });
  if (!curso.total_aulas) pendencias.push({ campo: 'aulas', mensagem: 'Adicione ao menos uma aula.' });
  return [...pendencias, ...pendenciasComerciais(curso)];
}

// 422 com a lista do que falta (`pendencias`) e os campos correspondentes (`campos`).
function recusarSeIncompleto(curso, mensagem) {
  const pendencias = pendenciasDePublicacao(curso);
  if (pendencias.length > 0) {
    throw new ErroRequisicao(422, mensagem, {
      pendencias: pendencias.map((pendencia) => pendencia.mensagem),
      campos: pendencias.map((pendencia) => pendencia.campo),
    });
  }
}

const alunosComProgresso = async (cursoId) => {
  const [[{ total }]] = await database.execute(
    `SELECT COUNT(DISTINCT p.usuario_id) AS total FROM progresso_aulas p
     JOIN aulas a ON a.id = p.aula_id JOIN modulos m ON m.id = a.modulo_id
     JOIN usuarios u ON u.id = p.usuario_id
     WHERE m.curso_id = ? AND u.tipo = 'aluno'`,
    [cursoId],
  );
  return Number(total);
};

const indicadoresCursos = rota(async (req, res) => {
  const [[linha]] = await database.execute(
    `SELECT
       COUNT(*) AS total,
       COALESCE(SUM(status = 'publicado'), 0) AS publicados,
       COALESCE(SUM(status = 'rascunho' OR status IS NULL), 0) AS rascunhos,
       COALESCE(SUM(status = 'arquivado'), 0) AS arquivados,
       COALESCE(SUM(destaque = 1), 0) AS destaques
     FROM cursos`,
  );
  res.json({
    indicadores: {
      total: Number(linha.total),
      publicados: Number(linha.publicados),
      rascunhos: Number(linha.rascunhos),
      arquivados: Number(linha.arquivados),
      destaques: Number(linha.destaques),
    },
  });
});

const listarCursos = rota(async (req, res) => {
  const [cursos] = await database.execute(
    `SELECT ${COLUNAS} FROM cursos c LEFT JOIN categorias k ON k.id = c.categoria_id
     ORDER BY c.criado_em DESC, c.id DESC`,
  );
  res.json({ cursos: cursos.map(paraResposta) });
});

// Curso completo para edição: dados, módulos e aulas (com arquivo e link de cada aula).
const obterCurso = rota(async (req, res) => {
  const id = idDaRota(req.params.id);
  const curso = await buscarCurso(id);
  const modulos = await conteudoDoCurso(id);
  const videos = await videosDoCurso(id);
  res.json({
    curso: paraResposta(curso),
    modulos: modulos.map((modulo) => ({
      id: modulo.id,
      titulo: modulo.titulo,
      descricao: modulo.descricao,
      aulas: modulo.aulas.map((aula) => ({
        id: aula.id,
        titulo: aula.titulo,
        descricao: aula.descricao,
        imagemCapa: aula.imagem_capa,
        tipo: aula.tipo,
        arquivo: aula.arquivo,
        linkExterno: aula.link_externo,
        duracaoSegundos: aula.duracao_segundos,
        demonstrativa: aula.demonstrativa === 1,
        // Aulas de vídeo: os vídeos na ordem de reprodução (as demais ficam com a lista vazia).
        videos: (videos.get(aula.id) ?? []).map((video) => ({
          id: video.id,
          titulo: video.titulo,
          arquivo: video.arquivo,
          duracaoSegundos: video.duracao_segundos,
        })),
      })),
    })),
  });
});

const criarCurso = rota(async (req, res) => {
  const campos = await camposDoCurso(req.body || {});
  const selecao = validarSelecaoDeAcessos(req.body?.acessos, campos.tipo_acesso);
  if (selecao?.revogar.length) throw new ErroRequisicao(400, 'Um curso novo não possui autorizações para revogar.');
  const colunas = Object.keys(campos);
  const id = await emTransacao(async (conexao) => {
    const [resultado] = await conexao.execute(
      `INSERT INTO cursos (${colunas.join(', ')}, status) VALUES (${colunas.map(() => '?').join(', ')}, 'rascunho')`,
      colunas.map((coluna) => campos[coluna]),
    );
    await aplicarSelecaoDeAcessos(conexao, resultado.insertId, selecao, req.usuario.id);
    return resultado.insertId;
  });
  res.status(201).json({ curso: paraResposta(await buscarCurso(id)) });
});

const atualizarCurso = rota(async (req, res) => {
  const id = idDaRota(req.params.id);
  const anterior = await buscarCurso(id);
  const campos = await camposDoCurso(req.body || {});
  const selecao = validarSelecaoDeAcessos(req.body?.acessos, campos.tipo_acesso);
  // Um curso publicado não pode ser salvo incompleto: senão um curso pago ficaria à vista dos
  // alunos sem preço. Para editar com calma, despublique-o (rascunhos aceitam dados incompletos).
  if (anterior.status === 'publicado') {
    recusarSeIncompleto(
      { ...anterior, ...campos },
      'Não é possível salvar: este curso está publicado. Corrija os itens abaixo ou despublique o curso.',
    );
  }
  const colunas = Object.keys(campos);
  await emTransacao(async (conexao) => {
    await conexao.execute(`UPDATE cursos SET ${colunas.map((coluna) => `${coluna} = ?`).join(', ')} WHERE id = ?`, [
      ...colunas.map((coluna) => campos[coluna]), id,
    ]);
    await aplicarSelecaoDeAcessos(conexao, id, selecao, req.usuario.id);
  });
  await removerImagensSemUso([anterior.imagem_capa, anterior.imagem_banner]);
  res.json({ curso: paraResposta(await buscarCurso(id)) });
});

// Publicar exige os dados que o aluno vê: título, descrição, categoria e ao menos uma aula.
// Um curso pago precisa também de preço e de uma forma de pagamento habilitada.
const alterarStatus = rota(async (req, res) => {
  const id = idDaRota(req.params.id);
  const status = req.body?.status;
  if (!STATUS.includes(status)) throw new ErroRequisicao(400, 'Status inválido.');
  const curso = await buscarCurso(id);

  if (status === 'publicado') recusarSeIncompleto(curso, 'Não é possível publicar este curso.');

  await database.execute('UPDATE cursos SET status = ? WHERE id = ?', [status, id]);
  res.json({ curso: paraResposta({ ...curso, status }) });
});

// Um curso que alunos já iniciaram, compraram ou receberam não é apagado: o progresso e o
// histórico de compras e acessos seriam perdidos.
const excluirCurso = rota(async (req, res) => {
  const id = idDaRota(req.params.id);
  const curso = await buscarCurso(id);
  const alunos = await alunosComProgresso(id);
  if (alunos > 0) {
    throw new ErroRequisicao(
      409,
      'Este curso já foi iniciado por alunos e não pode ser excluído. Arquive-o para retirá-lo do aplicativo sem perder o progresso deles.',
      { alunos },
    );
  }

  const [[{ registros }]] = await database.execute(
    `SELECT (SELECT COUNT(*) FROM pedidos WHERE curso_id = ?) + (SELECT COUNT(*) FROM matriculas WHERE curso_id = ?)
       AS registros`,
    [id, id],
  );
  if (Number(registros) > 0) {
    throw new ErroRequisicao(
      409,
      'Este curso tem compras ou acessos registrados e não pode ser excluído. Arquive-o para retirá-lo do aplicativo sem perder esse histórico.',
    );
  }

  const arquivos = await arquivosDasAulas('a.modulo_id IN (SELECT id FROM modulos WHERE curso_id = ?)', id);
  await database.execute('DELETE FROM cursos WHERE id = ?', [id]);
  await removerMidiasSemUso(arquivos);
  await removerImagensSemUso([curso.imagem_capa, curso.imagem_banner]);
  res.json({ message: 'Curso excluído.' });
});

module.exports = {
  indicadoresCursos,
  listarCursos,
  obterCurso,
  criarCurso,
  atualizarCurso,
  alterarStatus,
  excluirCurso,
};
