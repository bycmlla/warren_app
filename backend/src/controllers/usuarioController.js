const bcrypt = require('bcrypt');
const database = require('../config/database');
const { CUSTO_BCRYPT, gerarToken } = require('../config/auth');
const usuarioPublico = require('../utils/usuarioPublico');

async function criarUsuario(req, res) {
  const { nome, email, senha, telefone } = req.body || {};
  const camposInvalidos = [];

  if (typeof nome !== 'string' || !nome.trim()) camposInvalidos.push('nome');
  if (typeof email !== 'string' || !email.trim()) camposInvalidos.push('email');
  if (typeof senha !== 'string' || !senha.trim()) camposInvalidos.push('senha');

  if (camposInvalidos.length > 0) {
    return res.status(400).json({
      message: 'Nome, e-mail e senha são obrigatórios e devem ser textos não vazios.',
      campos: camposInvalidos,
    });
  }

  const usuario = { nome: nome.trim(), email: email.trim(), telefone: null };

  if (usuario.nome.length > 150 || usuario.email.length > 150) {
    return res.status(400).json({ message: 'Nome e e-mail devem ter até 150 caracteres.' });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(usuario.email)) {
    return res.status(400).json({ message: 'Informe um e-mail válido.' });
  }

  if ([...senha].length < 8) {
    return res.status(400).json({ message: 'Senha deve ter pelo menos 8 caracteres.' });
  }

  // bcrypt aceita até 72 bytes; rejeite valores maiores para evitar truncamento.
  if (Buffer.byteLength(senha, 'utf8') > 72) {
    return res.status(400).json({ message: 'Senha é longa demais. Use uma senha mais curta.' });
  }

  if (telefone !== undefined && telefone !== null) {
    if (typeof telefone !== 'string') {
      return res.status(400).json({ message: 'Telefone deve ser informado como texto.' });
    }

    const telefoneNormalizado = telefone.trim();
    if (telefoneNormalizado) {
      const digitos = telefoneNormalizado.replace(/\D/g, '');
      if (telefoneNormalizado.length > 30 || !/^[+\d()\s-]+$/.test(telefoneNormalizado) || digitos.length < 10 || digitos.length > 15) {
        return res.status(400).json({ message: 'Informe um telefone válido com 10 a 15 dígitos e até 30 caracteres.' });
      }
      usuario.telefone = telefoneNormalizado;
    }
  }

  try {
    // O cadastro público sempre cria alunos; o tipo nunca vem do corpo da requisição.
    const senhaHash = await bcrypt.hash(senha, CUSTO_BCRYPT);
    const [resultado] = await database.execute(
      "INSERT INTO usuarios (nome, email, senha, telefone, tipo) VALUES (?, ?, ?, ?, 'aluno')",
      [usuario.nome, usuario.email, senhaHash, usuario.telefone],
    );

    return res.status(201).json(usuarioPublico({ id: resultado.insertId, ...usuario, tipo: 'aluno' }));
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'E-mail já cadastrado.' });
    }

    console.error('Erro ao cadastrar usuário:', error.code || error.name);
    return res.status(500).json({ message: 'Não foi possível cadastrar o usuário.' });
  }
}

async function loginUsuario(req, res) {
  const { email, senha } = req.body || {};
  const camposInvalidos = [];

  if (typeof email !== 'string' || !email.trim()) camposInvalidos.push('email');
  if (typeof senha !== 'string' || !senha.trim()) camposInvalidos.push('senha');

  if (camposInvalidos.length > 0) {
    return res.status(400).json({
      message: 'E-mail e senha são obrigatórios e devem ser textos não vazios.',
      campos: camposInvalidos,
    });
  }

  const emailNormalizado = email.trim();
  if (emailNormalizado.length > 150 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNormalizado)) {
    return res.status(400).json({ message: 'Informe um e-mail válido com até 150 caracteres.' });
  }

  if (Buffer.byteLength(senha, 'utf8') > 72) {
    return res.status(400).json({ message: 'Senha é longa demais. Use uma senha mais curta.' });
  }

  try {
    const [usuarios] = await database.execute(
      'SELECT id, nome, email, telefone, foto_perfil, senha, tipo, status FROM usuarios WHERE email = ? LIMIT 1',
      [emailNormalizado],
    );
    const usuario = usuarios[0];

    if (!usuario) {
      return res.status(404).json({ message: 'E-mail não cadastrado.' });
    }

    if (typeof usuario.senha !== 'string' || !(await bcrypt.compare(senha, usuario.senha))) {
      return res.status(401).json({ message: 'Senha incorreta.' });
    }

    if (usuario.status !== 'ativo') {
      return res.status(403).json({ message: 'Usuário inativo ou bloqueado.' });
    }

    return res.status(200).json({
      message: 'Login realizado com sucesso.',
      token: gerarToken(usuario.id),
      usuario: usuarioPublico(usuario),
    });
  } catch (error) {
    console.error('Erro ao realizar login:', error.code || error.name);
    return res.status(500).json({ message: 'Não foi possível realizar o login.' });
  }
}

function usuarioAutenticado(req, res) {
  return res.status(200).json({ usuario: req.usuario });
}

module.exports = { criarUsuario, loginUsuario, usuarioAutenticado };
