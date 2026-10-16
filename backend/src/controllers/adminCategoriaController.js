const database = require('../config/database');
const { ErroRequisicao, rota, idDaRota, texto, booleano, listaDeIds } = require('../utils/http');

const ICONE = /^[a-z-]{1,40}$/;

const paraResposta = (categoria) => ({
  id: categoria.id,
  nome: categoria.nome,
  descricao: categoria.descricao,
  icone: categoria.icone,
  mostrarHome: categoria.mostrar_home === 1,
  totalCursos: Number(categoria.total_cursos ?? 0),
  cursosPublicados: Number(categoria.cursos_publicados ?? 0),
});

// Lê do corpo apenas os campos enviados, já validados.
function camposEnviados(corpo, { exigirNome }) {
  const campos = {};
  if (exigirNome || corpo.nome !== undefined) {
    campos.nome = texto(corpo.nome, 'o nome da categoria', { max: 100, obrigatorio: true });
  }
  if (corpo.descricao !== undefined) campos.descricao = texto(corpo.descricao, 'descrição', { max: 500 });
  if (corpo.icone !== undefined) {
    campos.icone = texto(corpo.icone, 'ícone', { max: 40 });
    if (campos.icone !== null && !ICONE.test(campos.icone)) throw new ErroRequisicao(400, 'Ícone inválido.');
  }
  if (corpo.mostrarHome !== undefined) campos.mostrar_home = booleano(corpo.mostrarHome, 'Mostrar na Home');
  return campos;
}

const nomeDuplicado = (error) => {
  if (error.code === 'ER_DUP_ENTRY') throw new ErroRequisicao(409, 'Já existe uma categoria com esse nome.');
  throw error;
};

const listarCategorias = rota(async (req, res) => {
  const [categorias] = await database.execute(
    `SELECT k.id, k.nome, k.descricao, k.icone, k.mostrar_home,
            COUNT(c.id) AS total_cursos,
            COALESCE(SUM(c.status = 'publicado'), 0) AS cursos_publicados
     FROM categorias k LEFT JOIN cursos c ON c.categoria_id = k.id
     GROUP BY k.id
     ORDER BY k.ordem, k.id`,
  );
  res.json({ categorias: categorias.map(paraResposta) });
});

const criarCategoria = rota(async (req, res) => {
  const campos = camposEnviados(req.body || {}, { exigirNome: true });
  const [resultado] = await database
    .execute(
      `INSERT INTO categorias (nome, descricao, icone, mostrar_home, ordem)
       SELECT ?, ?, ?, ?, COALESCE(MAX(ordem), 0) + 1 FROM categorias`,
      [campos.nome, campos.descricao ?? null, campos.icone ?? null, campos.mostrar_home ?? 0],
    )
    .catch(nomeDuplicado);
  res.status(201).json({
    categoria: paraResposta({
      id: resultado.insertId,
      nome: campos.nome,
      descricao: campos.descricao ?? null,
      icone: campos.icone ?? null,
      mostrar_home: campos.mostrar_home ?? 0,
    }),
  });
});

const atualizarCategoria = rota(async (req, res) => {
  const id = idDaRota(req.params.id);
  const campos = camposEnviados(req.body || {}, { exigirNome: false });
  const colunas = Object.keys(campos);
  if (colunas.length === 0) throw new ErroRequisicao(400, 'Nenhuma alteração informada.');

  const [resultado] = await database
    .execute(`UPDATE categorias SET ${colunas.map((coluna) => `${coluna} = ?`).join(', ')} WHERE id = ?`, [
      ...colunas.map((coluna) => campos[coluna]),
      id,
    ])
    .catch(nomeDuplicado);
  if (resultado.affectedRows === 0) throw new ErroRequisicao(404, 'Categoria não encontrada.');
  res.json({ message: 'Categoria atualizada.' });
});

const reordenarCategorias = rota(async (req, res) => {
  const ids = listaDeIds(req.body?.ids);
  const [existentes] = await database.execute('SELECT id FROM categorias');
  const conhecidos = new Set(existentes.map((categoria) => categoria.id));
  if (ids.length !== conhecidos.size || !ids.every((id) => conhecidos.has(id))) {
    throw new ErroRequisicao(409, 'A lista de categorias mudou. Atualize a tela e tente novamente.');
  }
  await database.query(
    `UPDATE categorias SET ordem = CASE id ${ids.map(() => 'WHEN ? THEN ?').join(' ')} END WHERE id IN (?)`,
    [...ids.flatMap((id, indice) => [id, indice + 1]), ids],
  );
  res.json({ message: 'Ordem atualizada.' });
});

// Categorias com cursos só são excluídas com `?desvincular=true`: os cursos ficam sem categoria.
const excluirCategoria = rota(async (req, res) => {
  const id = idDaRota(req.params.id);
  const [[{ total }]] = await database.execute('SELECT COUNT(*) AS total FROM cursos WHERE categoria_id = ?', [id]);
  const cursos = Number(total);

  if (cursos > 0 && req.query.desvincular !== 'true') {
    throw new ErroRequisicao(
      409,
      cursos === 1
        ? 'Há 1 curso vinculado a esta categoria.'
        : `Há ${cursos} cursos vinculados a esta categoria.`,
      { cursos },
    );
  }
  if (cursos > 0) await database.execute('UPDATE cursos SET categoria_id = NULL WHERE categoria_id = ?', [id]);

  const [resultado] = await database.execute('DELETE FROM categorias WHERE id = ?', [id]);
  if (resultado.affectedRows === 0) throw new ErroRequisicao(404, 'Categoria não encontrada.');
  res.json({ message: 'Categoria excluída.', cursosDesvinculados: cursos });
});

module.exports = {
  listarCategorias,
  criarCategoria,
  atualizarCategoria,
  reordenarCategorias,
  excluirCategoria,
};
