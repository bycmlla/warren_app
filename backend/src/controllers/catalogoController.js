const database = require('../config/database');
const { acessoPublico } = require('../utils/acessos');
const { COLUNAS_COMERCIAIS, condicoesComerciais } = require('../utils/comercial');
const { SECOES, conteudoDoCurso, estadosDasAulas, situacaoDeAcesso, aulasConcluidas } = require('../utils/cursos');
const { ErroRequisicao, rota, idDaRota } = require('../utils/http');
const { situacaoDosTermos } = require('../utils/termos');
const { slidesPublicos } = require('../utils/bannerHome');
const { atualizarMetadadosDoCurso } = require('../utils/videos');
const { bloqueioDaAula } = require('../utils/estadoDaAula');
const { gerarTokenDeMidia } = require('../config/auth');

const POR_PAGINA = 12;
const POR_SECAO = 12;

const COLUNAS = `c.id, c.titulo, c.subtitulo, c.imagem_capa, c.imagem_banner, c.categoria_id, k.nome AS categoria, c.secao,
  c.destaque, c.total_aulas, c.duracao_minutos, ${COLUNAS_COMERCIAIS}`;
const ORDEM = 'c.destaque DESC, c.atualizado_em DESC, c.id DESC';

const resumo = (curso) => ({
  id: curso.id,
  titulo: curso.titulo,
  subtitulo: curso.subtitulo,
  imagemCapa: curso.imagem_capa,
  imagemBanner: curso.imagem_banner,
  categoriaId: curso.categoria_id,
  categoria: curso.categoria,
  secao: curso.secao,
  destaque: curso.destaque === 1,
  tipoAcesso: curso.tipo_acesso,
  gratuito: curso.tipo_acesso === 'gratuito',
  // Preço e condições dos cursos pagos; null nos demais.
  comercial: condicoesComerciais(curso),
  totalAulas: curso.total_aulas ?? 0,
  duracaoMinutos: curso.duracao_minutos ?? 0,
});

const categoriaPublica = (categoria) => ({
  id: categoria.id,
  nome: categoria.nome,
  descricao: categoria.descricao,
  icone: categoria.icone,
});

// Só categorias com ao menos um curso publicado aparecem para o público.
async function categoriasComCursos(somenteHome) {
  const [categorias] = await database.execute(
    `SELECT k.id, k.nome, k.descricao, k.icone FROM categorias k
     WHERE ${somenteHome ? 'k.mostrar_home = 1 AND ' : ''}
       EXISTS (SELECT 1 FROM cursos c WHERE c.categoria_id = k.id AND c.status = 'publicado' AND c.tipo_acesso <> 'restrito')
     ORDER BY k.ordem, k.id`,
  );
  return categorias.map(categoriaPublica);
}

const listarCategorias = rota(async (req, res) => {
  res.json({ categorias: await categoriasComCursos(false) });
});

// Home: categorias marcadas para aparecer e os cursos publicados de cada seção.
const home = rota(async (req, res) => {
  const [cursos] = await database.execute(
    `SELECT ${COLUNAS} FROM cursos c LEFT JOIN categorias k ON k.id = c.categoria_id
     WHERE c.status = 'publicado' AND c.tipo_acesso <> 'restrito' AND c.secao IS NOT NULL
     ORDER BY ${ORDEM}`,
  );
  res.json({
    // Banners do carrossel, na ordem de exibição (nunca vazia: sem personalizados, vem o padrão).
    carrossel: await slidesPublicos(),
    categorias: await categoriasComCursos(true),
    secoes: SECOES.map((id) => ({
      id,
      cursos: cursos.filter((curso) => curso.secao === id).slice(0, POR_SECAO).map(resumo),
    })),
  });
});

// Catálogo completo de cursos publicados, com busca por título, filtros e paginação.
const listarCursos = rota(async (req, res) => {
  const condicoes = ["c.status = 'publicado'", "c.tipo_acesso <> 'restrito'"];
  const parametros = [];

  const busca = typeof req.query.busca === 'string' ? req.query.busca.trim().slice(0, 100) : '';
  if (busca) {
    condicoes.push("c.titulo LIKE ? ESCAPE '!'");
    parametros.push(`%${busca.replace(/[!%_]/g, '!$&')}%`);
  }
  if (req.query.categoriaId !== undefined) {
    const categoriaId = Number(req.query.categoriaId);
    if (!Number.isInteger(categoriaId) || categoriaId <= 0) throw new ErroRequisicao(400, 'Categoria inválida.');
    condicoes.push('c.categoria_id = ?');
    parametros.push(categoriaId);
  }
  if (req.query.secao !== undefined) {
    if (!SECOES.includes(req.query.secao)) throw new ErroRequisicao(400, 'Seção inválida.');
    condicoes.push('c.secao = ?');
    parametros.push(req.query.secao);
  }

  const pagina = Math.min(Math.max(Number.parseInt(req.query.pagina, 10) || 1, 1), 1000);
  const [cursos] = await database.execute(
    `SELECT ${COLUNAS} FROM cursos c LEFT JOIN categorias k ON k.id = c.categoria_id
     WHERE ${condicoes.join(' AND ')}
     ORDER BY ${ORDEM}
     LIMIT ${POR_PAGINA + 1} OFFSET ${(pagina - 1) * POR_PAGINA}`,
    parametros,
  );
  res.json({ cursos: cursos.slice(0, POR_PAGINA).map(resumo), pagina, temMais: cursos.length > POR_PAGINA });
});

/**
 * Detalhes de um curso publicado, com módulos, aulas e condições comerciais. A apresentação é
 * pública; com sessão, a resposta traz também a situação de acesso do usuário, se ele ainda
 * precisa aceitar os Termos de Uso, o estado de cada aula e o progresso.
 * O progresso é independente do acesso: quem perdeu o acesso continua vendo o que concluiu.
 * Endereços de mídia nunca são expostos aqui.
 */
const detalharCurso = rota(async (req, res) => {
  const id = idDaRota(req.params.id);
  const [cursos] = await database.execute(
    `SELECT ${COLUNAS}, c.descricao, c.instrutora, c.imagem_banner, c.progressao_sequencial, c.status
     FROM cursos c LEFT JOIN categorias k ON k.id = c.categoria_id WHERE c.id = ? LIMIT 1`,
    [id],
  );
  const curso = cursos[0];
  // Rascunhos e arquivados só existem para a administração.
  if (!curso || (curso.status !== 'publicado' && req.usuario?.role !== 'ADMIN')) {
    throw new ErroRequisicao(404, 'Curso não encontrado.');
  }

  const situacao = req.usuario ? await situacaoDeAcesso(req.usuario, curso) : null;
  // Um curso restrito só existe para quem tem autorização válida ou para ADMIN.
  // A recusa acontece antes de consultar módulos, aulas ou progresso.
  if (curso.tipo_acesso === 'restrito' && situacao?.estado !== 'liberado') {
    throw new ErroRequisicao(404, 'Curso não encontrado.');
  }
  const modulos = await conteudoDoCurso(id);
  const videosPorAula = await atualizarMetadadosDoCurso(id, modulos);
  const aulas = modulos.flatMap((modulo) => modulo.aulas);
  const liberado = situacao?.estado === 'liberado';
  const termos = req.usuario && req.usuario.role !== 'ADMIN' ? await situacaoDosTermos(req.usuario.id) : null;

  let estados = aulas.map(() => null);
  let progresso = null;
  const concluidas = req.usuario ? await aulasConcluidas(req.usuario.id, id) : new Set();
  if (liberado || concluidas.size > 0) {
    estados = liberado
      ? estadosDasAulas(aulas, concluidas, curso.progressao_sequencial === 1)
      : aulas.map((aula) => (concluidas.has(aula.id) ? 'concluida' : null));
    const feitas = estados.filter((estado) => estado === 'concluida').length;
    progresso = {
      concluidas: feitas,
      total: aulas.length,
      percentual: aulas.length === 0 ? 0 : Math.round((feitas / aulas.length) * 100),
      proximaAulaId: liberado ? (aulas[estados.indexOf('disponivel')]?.id ?? null) : null,
      concluido: aulas.length > 0 && feitas === aulas.length,
    };
  }

  const estadoDe = new Map(aulas.map((aula, indice) => [aula.id, estados[indice]]));
  res.json({
    curso: {
      ...resumo(curso),
      descricao: curso.descricao,
      instrutora: curso.instrutora,
      imagemBanner: curso.imagem_banner,
      sequencial: curso.progressao_sequencial === 1,
      duracaoSegundos: aulas.length > 0 && aulas.every((aula) => aula.duracao_segundos > 0)
        ? aulas.reduce((soma, aula) => soma + aula.duracao_segundos, 0) : null,
      totalAulas: aulas.length,
      totalModulos: modulos.length,
    },
    modulos: modulos.map((modulo) => ({
      id: modulo.id,
      titulo: modulo.titulo,
      descricao: modulo.descricao,
      aulas: modulo.aulas.map((aula) => {
        const videos = videosPorAula.get(aula.id) ?? [];
        const thumbnailPath = videos[0] ? `/api/aulas/${aula.id}/miniatura?v=${videos[0].arquivo}` : null;
        const thumbnail = aula.imagem_capa ?? (thumbnailPath && (curso.tipo_acesso === 'restrito'
          ? `${thumbnailPath}&acesso=${gerarTokenDeMidia(req.usuario.id, thumbnailPath.split('?')[0])}` : thumbnailPath));
        return {
        id: aula.id,
        titulo: aula.titulo,
        tipo: aula.tipo,
        duracaoSegundos: aula.duracao_segundos,
        demonstrativa: aula.demonstrativa === 1,
        estado: estadoDe.get(aula.id),
        bloqueio: bloqueioDaAula(aula, estadoDe.get(aula.id), curso, liberado, Boolean(req.usuario)),
        totalVideos: videos.length,
        thumbnail,
      }; }),
    })),
    acesso: acessoPublico(situacao ?? { estado: 'visitante', motivo: null, matricula: null, pedidoId: null }),
    // Aceite pendente: o aplicativo mostra os Termos de Uso antes de iniciar ou comprar.
    termosPendentes: termos !== null && termos.vigente !== null && termos.aceite === null,
    progresso,
  });
});

module.exports = { listarCategorias, home, listarCursos, detalharCurso };
