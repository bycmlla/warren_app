const database = require('../config/database');
const { PRAZOS_DE_ACESSO } = require('./comercial');
const { ErroRequisicao } = require('./http');

// Com esta antecedência (em dias) o aluno passa a ver o aviso de que o acesso está perto de vencer.
const DIAS_DE_AVISO = 30;

// Expressões SQL compartilhadas: a validade é sempre decidida pelo relógio do banco.
const VALIDA = `(m.revogado_em IS NULL AND (m.inicio_em IS NULL OR m.inicio_em <= NOW())
  AND (m.expira_em IS NULL OR m.expira_em > NOW()))`;
const SITUACAO = `CASE
  WHEN m.revogado_em IS NOT NULL THEN 'revogado'
  WHEN m.expira_em IS NOT NULL AND m.expira_em <= NOW() THEN 'vencido'
  WHEN m.inicio_em IS NOT NULL AND m.inicio_em > NOW() THEN 'agendado'
  ELSE 'ativo' END`;
const DIAS_RESTANTES = 'IF(m.expira_em IS NULL, NULL, GREATEST(DATEDIFF(m.expira_em, NOW()), 0))';

/**
 * Situação de um usuário diante de um curso (que precisa trazer id, status e tipo_acesso):
 *
 *   liberado  pode reproduzir as aulas (ADMIN, curso gratuito ou direito de acesso válido)
 *   comprar   curso pago sem acesso válido e sem compra em andamento
 *   pendente  curso pago com um pedido aguardando confirmação do pagamento (`pedidoId`)
 *   restrito  só a administração libera (ou o curso não está publicado)
 *
 * `motivo` explica um acesso que já existiu e não vale mais: 'vencido', 'revogado' ou 'agendado'.
 * Fazer login não libera nada além dos cursos gratuitos.
 */
async function situacaoDeAcesso(usuario, curso) {
  const semMatricula = { motivo: null, matricula: null, pedidoId: null };
  if (usuario.role === 'ADMIN') return { estado: 'liberado', ...semMatricula };
  if (curso.status !== 'publicado') return { estado: 'restrito', ...semMatricula };
  if (curso.tipo_acesso === 'gratuito') return { estado: 'liberado', ...semMatricula };

  const [matriculas] = await database.execute(
    `SELECT m.origem, m.inicio_em, m.expira_em, ${VALIDA} AS valida, ${SITUACAO} AS situacao,
            ${DIAS_RESTANTES} AS dias_restantes
     FROM matriculas m WHERE m.usuario_id = ? AND m.curso_id = ? LIMIT 1`,
    [usuario.id, curso.id],
  );
  const matricula = matriculas[0] ?? null;
  if (matricula?.valida === 1) return { estado: 'liberado', motivo: null, matricula, pedidoId: null };

  const motivo = matricula ? matricula.situacao : null;
  if (curso.tipo_acesso !== 'pago') return { estado: 'restrito', motivo, matricula, pedidoId: null };

  const [pedidos] = await database.execute(
    `SELECT id FROM pedidos WHERE usuario_id = ? AND curso_id = ? AND status IN ('pendente', 'em_processamento')
     LIMIT 1`,
    [usuario.id, curso.id],
  );
  return pedidos[0]
    ? { estado: 'pendente', motivo, matricula, pedidoId: pedidos[0].id }
    : { estado: 'comprar', motivo, matricula, pedidoId: null };
}

// Como a situação aparece nas respostas da API.
function acessoPublico({ estado, motivo, matricula, pedidoId }) {
  const valida = estado === 'liberado' && matricula !== null;
  const dias = valida ? matricula.dias_restantes : null;
  return {
    estado,
    motivo,
    origem: matricula?.origem ?? null,
    inicioEm: matricula?.inicio_em ?? null,
    expiraEm: matricula?.expira_em ?? null,
    diasRestantes: dias,
    pertoDeVencer: dias !== null && dias <= DIAS_DE_AVISO,
    pedidoId,
  };
}

/**
 * Cria ou renova o direito de acesso de um aluno. `inicio` (Date ou 'AAAA-MM-DD HH:MM:SS') é
 * opcional: sem ele, vale o momento da gravação. O vencimento é o início mais `meses`
 * (null = sem vencimento). Deve ser chamada dentro de uma transação, com a conexão dela.
 */
async function concederAcesso(conexao, { usuarioId, cursoId, origem, pedidoId = null, adminId = null, inicio = null, meses }) {
  await conexao.execute(
    `INSERT INTO matriculas (usuario_id, curso_id, origem, pedido_id, concedido_por, inicio_em, expira_em)
     VALUES (?, ?, ?, ?, ?, COALESCE(?, NOW()), IF(? IS NULL, NULL, DATE_ADD(COALESCE(?, NOW()), INTERVAL ? MONTH)))
     ON DUPLICATE KEY UPDATE
       origem = VALUES(origem), pedido_id = VALUES(pedido_id), concedido_por = VALUES(concedido_por),
       inicio_em = VALUES(inicio_em), expira_em = VALUES(expira_em),
       revogado_em = NULL, revogado_por = NULL, motivo_revogacao = NULL`,
    [usuarioId, cursoId, origem, pedidoId, adminId, inicio, meses, inicio, meses ?? 0],
  );
  await conexao.execute(
    `INSERT INTO historico_acessos (usuario_id, curso_id, acao, admin_id, pedido_id, inicio_em, expira_em)
     SELECT usuario_id, curso_id, ?, ?, ?, inicio_em, expira_em FROM matriculas
     WHERE usuario_id = ? AND curso_id = ?`,
    [origem === 'compra' ? 'liberacao_compra' : 'liberacao_manual', adminId, pedidoId, usuarioId, cursoId],
  );
}

/**
 * Encerra um direito de acesso ainda não revogado. O progresso do aluno não é tocado.
 * Com `pedidoId`, só revoga o acesso criado por aquele pedido. Devolve se revogou algo.
 */
async function revogarAcesso(conexao, { usuarioId, cursoId, adminId = null, pedidoId = null, motivo }) {
  const [resultado] = await conexao.execute(
    `UPDATE matriculas SET revogado_em = NOW(), revogado_por = ?, motivo_revogacao = ?
     WHERE usuario_id = ? AND curso_id = ? AND revogado_em IS NULL AND (? IS NULL OR pedido_id = ?)`,
    [adminId, motivo, usuarioId, cursoId, pedidoId, pedidoId],
  );
  if (resultado.affectedRows === 0) return false;
  await conexao.execute(
    `INSERT INTO historico_acessos (usuario_id, curso_id, acao, admin_id, pedido_id, observacao)
     VALUES (?, ?, 'revogacao', ?, ?, ?)`,
    [usuarioId, cursoId, adminId, pedidoId, motivo],
  );
  return true;
}

function dataDeInicio(valor) {
  if (valor === undefined || valor === null || valor === '') return null;
  const partes = typeof valor === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor) : null;
  const data = partes && new Date(Date.UTC(Number(partes[1]), Number(partes[2]) - 1, Number(partes[3])));
  if (!data || data.getUTCDate() !== Number(partes[3]) || data.getUTCMonth() !== Number(partes[2]) - 1
      || data.getUTCFullYear() < 2000 || data.getUTCFullYear() > 2100) {
    throw new ErroRequisicao(400, 'Informe uma data de início válida no formato dia/mês/ano.');
  }
  return `${valor} 00:00:00`;
}

// Mesma concessão manual para a seleção pelo curso e para Gerenciar acessos.
async function liberarAcessoManual(conexao, { usuarioId, cursoId, prazoMeses, inicioEm }, adminId) {
  if (!Number.isInteger(usuarioId) || usuarioId <= 0 || !Number.isInteger(cursoId) || cursoId <= 0) {
    throw new ErroRequisicao(400, 'Selecione o aluno e o curso.');
  }
  if (prazoMeses !== undefined && !PRAZOS_DE_ACESSO.includes(prazoMeses)) {
    throw new ErroRequisicao(400, 'Prazo de acesso inválido.');
  }
  const inicio = dataDeInicio(inicioEm);
  const [alunos] = await conexao.execute("SELECT id FROM usuarios WHERE id = ? AND tipo = 'aluno' LIMIT 1", [usuarioId]);
  if (!alunos[0]) throw new ErroRequisicao(404, 'Aluno não encontrado.');
  const [cursos] = await conexao.execute('SELECT id, tipo_acesso, prazo_acesso_meses FROM cursos WHERE id = ? LIMIT 1 FOR UPDATE', [cursoId]);
  if (!cursos[0]) throw new ErroRequisicao(404, 'Curso não encontrado.');
  if (cursos[0].tipo_acesso === 'gratuito') {
    throw new ErroRequisicao(400, 'Este curso é gratuito: qualquer aluno com conta já pode iniciá-lo.');
  }
  // Repetir a seleção sem mudar as condições não renova o prazo nem duplica o histórico.
  const [atuais] = await conexao.execute(
    `SELECT ${VALIDA} AS valida FROM matriculas m WHERE m.usuario_id = ? AND m.curso_id = ? FOR UPDATE`,
    [usuarioId, cursoId],
  );
  if (atuais[0]?.valida === 1 && prazoMeses === undefined && inicio === null) return;
  const meses = prazoMeses === undefined ? cursos[0].prazo_acesso_meses : prazoMeses;
  if (inicio !== null && meses !== null) {
    const [[{ vencido }]] = await conexao.execute('SELECT DATE_ADD(?, INTERVAL ? MONTH) <= NOW() AS vencido', [inicio, meses]);
    if (vencido === 1) throw new ErroRequisicao(400, 'Com essa data de início, o acesso já estaria vencido.');
  }
  await concederAcesso(conexao, { usuarioId, cursoId, origem: 'manual', adminId, inicio, meses });
}

// Envia apenas as alterações, preservando alunos que não foram editados em outra tela.
function validarSelecaoDeAcessos(valor, tipoAcesso) {
  if (valor === undefined) return null;
  if (tipoAcesso !== 'restrito' || !valor || typeof valor !== 'object' || Array.isArray(valor)) {
    throw new ErroRequisicao(400, 'A seleção de alunos é exclusiva de cursos restritos.');
  }
  const { conceder = [], revogar = [] } = valor;
  if (!Array.isArray(conceder) || !Array.isArray(revogar) || conceder.length + revogar.length > 500) {
    throw new ErroRequisicao(400, 'Seleção de alunos inválida.');
  }
  const ids = [];
  for (const item of conceder) {
    if (!item || !Number.isInteger(item.usuarioId) || item.usuarioId <= 0
        || (item.prazoMeses !== undefined && !PRAZOS_DE_ACESSO.includes(item.prazoMeses))) {
      throw new ErroRequisicao(400, 'Aluno ou prazo de acesso inválido.');
    }
    dataDeInicio(item.inicioEm);
    ids.push(item.usuarioId);
  }
  ids.push(...revogar);
  if (!ids.every((id) => Number.isInteger(id) && id > 0) || new Set(ids).size !== ids.length) {
    throw new ErroRequisicao(400, 'Informe alunos válidos, sem repetição entre concessões e revogações.');
  }
  return { conceder, revogar };
}

async function aplicarSelecaoDeAcessos(conexao, cursoId, selecao, adminId) {
  if (!selecao) return;
  for (const item of selecao.conceder) await liberarAcessoManual(conexao, { ...item, cursoId }, adminId);
  for (const usuarioId of selecao.revogar) {
    await revogarAcesso(conexao, { usuarioId, cursoId, adminId, motivo: 'Revogado na seleção de alunos do curso.' });
  }
}

// Executa `operacao(conexao)` em uma transação: confirma se ela terminar, desfaz se lançar.
async function emTransacao(operacao) {
  const conexao = await database.getConnection();
  try {
    await conexao.beginTransaction();
    const resultado = await operacao(conexao);
    await conexao.commit();
    return resultado;
  } catch (error) {
    await conexao.rollback();
    throw error;
  } finally {
    conexao.release();
  }
}

module.exports = {
  DIAS_DE_AVISO,
  VALIDA,
  SITUACAO,
  DIAS_RESTANTES,
  situacaoDeAcesso,
  acessoPublico,
  concederAcesso,
  revogarAcesso,
  emTransacao,
  liberarAcessoManual,
  validarSelecaoDeAcessos,
  aplicarSelecaoDeAcessos,
};
