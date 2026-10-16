const database = require('../config/database');
const { ErroRequisicao } = require('./http');

// A data de vigência sai como texto 'AAAA-MM-DD', sem depender do fuso do servidor.
const COLUNAS = "id, tipo, versao, DATE_FORMAT(vigente_desde, '%Y-%m-%d') AS vigente_desde, texto, hash, exige_novo_aceite";

// Versão em vigor de um documento ('termos' ou 'privacidade'): a mais recente já vigente.
async function documentoVigente(tipo) {
  const [documentos] = await database.execute(
    `SELECT ${COLUNAS} FROM documentos_legais
     WHERE tipo = ? AND vigente_desde <= CURDATE()
     ORDER BY vigente_desde DESC, id DESC LIMIT 1`,
    [tipo],
  );
  return documentos[0] ?? null;
}

/**
 * Situação do usuário diante dos Termos de Uso.
 * `vigente` é a versão exibida para aceite (null se nenhuma foi publicada).
 * `aceite` é o aceite que ainda vale: o da versão vigente ou o de uma versão anterior, desde que
 * nenhuma versão publicada depois dela exija nova aceitação.
 */
async function situacaoDosTermos(usuarioId) {
  const vigente = await documentoVigente('termos');
  if (!vigente) return { vigente: null, aceite: null };

  // Versão mais antiga cujo aceite ainda vale: a última que exigiu novo aceite.
  const [exigidas] = await database.execute(
    `SELECT id, vigente_desde FROM documentos_legais
     WHERE tipo = 'termos' AND vigente_desde <= CURDATE() AND exige_novo_aceite = 1
     ORDER BY vigente_desde DESC, id DESC LIMIT 1`,
  );
  const exigida = exigidas[0] ?? vigente;

  const [aceites] = await database.execute(
    `SELECT a.id, a.documento_id, a.versao, a.hash, a.aceito_em
     FROM aceites_termos a JOIN documentos_legais d ON d.id = a.documento_id
     WHERE a.usuario_id = ? AND d.tipo = 'termos' AND d.vigente_desde <= CURDATE()
       AND (d.vigente_desde > ? OR (d.vigente_desde = ? AND d.id >= ?))
     ORDER BY a.aceito_em DESC, a.id DESC LIMIT 1`,
    [usuarioId, exigida.vigente_desde, exigida.vigente_desde, exigida.id],
  );
  return { vigente, aceite: aceites[0] ?? null };
}

const TERMOS_PENDENTES = () =>
  new ErroRequisicao(428, 'Para continuar, é preciso aceitar os Termos de Uso.', { codigo: 'TERMOS_PENDENTES' });

// Conteúdo: com termos publicados, o aluno precisa de um aceite válido para reproduzir aulas.
async function exigirAceiteParaConteudo(usuario) {
  if (usuario.role === 'ADMIN') return;
  const { vigente, aceite } = await situacaoDosTermos(usuario.id);
  if (vigente && !aceite) throw TERMOS_PENDENTES();
}

// Compra: sem termos publicados não há o que aceitar, então nenhuma compra pode começar.
async function exigirAceiteParaCompra(usuario) {
  const { vigente, aceite } = await situacaoDosTermos(usuario.id);
  if (!vigente) {
    throw new ErroRequisicao(409, 'As compras estarão disponíveis quando os Termos de Uso forem publicados.', {
      codigo: 'TERMOS_INDISPONIVEIS',
    });
  }
  if (!aceite) throw TERMOS_PENDENTES();
  return aceite;
}

module.exports = { documentoVigente, situacaoDosTermos, exigirAceiteParaConteudo, exigirAceiteParaCompra };
