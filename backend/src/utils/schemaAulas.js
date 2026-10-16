const database = require('../config/database');

async function garantirCapaDasAulas(conexao = database) {
  const [colunas] = await conexao.execute(
    "SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'aulas' AND COLUMN_NAME = 'imagem_capa'",
  );
  if (colunas.length > 0) return false;
  await conexao.query('ALTER TABLE aulas ADD COLUMN imagem_capa VARCHAR(255) NULL AFTER descricao');
  return true;
}

module.exports = { garantirCapaDasAulas };
