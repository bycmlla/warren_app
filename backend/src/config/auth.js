const jwt = require('jsonwebtoken');

const CUSTO_BCRYPT = 12;
const ALGORITMO = 'HS256';

function segredo() {
  const valor = process.env.JWT_SECRET;
  if (!valor || valor.length < 32) {
    throw Object.assign(new Error('JWT_SECRET ausente ou com menos de 32 caracteres.'), {
      code: 'JWT_SECRET_INVALIDO',
    });
  }
  return valor;
}

function gerarToken(usuarioId) {
  return jwt.sign({}, segredo(), {
    subject: String(usuarioId),
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    algorithm: ALGORITMO,
  });
}

function validarToken(token) {
  const { sub, aud } = jwt.verify(token, segredo(), { algorithms: [ALGORITMO] });
  if (aud !== undefined) throw new Error('Este token não é uma sessão.');
  return Number(sub);
}

// O navegador não envia Authorization em <video>. Esta credencial só abre um caminho de mídia.
function gerarTokenDeMidia(usuarioId, caminho) {
  return jwt.sign({ caminho }, segredo(), {
    subject: String(usuarioId), audience: 'joanalia.midia', expiresIn: '2h', algorithm: ALGORITMO,
  });
}

function validarTokenDeMidia(token, caminho) {
  const dados = jwt.verify(token, segredo(), { algorithms: [ALGORITMO], audience: 'joanalia.midia' });
  if (dados.caminho !== caminho) throw new Error('Mídia diferente da autorizada.');
  return Number(dados.sub);
}

module.exports = { CUSTO_BCRYPT, gerarToken, validarToken, gerarTokenDeMidia, validarTokenDeMidia };
