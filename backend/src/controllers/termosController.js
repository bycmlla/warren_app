const database = require('../config/database');
const { ErroRequisicao, rota } = require('../utils/http');
const { documentoVigente, situacaoDosTermos } = require('../utils/termos');

const documentoPublico = (documento) => ({
  id: documento.id,
  versao: documento.versao,
  vigenteDesde: documento.vigente_desde,
  texto: documento.texto,
  hash: documento.hash,
});

const aceitePublico = (aceite) => ({ versao: aceite.versao, aceitoEm: aceite.aceito_em });

/**
 * Termos de Uso em vigor (texto integral, versão e data). Com sessão, informa também o aceite
 * válido do usuário. `termos` é null enquanto nenhuma versão tiver sido publicada.
 */
const obterTermos = rota(async (req, res) => {
  const privacidade = await documentoVigente('privacidade');
  const { vigente, aceite } = req.usuario
    ? await situacaoDosTermos(req.usuario.id)
    : { vigente: await documentoVigente('termos'), aceite: null };
  res.json({
    termos: vigente ? documentoPublico(vigente) : null,
    aceite: aceite ? aceitePublico(aceite) : null,
    privacidadePublicada: privacidade !== null,
  });
});

const obterPrivacidade = rota(async (req, res) => {
  const documento = await documentoVigente('privacidade');
  res.json({ documento: documento ? documentoPublico(documento) : null });
});

/**
 * Registra o aceite da versão em vigor. O aplicativo devolve o id e o hash do documento que
 * exibiu: se os termos mudaram enquanto a tela estava aberta, o aceite é recusado e o usuário
 * precisa ler a versão nova. Aceitar de novo a mesma versão mantém o registro original.
 */
const aceitarTermos = rota(async (req, res) => {
  const { documentoId, hash, aceito } = req.body || {};
  if (aceito !== true) throw new ErroRequisicao(400, 'Marque que você leu e concorda com os Termos de Uso.');

  const vigente = await documentoVigente('termos');
  if (!vigente) throw new ErroRequisicao(409, 'Os Termos de Uso ainda não foram publicados.', { codigo: 'TERMOS_INDISPONIVEIS' });
  if (documentoId !== vigente.id || hash !== vigente.hash) {
    throw new ErroRequisicao(409, 'Os Termos de Uso foram atualizados. Leia a nova versão para continuar.', {
      codigo: 'TERMOS_ATUALIZADOS',
    });
  }

  await database.execute(
    'INSERT IGNORE INTO aceites_termos (usuario_id, documento_id, versao, hash) VALUES (?, ?, ?, ?)',
    [req.usuario.id, vigente.id, vigente.versao, vigente.hash],
  );
  const [aceites] = await database.execute(
    'SELECT versao, aceito_em FROM aceites_termos WHERE usuario_id = ? AND documento_id = ? LIMIT 1',
    [req.usuario.id, vigente.id],
  );
  res.status(201).json({ aceite: aceitePublico(aceites[0]) });
});

module.exports = { obterTermos, obterPrivacidade, aceitarTermos };
