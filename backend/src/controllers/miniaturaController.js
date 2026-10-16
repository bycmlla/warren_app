const database = require('../config/database');
const { videosDaAula } = require('../utils/videos');
const { obterMiniatura } = require('../utils/prepararVideo');
const { situacaoDeAcesso } = require('../utils/cursos');
const { rota, idDaRota, ErroRequisicao } = require('../utils/http');

const obter = rota(async (req, res) => {
  const [aulas] = await database.execute(
    `SELECT a.id, c.id AS curso_id, c.status, c.tipo_acesso FROM aulas a
     JOIN modulos m ON m.id = a.modulo_id JOIN cursos c ON c.id = m.curso_id WHERE a.id = ?`, [idDaRota(req.params.id)],
  );
  const aula = aulas[0];
  if (!aula || (aula.status !== 'publicado' && req.usuario?.role !== 'ADMIN')) throw new ErroRequisicao(404, 'Miniatura não disponível.');
  const curso = { id: aula.curso_id, status: aula.status, tipo_acesso: aula.tipo_acesso };
  if (curso.tipo_acesso === 'restrito' && (!req.usuario || (await situacaoDeAcesso(req.usuario, curso)).estado !== 'liberado')) {
    throw new ErroRequisicao(404, 'Miniatura não disponível.');
  }
  const video = (await videosDaAula(aula.id))[0];
  if (!video) throw new ErroRequisicao(404, 'Miniatura não disponível.');
  const arquivo = await obterMiniatura(video.arquivo);
  if (!arquivo) throw new ErroRequisicao(404, 'Miniatura não disponível.');
  await new Promise((resolve, reject) => res.sendFile(arquivo, {
    headers: { 'Cache-Control': curso.tipo_acesso === 'restrito' ? 'private, no-cache' : 'public, max-age=86400' },
  }, (error) => error && !res.headersSent ? reject(error) : resolve()));
});

module.exports = { obter };
