// Erro com resposta HTTP definida, lançado pelos controladores e tratado por `rota`.
class ErroRequisicao extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

// Envolve um controlador assíncrono: responde erros esperados e oculta os detalhes dos demais.
function rota(controlador) {
  return async (req, res) => {
    try {
      await controlador(req, res);
    } catch (error) {
      if (error instanceof ErroRequisicao) {
        return res.status(error.status).json({ message: error.message, ...error.extra });
      }
      console.error(`Erro em ${req.method} ${req.baseUrl}${req.route?.path ?? ''}:`, error.code || error.name);
      return res.status(500).json({ message: 'Não foi possível concluir a operação.' });
    }
  };
}

function idDaRota(valor) {
  const id = Number(valor);
  if (!Number.isInteger(id) || id <= 0) throw new ErroRequisicao(404, 'Registro não encontrado.');
  return id;
}

// Texto opcional ou obrigatório, aparado e limitado. Vazio vira null.
function texto(valor, campo, { max, obrigatorio = false }) {
  if (valor === undefined || valor === null || valor === '') {
    if (obrigatorio) throw new ErroRequisicao(400, `Informe ${campo}.`);
    return null;
  }
  if (typeof valor !== 'string') throw new ErroRequisicao(400, `O campo ${campo} deve ser um texto.`);
  const aparado = valor.trim();
  if (!aparado) {
    if (obrigatorio) throw new ErroRequisicao(400, `Informe ${campo}.`);
    return null;
  }
  if ([...aparado].length > max) {
    throw new ErroRequisicao(400, `O campo ${campo} aceita até ${max} caracteres.`);
  }
  return aparado;
}

function booleano(valor, campo) {
  if (typeof valor !== 'boolean') throw new ErroRequisicao(400, `O campo ${campo} deve ser verdadeiro ou falso.`);
  return valor ? 1 : 0;
}

// Lista de ids para reordenação: inteiros positivos, sem repetição.
function listaDeIds(valor) {
  const valida =
    Array.isArray(valor) &&
    valor.length > 0 &&
    valor.length <= 500 &&
    valor.every((id) => Number.isInteger(id) && id > 0) &&
    new Set(valor).size === valor.length;
  if (!valida) throw new ErroRequisicao(400, 'Informe a nova ordem como uma lista de identificadores.');
  return valor;
}

module.exports = { ErroRequisicao, rota, idDaRota, texto, booleano, listaDeIds };
