const database = require('../config/database');
const { provedorAtivo } = require('../pagamentos');
const { VALIDA, SITUACAO, DIAS_RESTANTES, DIAS_DE_AVISO, situacaoDeAcesso } = require('../utils/acessos');
const { COLUNAS_COMERCIAIS, FORMAS_DE_PAGAMENTO, condicoesComerciais } = require('../utils/comercial');
const { ErroRequisicao, rota, idDaRota } = require('../utils/http');
const { COLUNAS_DO_PEDIDO, registrarSituacao, sincronizarPedido, pedidoPublico } = require('../utils/pedidos');
const { exigirAceiteParaCompra } = require('../utils/termos');

// Curso publicado e à venda (pago, com preço), com as condições comerciais atuais.
async function cursoAVenda(id) {
  const [cursos] = await database.execute(
    `SELECT c.id, c.titulo, c.subtitulo, c.descricao, c.instrutora, c.imagem_capa, c.status, c.total_aulas,
            c.duracao_minutos,
            ${COLUNAS_COMERCIAIS},
            (SELECT COUNT(*) FROM modulos m WHERE m.curso_id = c.id) AS total_modulos
     FROM cursos c WHERE c.id = ? LIMIT 1`,
    [id],
  );
  const curso = cursos[0];
  if (!curso || curso.status !== 'publicado') throw new ErroRequisicao(404, 'Curso não encontrado.');
  const comercial = condicoesComerciais(curso);
  if (!comercial) {
    throw new ErroRequisicao(409, 'Este curso ainda não está disponível para compra.', { codigo: 'NAO_VENDIDO' });
  }
  return { curso, comercial };
}

/**
 * Formas de pagamento do curso que o provedor realmente aceita. Sem provedor, lista o que a
 * administradora habilitou, mas `disponivel` fica falso e nenhuma compra pode ser iniciada.
 * As opções de parcelamento vêm sempre do provedor; sem ele, não há valor de parcela a mostrar.
 */
async function formasDePagamento(comercial, provedor) {
  const aceita = (forma) => !provedor || provedor.metodos.includes(forma);
  const metodos = [];
  if (comercial.pix && aceita('pix')) {
    metodos.push({
      forma: 'pix',
      totalCentavos: comercial.pix.totalCentavos,
      descontoCentavos: comercial.pix.descontoCentavos,
    });
  }
  if (comercial.cartao && aceita('cartao')) {
    const opcoes = provedor
      ? await provedor.parcelas({ totalCentavos: comercial.precoCentavos, ...comercial.cartao })
      : null;
    metodos.push({
      forma: 'cartao',
      maxParcelas: comercial.cartao.maxParcelas,
      opcoes:
        opcoes
          ?.filter((opcao) => opcao.parcelas <= comercial.cartao.maxParcelas)
          .map((opcao) => ({
            parcelas: opcao.parcelas,
            valorParcelaCentavos: opcao.valorParcelaCentavos,
            totalCentavos: opcao.totalCentavos,
            jurosCentavos: opcao.totalCentavos - comercial.precoCentavos,
          })) ?? null,
    });
  }
  return { disponivel: provedor !== null && metodos.length > 0, metodos };
}

async function buscarPedido(id, usuarioId) {
  const [pedidos] = await database.execute(
    `SELECT ${COLUNAS_DO_PEDIDO} FROM pedidos p WHERE p.id = ? AND p.usuario_id = ? LIMIT 1`,
    [id, usuarioId],
  );
  if (!pedidos[0]) throw new ErroRequisicao(404, 'Compra não encontrada.');
  return pedidos[0];
}

// Quem já pode abrir o curso não vê oferta nem cria pedido: uma compra feita não é cobrada de novo.
function recusarSeLiberado(situacao) {
  if (situacao.estado === 'liberado') {
    throw new ErroRequisicao(409, 'Você já tem acesso a este curso.', { codigo: 'JA_LIBERADO' });
  }
}

/**
 * Oferta de um curso pago para o aluno: condições, formas de pagamento e parcelas reais.
 * Só é entregue depois do aceite dos Termos de Uso vigentes.
 */
const obterOferta = rota(async (req, res) => {
  const { curso, comercial } = await cursoAVenda(idDaRota(req.params.id));
  await exigirAceiteParaCompra(req.usuario);
  const situacao = await situacaoDeAcesso(req.usuario, curso);
  recusarSeLiberado(situacao);

  res.json({
    curso: {
      id: curso.id,
      titulo: curso.titulo,
      subtitulo: curso.subtitulo,
      descricao: curso.descricao,
      instrutora: curso.instrutora,
      imagemCapa: curso.imagem_capa,
      totalModulos: Number(curso.total_modulos),
      totalAulas: curso.total_aulas ?? 0,
      duracaoMinutos: curso.duracao_minutos ?? 0,
    },
    comercial,
    pagamentos: await formasDePagamento(comercial, provedorAtivo()),
    pedidoPendenteId: situacao.pedidoId,
  });
});

/**
 * Inicia a compra de um curso. A ordem das verificações importa:
 * 1. o curso está à venda; 2. o aluno aceitou os Termos de Uso vigentes; 3. ele ainda não tem
 * acesso nem compra em andamento; 4. a forma de pagamento está habilitada; 5. há um provedor.
 * Todos os valores são calculados aqui, a partir do cadastro do curso: nada do que o aplicativo
 * envia além de curso, forma e número de parcelas é usado para definir o preço.
 * Criar o pedido não libera o curso; só a confirmação do provedor faz isso.
 */
const criarPedido = rota(async (req, res) => {
  const corpo = req.body || {};
  if (!Number.isInteger(corpo.cursoId) || corpo.cursoId <= 0) throw new ErroRequisicao(400, 'Curso inválido.');
  const { curso, comercial } = await cursoAVenda(corpo.cursoId);
  const aceite = await exigirAceiteParaCompra(req.usuario);

  const situacao = await situacaoDeAcesso(req.usuario, curso);
  recusarSeLiberado(situacao);
  if (situacao.estado === 'pendente') {
    return res.json({ pedido: pedidoPublico(await buscarPedido(situacao.pedidoId, req.usuario.id)) });
  }

  const forma = corpo.formaPagamento;
  const parcelas = corpo.parcelas ?? 1;
  if (!FORMAS_DE_PAGAMENTO.includes(forma) || !comercial[forma]) {
    throw new ErroRequisicao(400, 'Forma de pagamento indisponível para este curso.');
  }
  if (!Number.isInteger(parcelas) || parcelas < 1 || (forma === 'pix' && parcelas !== 1)) {
    throw new ErroRequisicao(400, 'Quantidade de parcelas inválida.');
  }

  const provedor = provedorAtivo();
  const pagamentos = await formasDePagamento(comercial, provedor);
  const metodo = pagamentos.metodos.find((item) => item.forma === forma);
  if (!provedor || !metodo) {
    throw new ErroRequisicao(503, 'O pagamento pelo aplicativo ainda não está disponível.', {
      codigo: 'PAGAMENTO_INDISPONIVEL',
    });
  }

  let valores;
  if (forma === 'pix') {
    valores = { desconto: metodo.descontoCentavos, juros: 0, total: metodo.totalCentavos, parcela: metodo.totalCentavos };
  } else {
    const opcao = metodo.opcoes?.find((item) => item.parcelas === parcelas);
    if (!opcao) throw new ErroRequisicao(400, 'Parcelamento indisponível para este curso.');
    valores = { desconto: 0, juros: opcao.jurosCentavos, total: opcao.totalCentavos, parcela: opcao.valorParcelaCentavos };
  }

  let pedidoId;
  try {
    const [resultado] = await database.execute(
      `INSERT INTO pedidos (usuario_id, curso_id, curso_titulo, forma_pagamento, parcelas, preco_centavos,
         desconto_centavos, juros_centavos, total_centavos, valor_parcela_centavos, prazo_acesso_meses, aceite_id, provedor)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.usuario.id,
        curso.id,
        curso.titulo,
        forma,
        parcelas,
        comercial.precoCentavos,
        valores.desconto,
        valores.juros,
        valores.total,
        valores.parcela,
        comercial.prazoAcessoMeses,
        aceite.id,
        provedor.nome,
      ],
    );
    pedidoId = resultado.insertId;
  } catch (error) {
    // Dois toques em "Confirmar" ao mesmo tempo: o segundo recebe o pedido que o primeiro criou.
    if (error.code !== 'ER_DUP_ENTRY') throw error;
    const aberto = await situacaoDeAcesso(req.usuario, curso);
    return res.json({ pedido: pedidoPublico(await buscarPedido(aberto.pedidoId, req.usuario.id)) });
  }

  let cobranca;
  try {
    cobranca = await provedor.criarCobranca({
      pedido: await buscarPedido(pedidoId, req.usuario.id),
      usuario: req.usuario,
      dados: corpo.dadosPagamento ?? null,
    });
  } catch (error) {
    console.error('Não foi possível criar a cobrança:', error.code || error.name);
    await registrarSituacao({
      pedidoId,
      provedor: provedor.nome,
      eventoId: `falha-criacao:${pedidoId}`,
      status: 'cancelado',
      detalhe: 'A cobrança não pôde ser criada no provedor.',
    });
    throw new ErroRequisicao(502, 'Não foi possível iniciar o pagamento. Nada foi cobrado; tente novamente.');
  }

  await database.execute(
    `UPDATE pedidos SET provedor_pagamento_id = ?, pix_copia_cola = ?, pix_qr_base64 = ?, checkout_url = ?,
       recibo_url = ?, expira_em = ?
     WHERE id = ?`,
    [
      String(cobranca.pagamentoId),
      cobranca.pix?.copiaECola ?? null,
      cobranca.pix?.qrBase64 ?? null,
      cobranca.checkoutUrl ?? null,
      cobranca.reciboUrl ?? null,
      cobranca.expiraEm ?? null,
      pedidoId,
    ],
  );
  // Cartão pode voltar aprovado ou recusado na hora; mesmo assim a situação é conferida no provedor.
  if (cobranca.status !== 'pendente') {
    await sincronizarPedido(await buscarPedido(pedidoId, req.usuario.id), provedor);
  }
  return res.status(201).json({ pedido: pedidoPublico(await buscarPedido(pedidoId, req.usuario.id)) });
});

// Histórico de compras do próprio aluno. Nenhum dado de cartão é guardado ou devolvido.
const listarPedidos = rota(async (req, res) => {
  const [pedidos] = await database.execute(
    `SELECT ${COLUNAS_DO_PEDIDO} FROM pedidos p WHERE p.usuario_id = ? ORDER BY p.criado_em DESC, p.id DESC LIMIT 100`,
    [req.usuario.id],
  );
  res.json({ pedidos: pedidos.map(pedidoPublico) });
});

// Situação de uma compra. Enquanto ela está em aberto, cada leitura confere o pagamento no provedor.
const obterPedido = rota(async (req, res) => {
  const id = idDaRota(req.params.id);
  await sincronizarPedido(await buscarPedido(id, req.usuario.id), provedorAtivo());
  res.json({ pedido: pedidoPublico(await buscarPedido(id, req.usuario.id)) });
});

// O aluno desiste de uma compra ainda não paga (por exemplo, para escolher outra forma de pagamento).
const cancelarPedido = rota(async (req, res) => {
  const id = idDaRota(req.params.id);
  const pedido = await buscarPedido(id, req.usuario.id);
  await sincronizarPedido(pedido, provedorAtivo());
  const resultado = await registrarSituacao({
    pedidoId: id,
    provedor: pedido.provedor,
    eventoId: `cancelamento-aluno:${id}`,
    status: 'cancelado',
    detalhe: 'Cancelado pelo aluno antes do pagamento.',
  });
  if (!resultado.aplicado) throw new ErroRequisicao(409, 'Esta compra não pode mais ser cancelada pelo aplicativo.');
  res.json({ pedido: pedidoPublico(await buscarPedido(id, req.usuario.id)) });
});

/**
 * Webhook do provedor de pagamentos. A notificação só diz QUAL pagamento mudou: depois de
 * conferir a assinatura, a situação e o valor são lidos diretamente do provedor. O retorno do
 * aplicativo ou de um redirecionamento nunca confirma um pagamento.
 */
const receberNotificacao = rota(async (req, res) => {
  const provedor = provedorAtivo();
  if (!provedor || provedor.nome !== req.params.provedor) throw new ErroRequisicao(404, 'Provedor desconhecido.');

  const aviso = await provedor.validarNotificacao(req);
  if (aviso) {
    const pagamento = await provedor.consultar(aviso.pagamentoId);
    const [pedidos] = await database.execute(
      'SELECT id FROM pedidos WHERE provedor = ? AND (provedor_pagamento_id = ? OR id = ?) LIMIT 1',
      [provedor.nome, String(pagamento.pagamentoId), Number(pagamento.pedidoId) || 0],
    );
    if (pedidos[0]) {
      await registrarSituacao({
        pedidoId: pedidos[0].id,
        provedor: provedor.nome,
        eventoId: aviso.eventoId,
        status: pagamento.status,
        valorCentavos: pagamento.valorCentavos ?? null,
        detalhe: pagamento.detalhe ?? null,
        reciboUrl: pagamento.reciboUrl ?? null,
      });
    }
  }
  res.json({ recebido: true });
});

/**
 * Meus cursos: pagos comprados/liberados, inclusive o histórico vencido/revogado; restritos
 * somente com autorização válida; e gratuitos que o aluno já começou. Todos publicados.
 */
const meusCursos = rota(async (req, res) => {
  const concluidas = `(SELECT COUNT(*) FROM progresso_aulas p JOIN aulas a ON a.id = p.aula_id
     JOIN modulos mo ON mo.id = a.modulo_id
     WHERE p.usuario_id = ? AND mo.curso_id = c.id AND p.concluida = 1)`;
  const colunas = 'c.id, c.titulo, c.subtitulo, c.imagem_capa, c.total_aulas';
  const [comAcesso] = await database.execute(
    `SELECT ${colunas}, ${concluidas} AS concluidas, m.origem, m.inicio_em, m.expira_em,
            ${SITUACAO} AS situacao, ${DIAS_RESTANTES} AS dias_restantes
     FROM matriculas m JOIN cursos c ON c.id = m.curso_id
     WHERE m.usuario_id = ? AND c.status = 'publicado' AND c.tipo_acesso <> 'gratuito'
       AND (c.tipo_acesso <> 'restrito' OR ${VALIDA})
     ORDER BY m.inicio_em DESC, c.id DESC`,
    [req.usuario.id, req.usuario.id],
  );
  const [gratuitos] = await database.execute(
    `SELECT ${colunas}, ${concluidas} AS concluidas FROM cursos c
     WHERE c.status = 'publicado' AND c.tipo_acesso = 'gratuito'
       AND EXISTS (SELECT 1 FROM progresso_aulas p JOIN aulas a ON a.id = p.aula_id
                   JOIN modulos mo ON mo.id = a.modulo_id WHERE p.usuario_id = ? AND mo.curso_id = c.id)
     ORDER BY c.titulo`,
    [req.usuario.id, req.usuario.id],
  );

  const paraResposta = (curso) => {
    const total = curso.total_aulas ?? 0;
    const feitas = Math.min(Number(curso.concluidas), total);
    const situacao = curso.situacao ?? 'gratuito';
    const dias = situacao === 'ativo' ? curso.dias_restantes : null;
    return {
      id: curso.id,
      titulo: curso.titulo,
      subtitulo: curso.subtitulo,
      imagemCapa: curso.imagem_capa,
      totalAulas: total,
      aulasConcluidas: feitas,
      percentual: total === 0 ? 0 : Math.round((feitas / total) * 100),
      situacao,
      origem: curso.origem ?? null,
      inicioEm: curso.inicio_em ?? null,
      expiraEm: curso.expira_em ?? null,
      diasRestantes: dias,
      pertoDeVencer: dias !== null && dias <= DIAS_DE_AVISO,
    };
  };
  res.json({ cursos: [...comAcesso, ...gratuitos].map(paraResposta) });
});

module.exports = {
  obterOferta,
  criarPedido,
  listarPedidos,
  obterPedido,
  cancelarPedido,
  receberNotificacao,
  meusCursos,
};
