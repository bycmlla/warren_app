/**
 * Provedor de pagamentos.
 *
 * NENHUM PROVEDOR ESTÁ INTEGRADO. Enquanto `provedorAtivo()` devolver null, o backend não cria
 * pedidos nem cobranças: a compra responde 503 (PAGAMENTO_INDISPONIVEL) e nenhum curso pago é
 * liberado por pagamento. Para ativar, implemente um adaptador com o contrato abaixo, registre-o
 * aqui com `registrar` e defina PAGAMENTO_PROVEDOR no .env com o nome dele.
 *
 * Contrato do adaptador:
 *
 *   nome      identificador gravado em pedidos.provedor (ex.: 'mercadopago')
 *   metodos   formas aceitas pela conta: ['pix'], ['cartao'] ou ambas
 *
 *   parcelas({ totalCentavos, maxParcelas, parcelasSemJuros })
 *     → [{ parcelas, valorParcelaCentavos, totalCentavos }]
 *     Condições REAIS de parcelamento informadas pelo provedor (com juros, quando houver).
 *     O backend nunca calcula juros por conta própria.
 *
 *   criarCobranca({ pedido, usuario, dados })
 *     → { pagamentoId, status, expiraEm?, pix?: { copiaECola, qrBase64 }, checkoutUrl?, reciboUrl? }
 *     `dados` é o que o checkout seguro do provedor entregou ao aplicativo (ex.: token do cartão).
 *     Número, validade e código do cartão nunca passam por este backend.
 *
 *   consultar(pagamentoId)
 *     → { pagamentoId, pedidoId, status, valorCentavos, reciboUrl?, detalhe? }
 *     Situação atual segundo o provedor. É a única fonte aceita para confirmar um pagamento.
 *
 *   validarNotificacao(req)
 *     → { eventoId, pagamentoId } ou null (notificação que não interessa)
 *     Confere a assinatura do webhook e lança ErroRequisicao(401) se ela não for válida.
 *
 * `status` usa os valores de pedidos.status: pendente, em_processamento, aprovado, recusado,
 * cancelado, expirado, reembolsado ou contestado.
 */
const adaptadores = new Map();

function registrar(adaptador) {
  adaptadores.set(adaptador.nome, adaptador);
}

function remover(nome) {
  adaptadores.delete(nome);
}

// O provedor escolhido em PAGAMENTO_PROVEDOR, se houver um adaptador registrado com esse nome.
function provedorAtivo() {
  return adaptadores.get(process.env.PAGAMENTO_PROVEDOR) ?? null;
}

module.exports = { registrar, remover, provedorAtivo };
