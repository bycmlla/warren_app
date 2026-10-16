const database = require('../config/database');
const { validarToken, validarTokenDeMidia } = require('../config/auth');
const usuarioPublico = require('../utils/usuarioPublico');

const SESSAO_INVALIDA = { message: 'Sessão inválida ou expirada. Entre novamente.' };

async function autenticar(req, res, next) {
  const [esquema, token] = (req.get('authorization') || '').split(' ');
  if (esquema !== 'Bearer' || !token) {
    return res.status(401).json({ message: 'Autenticação necessária.' });
  }
       
  let usuarioId;
  try {
    usuarioId = validarToken(token);
  } catch (error) {
    if (error.code === 'JWT_SECRET_INVALIDO') {
      console.error('Erro ao validar sessão:', error.code);
      return res.status(500).json({ message: 'Não foi possível validar a sessão.' });
    }
    return res.status(401).json(SESSAO_INVALIDA);
  }

  return carregarUsuario(usuarioId, req, res, next);
}

async function carregarUsuario(usuarioId, req, res, next) {
  try {
    const [usuarios] = await database.execute(
      'SELECT id, nome, email, telefone, foto_perfil, tipo, status FROM usuarios WHERE id = ? LIMIT 1',
      [usuarioId],
    );
    const usuario = usuarios[0];

    if (!usuario) {
      return res.status(401).json(SESSAO_INVALIDA);
    }

    if (usuario.status !== 'ativo') {
      return res.status(403).json({ message: 'Usuário inativo ou bloqueado.' });
    }

    req.usuario = usuarioPublico(usuario);
    return next();
  } catch (error) {
    console.error('Erro ao validar sessão:', error.code || error.name);
    return res.status(500).json({ message: 'Não foi possível validar a sessão.' });
  }
}

// Restrito às rotas GET de mídia. Mantém a verificação da conta e do acesso ao curso por Range.
function autenticarMidia(req, res, next) {
  if (req.get('authorization')) return autenticar(req, res, next);
  if (!req.query.acesso) return res.status(401).json({ message: 'Autenticação necessária.' });
  let usuarioId;
  try {
    usuarioId = validarTokenDeMidia(req.query.acesso, req.originalUrl.split('?')[0]);
  } catch {
    return res.status(401).json(SESSAO_INVALIDA);
  }
  return carregarUsuario(usuarioId, req, res, next);
}

function autenticarMiniatura(req, res, next) {
  return req.get('authorization') || req.query.acesso ? autenticarMidia(req, res, next) : next();
}

// Para rotas públicas que mostram mais a quem tem sessão: sem cabeçalho, segue como visitante.
function autenticarOpcional(req, res, next) {
  return req.get('authorization') ? autenticar(req, res, next) : next();
}

function exigirAdmin(req, res, next) {
  if (req.usuario?.role !== 'ADMIN') {
    return res.status(403).json({ message: 'Acesso restrito à administração.' });
  }
  return next();
}

module.exports = { autenticar, autenticarMidia, autenticarMiniatura, autenticarOpcional, exigirAdmin };
