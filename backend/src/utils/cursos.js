const database = require('../config/database');
const { URL_DE_IMAGEM, removerArquivo } = require('../config/storage');
const { situacaoDeAcesso } = require('./acessos');
const { removerDerivados } = require('./prepararVideo');

const SECOES = ['para-voce', 'metodo', 'praticas', 'modulos'];
const STATUS = ['rascunho', 'publicado', 'arquivado'];
const URL_SPOTIFY = /^https:\/\/(open\.spotify\.com|spotify\.link)\/\S+$/i;

const linkSpotifyValido = (valor) =>
  typeof valor === 'string' && valor.length <= 500 && URL_SPOTIFY.test(valor);

// Módulos do curso com suas aulas, na ordem de exibição (que também é a ordem da sequência).
async function conteudoDoCurso(cursoId) {
  const [modulos] = await database.execute(
    'SELECT id, titulo, descricao FROM modulos WHERE curso_id = ? ORDER BY ordem, id',
    [cursoId],
  );
  const [aulas] = await database.execute(
    `SELECT a.id, a.modulo_id, a.titulo, a.descricao, a.tipo, a.arquivo, a.link_externo, a.duracao_segundos,
            a.demonstrativa, a.imagem_capa
     FROM aulas a JOIN modulos m ON m.id = a.modulo_id
     WHERE m.curso_id = ?
     ORDER BY m.ordem, m.id, a.ordem, a.id`,
    [cursoId],
  );
  return modulos.map((modulo) => ({
    ...modulo,
    aulas: aulas.filter((aula) => aula.modulo_id === modulo.id),
  }));
}

// Mantém cursos.total_aulas e cursos.duracao_minutos de acordo com as aulas cadastradas.
async function recalcularTotais(cursoId) {
  await database.execute(
    `UPDATE cursos SET
       total_aulas = (SELECT COUNT(*) FROM aulas a JOIN modulos m ON m.id = a.modulo_id WHERE m.curso_id = ?),
       duracao_minutos = (SELECT CEIL(COALESCE(SUM(a.duracao_segundos), 0) / 60)
                          FROM aulas a JOIN modulos m ON m.id = a.modulo_id WHERE m.curso_id = ?)
     WHERE id = ?`,
    [cursoId, cursoId, cursoId],
  );
}

/**
 * Estado de cada aula para um aluno, na ordem do curso.
 * Com progressão sequencial, uma aula só fica disponível quando todas as anteriores
 * (inclusive de módulos anteriores) estão concluídas. Aulas concluídas continuam acessíveis.
 */
function estadosDasAulas(aulas, concluidas, sequencial) {
  let anterioresConcluidas = true;
  return aulas.map((aula) => {
    const concluida = concluidas.has(aula.id);
    const estado = concluida ? 'concluida' : !sequencial || anterioresConcluidas ? 'disponivel' : 'bloqueada';
    if (!concluida) anterioresConcluidas = false;
    return estado;
  });
}

async function aulasConcluidas(usuarioId, cursoId) {
  const [linhas] = await database.execute(
    `SELECT p.aula_id FROM progresso_aulas p
     JOIN aulas a ON a.id = p.aula_id JOIN modulos m ON m.id = a.modulo_id
     WHERE p.usuario_id = ? AND m.curso_id = ? AND p.concluida = 1
       AND (a.tipo <> 'video' OR (EXISTS (SELECT 1 FROM aula_videos v WHERE v.aula_id = a.id)
         AND NOT EXISTS (SELECT 1 FROM aula_videos v
           LEFT JOIN progresso_videos pv ON pv.video_id = v.id AND pv.usuario_id = p.usuario_id
           WHERE v.aula_id = a.id AND COALESCE(pv.concluido, 0) = 0)))`,
    [usuarioId, cursoId],
  );
  return new Set(linhas.map((linha) => linha.aula_id));
}

// Remove do armazenamento mídias que nenhuma aula referencia mais.
async function removerMidiasSemUso(arquivos) {
  for (const arquivo of new Set(arquivos.filter(Boolean))) {
    const [usos] = await database.execute(
      '(SELECT 1 FROM aulas WHERE arquivo = ? LIMIT 1) UNION ALL (SELECT 1 FROM aula_videos WHERE arquivo = ? LIMIT 1)',
      [arquivo, arquivo],
    );
    if (usos.length === 0) {
      await removerDerivados(arquivo).catch(() => undefined);
      await removerArquivo('midias', arquivo).catch(() => undefined);
    }
  }
}

// Remove do armazenamento imagens enviadas que nenhum curso usa mais como capa ou banner.
async function removerImagensSemUso(imagens) {
  for (const imagem of new Set(imagens.filter(Boolean))) {
    const nome = URL_DE_IMAGEM.exec(imagem)?.[1];
    if (!nome) continue;
    const [usos] = await database.execute(
      '(SELECT 1 FROM cursos WHERE imagem_capa = ? OR imagem_banner = ? LIMIT 1) UNION ALL (SELECT 1 FROM aulas WHERE imagem_capa = ? LIMIT 1) UNION ALL (SELECT 1 FROM usuarios WHERE foto_perfil = ? LIMIT 1) UNION ALL (SELECT 1 FROM banners_home WHERE imagem = ? LIMIT 1)',
      [imagem, imagem, imagem, imagem, imagem],
    );
    if (usos.length === 0) await removerArquivo('imagens', nome).catch(() => undefined);
  }
}

module.exports = {
  SECOES,
  STATUS,
  linkSpotifyValido,
  conteudoDoCurso,
  recalcularTotais,
  estadosDasAulas,
  situacaoDeAcesso,
  aulasConcluidas,
  removerMidiasSemUso,
  removerImagensSemUso,
};
