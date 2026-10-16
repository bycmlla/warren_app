const database = require('../config/database');
const { provedorAtivo } = require('../pagamentos');
const { SITUACAO, DIAS_RESTANTES, liberarAcessoManual, revogarAcesso, emTransacao } = require('../utils/acessos');
const { COLUNAS_COMERCIAIS, STATUS_DE_PEDIDO, pendenciasComerciais } = require('../utils/comercial');
const { ErroRequisicao, rota, texto } = require('../utils/http');
const { documentoVigente } = require('../utils/termos');

const LIMITE = 100;
const SITUACOES_DE_ACESSO = ['ativo', 'vencido', 'revogado', 'agendado'];

// Trecho de busca por nome ou e-mail do aluno, ou título do curso.
function filtroDeBusca(valor, colunas, condicoes, parametros) {
  const busca = typeof valor === 'string' ? valor.trim().slice(0, 100) : '';
  if (!busca) return;
  condicoes.push(`(${colunas.map((coluna) => `${coluna} LIKE ? ESCAPE '!'`).join(' OR ')})`);
  for (let i = 0; i < colunas.length; i += 1) parametros.push(`%${busca.replace(/[!%_]/g, '!$&')}%`);
}

/**
 * Visão geral comercial: compras por situação, valor confirmado e direitos de acesso.
 * Só pedidos aprovados entram no valor recebido; liberações manuais nunca contam como pagamento.
 */
const resumoComercial = rota(async (req, res) => {
  const [[pedidos]] = await database.execute(
    `SELECT
       COALESCE(SUM(status = 'aprovado'), 0) AS aprovados,
       COALESCE(SUM(status IN ('pendente', 'em_processamento')), 0) AS pendentes,
       COALESCE(SUM(status IN ('cancelado', 'recusado', 'expirado')), 0) AS cancelados,
       COALESCE(SUM(status IN ('reembolsado', 'contestado')), 0) AS reembolsados,
       COALESCE(SUM(IF(status = 'aprovado', total_centavos, 0)), 0) AS recebido_centavos
     FROM pedidos`,
  );
  const [[acessos]] = await database.execute(
    `SELECT
       COALESCE(SUM(s.situacao = 'ativo'), 0) AS ativos,
       COALESCE(SUM(s.situacao = 'vencido'), 0) AS vencidos,
       COALESCE(SUM(s.situacao = 'revogado'), 0) AS revogados
     FROM (SELECT ${SITUACAO} AS situacao FROM matriculas m) s`,
  );
  const termos = await documentoVigente('termos');
  // Cursos pagos que estão publicados sem preço válido ou sem forma de pagamento. As regras de
  // publicação impedem isso; a lista existe para apontar dados gravados por outro caminho.
  const [pagos] = await database.execute(
    `SELECT c.id, c.titulo, ${COLUNAS_COMERCIAIS} FROM cursos c
     WHERE c.status = 'publicado' AND c.tipo_acesso = 'pago' ORDER BY c.titulo`,
  );
  res.json({
    cursosComPendencias: pagos
      .map((curso) => ({
        id: curso.id,
        titulo: curso.titulo,
        pendencias: pendenciasComerciais(curso).map((pendencia) => pendencia.mensagem),
      }))
      .filter((curso) => curso.pendencias.length > 0),
    pedidos: {
      aprovados: Number(pedidos.aprovados),
      pendentes: Number(pedidos.pendentes),
      cancelados: Number(pedidos.cancelados),
      reembolsados: Number(pedidos.reembolsados),
      recebidoCentavos: Number(pedidos.recebido_centavos),
    },
    acessos: {
      ativos: Number(acessos.ativos),
      vencidos: Number(acessos.vencidos),
      revogados: Number(acessos.revogados),
    },
    pagamentos: { provedor: provedorAtivo()?.nome ?? null },
    termos: termos ? { versao: termos.versao, vigenteDesde: termos.vigente_desde } : null,
  });
});

// Compras, da mais recente para a mais antiga. ?status= filtra por situação; ?busca= por aluno ou curso.
const listarPedidos = rota(async (req, res) => {
  const condicoes = ['1 = 1'];
  const parametros = [];
  if (req.query.status !== undefined) {
    const lista = String(req.query.status).split(',');
    if (!lista.every((status) => STATUS_DE_PEDIDO.includes(status))) throw new ErroRequisicao(400, 'Situação inválida.');
    condicoes.push(`p.status IN (${lista.map(() => '?').join(', ')})`);
    parametros.push(...lista);
  }
  filtroDeBusca(req.query.busca, ['u.nome', 'u.email', 'p.curso_titulo'], condicoes, parametros);

  const [pedidos] = await database.execute(
    `SELECT p.id, p.curso_id, p.curso_titulo, p.status, p.forma_pagamento, p.parcelas, p.preco_centavos,
            p.desconto_centavos, p.juros_centavos, p.total_centavos, p.valor_parcela_centavos,
            p.prazo_acesso_meses, p.criado_em, p.aprovado_em, u.id AS usuario_id, u.nome, u.email
     FROM pedidos p JOIN usuarios u ON u.id = p.usuario_id
     WHERE ${condicoes.join(' AND ')}
     ORDER BY p.criado_em DESC, p.id DESC LIMIT ${LIMITE}`,
    parametros,
  );
  res.json({
    pedidos: pedidos.map((pedido) => ({
      id: pedido.id,
      cursoId: pedido.curso_id,
      cursoTitulo: pedido.curso_titulo,
      aluno: { id: pedido.usuario_id, nome: pedido.nome, email: pedido.email },
      status: pedido.status,
      formaPagamento: pedido.forma_pagamento,
      parcelas: pedido.parcelas,
      precoCentavos: pedido.preco_centavos,
      descontoCentavos: pedido.desconto_centavos,
      jurosCentavos: pedido.juros_centavos,
      totalCentavos: pedido.total_centavos,
      valorParcelaCentavos: pedido.valor_parcela_centavos,
      prazoAcessoMeses: pedido.prazo_acesso_meses,
      criadoEm: pedido.criado_em,
      aprovadoEm: pedido.aprovado_em,
    })),
  });
});

// Direitos de acesso. ?situacao= ativo | vencido | revogado | agendado; ?busca= por aluno ou curso.
const listarAcessos = rota(async (req, res) => {
  const condicoes = ['1 = 1'];
  const parametros = [];
  for (const [campo, coluna] of [['cursoId', 'm.curso_id'], ['usuarioId', 'm.usuario_id']]) {
    if (req.query[campo] === undefined) continue;
    const id = Number(req.query[campo]);
    if (!Number.isInteger(id) || id <= 0) throw new ErroRequisicao(400, 'Aluno ou curso inválido.');
    condicoes.push(`${coluna} = ?`);
    parametros.push(id);
  }
  if (req.query.situacao !== undefined) {
    if (!SITUACOES_DE_ACESSO.includes(req.query.situacao)) throw new ErroRequisicao(400, 'Situação inválida.');
    condicoes.push(`${SITUACAO} = ?`);
    parametros.push(req.query.situacao);
  }
  filtroDeBusca(req.query.busca, ['u.nome', 'u.email', 'c.titulo'], condicoes, parametros);
  const pagina = Math.min(Math.max(Number.parseInt(req.query.pagina, 10) || 1, 1), 10000);
  const [[{ total }]] = await database.execute(
    `SELECT COUNT(*) AS total FROM matriculas m JOIN usuarios u ON u.id = m.usuario_id
     JOIN cursos c ON c.id = m.curso_id WHERE ${condicoes.join(' AND ')}`, parametros,
  );

  const [acessos] = await database.execute(
    `SELECT m.usuario_id, m.curso_id, m.origem, m.pedido_id, m.inicio_em, m.expira_em, m.revogado_em,
            m.motivo_revogacao, ${SITUACAO} AS situacao, ${DIAS_RESTANTES} AS dias_restantes,
            u.nome, u.email, c.titulo
     FROM matriculas m JOIN usuarios u ON u.id = m.usuario_id JOIN cursos c ON c.id = m.curso_id
     WHERE ${condicoes.join(' AND ')}
     ORDER BY COALESCE(m.atualizado_em, m.criado_em) DESC, m.usuario_id, m.curso_id
     LIMIT ${LIMITE + 1} OFFSET ${(pagina - 1) * LIMITE}`,
    parametros,
  );
  res.json({
    total: Number(total), pagina, temMais: acessos.length > LIMITE,
    acessos: acessos.slice(0, LIMITE).map((acesso) => ({
      aluno: { id: acesso.usuario_id, nome: acesso.nome, email: acesso.email },
      cursoId: acesso.curso_id,
      cursoTitulo: acesso.titulo,
      origem: acesso.origem,
      pedidoId: acesso.pedido_id,
      situacao: acesso.situacao,
      inicioEm: acesso.inicio_em,
      expiraEm: acesso.expira_em,
      diasRestantes: acesso.situacao === 'ativo' ? acesso.dias_restantes : null,
      revogadoEm: acesso.revogado_em,
      motivoRevogacao: acesso.motivo_revogacao,
    })),
  });
});

// Localiza alunos por nome ou e-mail, para liberar um curso.
const buscarAlunos = rota(async (req, res) => {
  const condicoes = ["u.tipo = 'aluno'"];
  const parametros = [];
  filtroDeBusca(req.query.busca, ['u.nome', 'u.email'], condicoes, parametros);
  const [alunos] = await database.execute(
    `SELECT u.id, u.nome, u.email FROM usuarios u WHERE ${condicoes.join(' AND ')} ORDER BY u.nome, u.id LIMIT 20`,
    parametros,
  );
  res.json({ alunos });
});

// Concessão manual compartilhada com a seleção de alunos no cadastro do curso.
const liberarAcesso = rota(async (req, res) => {
  await emTransacao((conexao) => liberarAcessoManual(conexao, req.body || {}, req.usuario.id));
  res.status(201).json({ message: 'Acesso liberado.' });
});
// Encerra o acesso de um aluno a um curso. O progresso dele nas aulas continua guardado.
const revogar = rota(async (req, res) => {
  const { usuarioId, cursoId } = req.body || {};
  if (!Number.isInteger(usuarioId) || !Number.isInteger(cursoId)) throw new ErroRequisicao(400, 'Selecione o aluno e o curso.');
  const motivo = texto(req.body.motivo, 'motivo', { max: 255 }) ?? 'Revogado pela administração.';

  const revogou = await emTransacao((conexao) =>
    revogarAcesso(conexao, { usuarioId, cursoId, adminId: req.usuario.id, motivo }),
  );
  if (!revogou) throw new ErroRequisicao(404, 'Este aluno não tem um acesso ativo a esse curso.');
  res.json({ message: 'Acesso revogado.' });
});

module.exports = { resumoComercial, listarPedidos, listarAcessos, buscarAlunos, liberarAcesso, revogar };
