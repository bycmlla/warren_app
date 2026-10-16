const database = require('../config/database');
const { TIPOS } = require('../config/storage');
const { receberArquivo } = require('./uploadController');
const { ErroRequisicao, rota } = require('../utils/http');
const { removerImagensSemUso } = require('../utils/cursos');
const usuarioPublico = require('../utils/usuarioPublico');

// A foto é sempre a do usuário da sessão (req.usuario): não existe rota que aceite o id de outro
// usuário, então ninguém altera a foto de terceiros. Só o endereço da imagem fica no banco; o
// arquivo fica no armazenamento, na pasta pública de imagens.

async function usuarioAtual(id) {
  const [usuarios] = await database.execute(
    'SELECT id, nome, email, telefone, foto_perfil, tipo, status FROM usuarios WHERE id = ? LIMIT 1',
    [id],
  );
  return usuarioPublico(usuarios[0]);
}

// Grava a nova foto e só depois descarta a anterior: se algo falhar no meio, a foto antiga continua.
function enviarFoto(req, res) {
  return receberArquivo(req, res, TIPOS.perfil, async (resposta, { nome, falhar }) => {
    try {
      const url = `/arquivos/imagens/${nome}`;
      const [[anterior]] = await database.execute('SELECT foto_perfil FROM usuarios WHERE id = ?', [req.usuario.id]);
      await database.execute('UPDATE usuarios SET foto_perfil = ? WHERE id = ?', [url, req.usuario.id]);
      await removerImagensSemUso([anterior?.foto_perfil]);
      return resposta.status(200).json({ usuario: await usuarioAtual(req.usuario.id) });
    } catch (error) {
      console.error('Erro ao salvar a foto de perfil:', error.code || error.name);
      falhar();
      return resposta.status(500).json({ message: 'Não foi possível salvar a foto. A anterior foi mantida.' });
    }
  });
}

const removerFoto = rota(async (req, res) => {
  const [[atual]] = await database.execute('SELECT foto_perfil FROM usuarios WHERE id = ?', [req.usuario.id]);
  if (!atual) throw new ErroRequisicao(404, 'Usuário não encontrado.');
  await database.execute('UPDATE usuarios SET foto_perfil = NULL WHERE id = ?', [req.usuario.id]);
  await removerImagensSemUso([atual.foto_perfil]);
  res.json({ usuario: await usuarioAtual(req.usuario.id) });
});

module.exports = { enviarFoto, removerFoto };
