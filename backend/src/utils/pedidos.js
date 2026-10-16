const database = require('../config/database');
const { concederAcesso, revogarAcesso, emTransacao } = require('./acessos');

const ABERTOS = ['pendente', 'em_processamento'];

// De quais situações um pedido pode passar para cada situação nova.
const TRANSICOES = {
  em_processamento: ['pendente'],
  aprovado: ABERTOS,
  recusado: ABERTOS,
  cancelado: ABERTOS,
  expirado: ABERTOS,
  reembolsado: ['aprovado', 'contestado'],
  contestado: ['aprovado'],
};

const COLUNAS_DO_PEDIDO = `p.id, p.usuario_id, p.curso_id, p.curso_titulo, p.status, p.forma_pagamento, p.parcelas,
  p.preco_centavos, p.desconto_centavos, p.juros_centavos, p.total_centavos, p.valor_parcela_centavos,
  p.prazo_acesso_meses, p.provedor, p.provedor_pagamento_id, p.pix_copia_cola, p.pix_qr_base64, p.checkout_url,
  p.recibo_url, p.expira_em, p.aprovado_em, p.criado_em`;

/**
 * Aplica a um pedido a situação informada pelo provedor de pagamentos. É o ÚNICO caminho que
 * aprova uma compra e libera o curso, e pode ser chamado várias vezes com segurança:
 *
 * - `eventoId` identifica a notificação; a mesma notificação entregue de novo não faz nada;
 * - o pedido fica travado durante a operação, então duas confirmações simultâneas não liberam
 *   o curso duas vezes;
 * - a aprovação só vale se o valor pago for exatamente o total do pedido.
 *
 * Aprovado: registra a data, cria o direito de acesso e começa a contar o prazo a partir de agora.
 * Reembolsado ou contestado: encerra o acesso criado por este pedido; o progresso é preservado.
 * Devolve { aplicado, motivo? }.
 */
async function registrarSituacao({ pedidoId, provedor, eventoId, status, valorCentavos = null, detalhe = null, reciboUrl = null }) {
  return emTransacao(async (conexao) => {
    const [pedidos] = await conexao.execute(
      'SELECT id, usuario_id, curso_id, status, total_centavos, prazo_acesso_meses FROM pedidos WHERE id = ? FOR UPDATE',
      [pedidoId],
    );
    const pedido = pedidos[0];
    if (!pedido) return { aplicado: false, motivo: 'pedido-inexistente' };

    const [evento] = await conexao.execute(
      `INSERT IGNORE INTO transacoes (pedido_id, provedor, evento_id, status, valor_centavos, detalhe)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [pedido.id, provedor, String(eventoId).slice(0, 150), status, valorCentavos, detalhe?.slice(0, 255) ?? null],
    );
    if (evento.affectedRows === 0) return { aplicado: false, motivo: 'evento-repetido' };
    if (!TRANSICOES[status]?.includes(pedido.status)) return { aplicado: false, motivo: 'sem-efeito' };

    if (status === 'aprovado' && valorCentavos !== pedido.total_centavos) {
      console.error(`Pagamento com valor divergente no pedido ${pedido.id}: aprovação ignorada.`);
      return { aplicado: false, motivo: 'valor-divergente' };
    }

    await conexao.execute(
      `UPDATE pedidos SET status = ?, aprovado_em = IF(? = 'aprovado', NOW(), aprovado_em),
         recibo_url = COALESCE(?, recibo_url)
       WHERE id = ?`,
      [status, status, reciboUrl, pedido.id],
    );

    if (status === 'aprovado') {
      // O acesso começa exatamente na data de aprovação gravada no pedido.
      const [[{ aprovado_em: aprovadoEm }]] = await conexao.execute('SELECT aprovado_em FROM pedidos WHERE id = ?', [pedido.id]);
      await concederAcesso(conexao, {
        inicio: aprovadoEm,
        usuarioId: pedido.usuario_id,
        cursoId: pedido.curso_id,
        origem: 'compra',
        pedidoId: pedido.id,
        meses: pedido.prazo_acesso_meses,
      });
    } else if (status === 'reembolsado' || status === 'contestado') {
      await revogarAcesso(conexao, {
        usuarioId: pedido.usuario_id,
        cursoId: pedido.curso_id,
        pedidoId: pedido.id,
        motivo: status === 'reembolsado' ? 'Compra reembolsada.' : 'Compra contestada.',
      });
    }
    return { aplicado: true };
  });
}

/**
 * Atualiza um pedido em aberto antes de mostrá-lo: consulta o provedor (se houver) e marca
 * como expirado o que passou do prazo da cobrança. Falhas de consulta não interrompem a leitura.
 */
async function sincronizarPedido(pedido, provedor) {
  if (!ABERTOS.includes(pedido.status)) return;
  if (provedor && provedor.nome === pedido.provedor && pedido.provedor_pagamento_id) {
    try {
      const pagamento = await provedor.consultar(pedido.provedor_pagamento_id);
      if (pagamento.status !== pedido.status) {
        await registrarSituacao({
          pedidoId: pedido.id,
          provedor: provedor.nome,
          eventoId: `consulta:${pedido.provedor_pagamento_id}:${pagamento.status}`,
          status: pagamento.status,
          valorCentavos: pagamento.valorCentavos ?? null,
          detalhe: pagamento.detalhe ?? null,
          reciboUrl: pagamento.reciboUrl ?? null,
        });
        return;
      }
    } catch (error) {
      console.error('Não foi possível consultar o pagamento:', error.code || error.name);
    }
  }
  const [[{ vencido }]] = await database.execute(
    'SELECT (expira_em IS NOT NULL AND expira_em <= NOW()) AS vencido FROM pedidos WHERE id = ?',
    [pedido.id],
  );
  if (vencido === 1) {
    await registrarSituacao({
      pedidoId: pedido.id,
      provedor: pedido.provedor,
      eventoId: `expiracao:${pedido.id}`,
      status: 'expirado',
      detalhe: 'Prazo da cobrança encerrado.',
    });
  }
}

// Pedido como o próprio aluno o vê. Os dados da cobrança só aparecem enquanto ela está em aberto.
function pedidoPublico(pedido) {
  const aberto = ABERTOS.includes(pedido.status);
  return {
    id: pedido.id,
    cursoId: pedido.curso_id,
    cursoTitulo: pedido.curso_titulo,
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
    expiraEm: aberto ? pedido.expira_em : null,
    pix:
      aberto && pedido.forma_pagamento === 'pix' && pedido.pix_copia_cola
        ? { copiaECola: pedido.pix_copia_cola, qrBase64: pedido.pix_qr_base64 }
        : null,
    checkoutUrl: aberto ? pedido.checkout_url : null,
    reciboUrl: pedido.recibo_url,
  };
}

module.exports = { ABERTOS, COLUNAS_DO_PEDIDO, registrarSituacao, sincronizarPedido, pedidoPublico };
