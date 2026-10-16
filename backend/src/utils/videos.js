const database = require('../config/database');
const { duracaoDaMidia } = require('../config/storage');
const { prepararVideo } = require('./prepararVideo');

// Uma aula do tipo "video" tem um ou mais vídeos, reproduzidos na ordem cadastrada. Os arquivos
// ficam em aula_videos; aulas.arquivo continua valendo só para as aulas de áudio.

const COLUNAS = 'v.id, v.aula_id, v.titulo, v.arquivo, v.duracao_segundos, v.ordem';

async function videosDaAula(aulaId, conexao = database) {
  const [videos] = await conexao.execute(
    `SELECT ${COLUNAS} FROM aula_videos v WHERE v.aula_id = ? ORDER BY v.ordem, v.id`,
    [aulaId],
  );
  return videos;
}

// Vídeos de todas as aulas de um curso, agrupados pelo id da aula.
async function videosDoCurso(cursoId) {
  const [videos] = await database.execute(
    `SELECT ${COLUNAS} FROM aula_videos v
     JOIN aulas a ON a.id = v.aula_id JOIN modulos m ON m.id = a.modulo_id
     WHERE m.curso_id = ? ORDER BY v.aula_id, v.ordem, v.id`,
    [cursoId],
  );
  const porAula = new Map();
  for (const video of videos) {
    if (!porAula.has(video.aula_id)) porAula.set(video.aula_id, []);
    porAula.get(video.aula_id).push(video);
  }
  return porAula;
}

/**
 * Duração de uma aula de vídeo: a soma das durações dos seus vídeos. Se a duração de algum
 * deles ainda não é conhecida, a da aula também não é (null): uma soma parcial seria um valor
 * errado.
 */
function duracaoTotal(videos) {
  if (videos.length === 0 || videos.some((video) => !Number.isFinite(video.duracao_segundos) || video.duracao_segundos <= 0)) return null;
  return videos.reduce((soma, video) => soma + video.duracao_segundos, 0);
}

// Revalida durações antigas a partir do arquivo, sem inferir tempo a partir do progresso.
async function atualizarMetadadosDoCurso(cursoId, modulos) {
  const porAula = await videosDoCurso(cursoId);
  await Promise.all([...porAula.values()].flat().map(async (video) => {
    const duration = await duracaoDaMidia(video.arquivo);
    if (duration !== null && duration !== video.duracao_segundos) {
      video.duracao_segundos = duration;
      await database.execute('UPDATE aula_videos SET duracao_segundos = ? WHERE id = ? AND arquivo = ?', [duration, video.id, video.arquivo]);
    }
    void prepararVideo(video.arquivo);
  }));
  for (const aula of modulos.flatMap((modulo) => modulo.aulas)) {
    if (aula.tipo !== 'video') continue;
    const videos = porAula.get(aula.id) ?? [];
    const total = duracaoTotal(videos);
    if (total !== aula.duracao_segundos) {
      await database.execute('UPDATE aulas SET duracao_segundos = ? WHERE id = ?', [total, aula.id]);
      aula.duracao_segundos = total;
    }
  }
  return porAula;
}

// Arquivos de mídia de um conjunto de aulas (áudios e vídeos), para limpeza após uma exclusão.
async function arquivosDasAulas(condicao, parametro) {
  const [linhas] = await database.execute(
    `SELECT a.arquivo FROM aulas a WHERE ${condicao} AND a.arquivo IS NOT NULL
     UNION ALL
     SELECT v.arquivo FROM aula_videos v JOIN aulas a ON a.id = v.aula_id WHERE ${condicao}`,
    [parametro, parametro],
  );
  return linhas.map((linha) => linha.arquivo);
}

/**
 * Converte as aulas de vídeo do formato antigo (um arquivo em aulas.arquivo) para o novo: cada
 * uma ganha um registro em aula_videos com o mesmo arquivo e a mesma duração, e o progresso já
 * salvo pelos alunos (ponto de reprodução e conclusão) passa a valer para esse vídeo. Pode ser
 * executada mais de uma vez: só trata aulas que ainda estão no formato antigo.
 */
async function migrarVideosLegados() {
  const legadas = "a.tipo = 'video' AND a.arquivo IS NOT NULL";
  await database.query(
    `INSERT INTO aula_videos (aula_id, arquivo, duracao_segundos, ordem)
     SELECT a.id, a.arquivo, a.duracao_segundos, 1 FROM aulas a
     WHERE ${legadas} AND NOT EXISTS (SELECT 1 FROM aula_videos v WHERE v.aula_id = a.id)`,
  );
  await database.query(
    `INSERT IGNORE INTO progresso_videos (usuario_id, video_id, posicao_segundos, concluido, concluido_em)
     SELECT p.usuario_id, v.id, p.posicao_segundos, p.concluida, p.concluida_em
     FROM progresso_aulas p JOIN aulas a ON a.id = p.aula_id
     JOIN aula_videos v ON v.aula_id = a.id AND v.arquivo = a.arquivo
     WHERE ${legadas}`,
  );
  await database.query(
    `UPDATE progresso_aulas p JOIN aulas a ON a.id = p.aula_id
     JOIN aula_videos v ON v.aula_id = a.id AND v.arquivo = a.arquivo
     SET p.ultimo_video_id = v.id
     WHERE ${legadas} AND p.ultimo_video_id IS NULL`,
  );
  const [resultado] = await database.query(
    `UPDATE aulas a SET a.arquivo = NULL
     WHERE ${legadas} AND EXISTS (SELECT 1 FROM aula_videos v WHERE v.aula_id = a.id AND v.arquivo = a.arquivo)`,
  );
  return resultado.affectedRows;
}

module.exports = { videosDaAula, videosDoCurso, duracaoTotal, arquivosDasAulas, migrarVideosLegados, atualizarMetadadosDoCurso };
