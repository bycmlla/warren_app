const { ErroRequisicao } = require('./http');

const TIPOS_DE_ACESSO = ['gratuito', 'pago', 'restrito'];
const PRAZOS_DE_ACESSO = [12, 24, null]; // meses; null = sem vencimento definido
const FORMAS_DE_PAGAMENTO = ['pix', 'cartao'];
const STATUS_DE_PEDIDO = [
  'pendente',
  'em_processamento',
  'aprovado',
  'recusado',
  'cancelado',
  'expirado',
  'reembolsado',
  'contestado',
];
const PRECO_MAXIMO = 100000 * 100; // R$ 100.000,00
const PARCELAS_MAXIMAS = 12;
const DESCONTO_PIX_MAXIMO = 90;

const COLUNAS_COMERCIAIS = `c.tipo_acesso, c.preco_centavos, c.pix_habilitado, c.pix_desconto_percentual,
  c.cartao_habilitado, c.cartao_max_parcelas, c.cartao_parcelas_sem_juros, c.prazo_acesso_meses`;

// Valor no Pix: preço cadastrado menos o desconto percentual, arredondado ao centavo.
function valoresPix(precoCentavos, descontoPercentual) {
  const descontoCentavos = Math.round((precoCentavos * Number(descontoPercentual)) / 100);
  return { descontoCentavos, totalCentavos: precoCentavos - descontoCentavos };
}

/**
 * Condições comerciais de um curso pago, como o aluno as vê. null para cursos gratuitos,
 * restritos ou ainda sem preço. O valor de cada parcela não aparece aqui: ele só existe
 * quando o provedor de pagamentos informa as condições reais (ver `parcelas` do adaptador).
 */
function condicoesComerciais(curso) {
  if (curso.tipo_acesso !== 'pago' || !curso.preco_centavos) return null;
  const pix = valoresPix(curso.preco_centavos, curso.pix_desconto_percentual);
  return {
    precoCentavos: curso.preco_centavos,
    prazoAcessoMeses: curso.prazo_acesso_meses,
    pix:
      curso.pix_habilitado === 1
        ? { descontoPercentual: Number(curso.pix_desconto_percentual), ...pix }
        : null,
    cartao:
      curso.cartao_habilitado === 1
        ? { maxParcelas: curso.cartao_max_parcelas, parcelasSemJuros: curso.cartao_parcelas_sem_juros }
        : null,
  };
}

function inteiroEntre(valor, campo, minimo, maximo) {
  if (!Number.isInteger(valor) || valor < minimo || valor > maximo) {
    throw new ErroRequisicao(400, `Informe ${campo} entre ${minimo} e ${maximo}.`);
  }
  return valor;
}

// Configurações comerciais enviadas pelo formulário do curso. Rascunhos podem ficar incompletos.
function camposComerciais(corpo) {
  // Compatibilidade: versões anteriores do aplicativo enviavam apenas `gratuito`.
  const tipo = corpo.tipoAcesso ?? (corpo.gratuito === true ? 'gratuito' : 'restrito');
  if (!TIPOS_DE_ACESSO.includes(tipo)) throw new ErroRequisicao(400, 'Tipo de acesso inválido.');

  const preco = corpo.precoCentavos ?? null;
  if (preco !== null && (!Number.isInteger(preco) || preco <= 0 || preco > PRECO_MAXIMO)) {
    throw new ErroRequisicao(400, 'Informe um preço válido, de até R$ 100.000,00.');
  }

  const desconto = corpo.pixDescontoPercentual ?? 0;
  if (typeof desconto !== 'number' || !Number.isFinite(desconto) || desconto < 0 || desconto > DESCONTO_PIX_MAXIMO) {
    throw new ErroRequisicao(400, `O desconto no Pix deve ficar entre 0% e ${DESCONTO_PIX_MAXIMO}%.`);
  }

  const maxParcelas = inteiroEntre(corpo.cartaoMaxParcelas ?? 1, 'a quantidade máxima de parcelas', 1, PARCELAS_MAXIMAS);
  const semJuros = inteiroEntre(corpo.cartaoParcelasSemJuros ?? 1, 'as parcelas sem juros', 1, maxParcelas);

  const prazo = corpo.prazoAcessoMeses ?? null;
  if (!PRAZOS_DE_ACESSO.includes(prazo)) throw new ErroRequisicao(400, 'Prazo de acesso inválido.');

  for (const campo of ['pixHabilitado', 'cartaoHabilitado']) {
    if (corpo[campo] !== undefined && typeof corpo[campo] !== 'boolean') {
      throw new ErroRequisicao(400, 'Forma de pagamento inválida.');
    }
  }

  return {
    tipo_acesso: tipo,
    gratuito: tipo === 'gratuito' ? 1 : 0,
    preco_centavos: preco,
    pix_habilitado: corpo.pixHabilitado ? 1 : 0,
    pix_desconto_percentual: Math.round(desconto * 100) / 100,
    cartao_habilitado: corpo.cartaoHabilitado ? 1 : 0,
    cartao_max_parcelas: maxParcelas,
    cartao_parcelas_sem_juros: semJuros,
    prazo_acesso_meses: prazo,
  };
}

/**
 * O que falta para um curso pago poder estar publicado: um preço válido (maior que zero) e ao
 * menos uma forma de pagamento. Cada pendência traz o campo do formulário a que se refere.
 * Cursos gratuitos e restritos não têm pendências comerciais.
 */
function pendenciasComerciais(curso) {
  if (curso.tipo_acesso !== 'pago') return [];
  const pendencias = [];
  if (!Number.isInteger(curso.preco_centavos) || curso.preco_centavos <= 0) {
    pendencias.push({
      campo: 'preco',
      mensagem:
        'Este curso está configurado como pago, mas ainda não possui um valor válido cadastrado. Informe o preço antes de publicar.',
    });
  }
  if (curso.pix_habilitado !== 1 && curso.cartao_habilitado !== 1) {
    pendencias.push({
      campo: 'pagamento',
      mensagem: 'Este curso está configurado como pago, mas não tem forma de pagamento habilitada. Habilite Pix ou cartão antes de publicar.',
    });
  }
  return pendencias;
}

module.exports = {
  TIPOS_DE_ACESSO,
  PRAZOS_DE_ACESSO,
  FORMAS_DE_PAGAMENTO,
  STATUS_DE_PEDIDO,
  COLUNAS_COMERCIAIS,
  valoresPix,
  condicoesComerciais,
  camposComerciais,
  pendenciasComerciais,
};
