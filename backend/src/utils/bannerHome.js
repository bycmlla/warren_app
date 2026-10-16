const database = require('../config/database');
const { URL_DE_IMAGEM } = require('../config/storage');
const { ErroRequisicao } = require('./http');

// Carrossel de banners da Home.
//
// - Banners personalizados: uma linha por banner em banners_home (imagem no armazenamento de arquivos).
// - Banner padrão: a composição original do aplicativo. Ele não é uma linha da tabela, não pode ser
//   excluído e nunca se perde; só se guarda se ele participa do carrossel e a cor do seu botão.
//   Essa configuração fica em configuracoes ('carrossel_home').

const CHAVE_PADRAO = 'carrossel_home';
const BOTOES = ['champagne', 'white', 'dark'];
const MAX_NOME = 80;
const MAX_SUPERIOR = 80;
const MAX_TITULO = 120;
const MAX_BANNERS = 20;

const TEXTO_SUPERIOR = 'IDENTIDADE • ENERGIA • CONSCIÊNCIA';
const TITULO = 'Abra espaço para a vida que você deseja';

const AJUSTE_PADRAO = { exibir: true, botao: 'champagne' };

// ---------- validação

function percentual(valor, campo) {
  if (typeof valor !== 'number' || !Number.isFinite(valor) || valor < 0 || valor > 100) {
    throw new ErroRequisicao(400, `O enquadramento (${campo}) deve ficar entre 0 e 100.`);
  }
  return Math.round(valor);
}

function bloco(valor, campo, max) {
  if (typeof valor?.visivel !== 'boolean' || typeof valor?.texto !== 'string') {
    throw new ErroRequisicao(400, `Configuração inválida para ${campo}.`);
  }
  const texto = valor.texto.replace(/\s+/g, ' ').trim();
  if ([...texto].length > max) throw new ErroRequisicao(400, `${campo} aceita até ${max} caracteres.`);
  if (valor.visivel && !texto) throw new ErroRequisicao(400, `Escreva ${campo} ou oculte-o.`);
  return { texto, visivel: valor.visivel };
}

function botao(valor) {
  if (!BOTOES.includes(valor)) throw new ErroRequisicao(400, 'Estilo de botão inválido.');
  return valor;
}

/** Valida os dados de um banner personalizado (criação ou edição completa). */
function validarBanner(corpo) {
  const dados = corpo ?? {};
  const nome = typeof dados.nome === 'string' ? dados.nome.replace(/\s+/g, ' ').trim() : '';
  if (!nome) throw new ErroRequisicao(400, 'Informe um nome interno para o banner.');
  if ([...nome].length > MAX_NOME) throw new ErroRequisicao(400, `O nome aceita até ${MAX_NOME} caracteres.`);

  if (typeof dados.imagem !== 'string' || !URL_DE_IMAGEM.test(dados.imagem)) {
    throw new ErroRequisicao(400, 'Escolha a imagem do banner (enviada pelo aplicativo).');
  }
  if (dados.ativo !== undefined && typeof dados.ativo !== 'boolean') {
    throw new ErroRequisicao(400, 'O campo ativo deve ser verdadeiro ou falso.');
  }
  return {
    nome,
    imagem: dados.imagem,
    enquadramento: {
      x: percentual(dados.enquadramento?.x ?? 50, 'horizontal'),
      y: percentual(dados.enquadramento?.y ?? 50, 'vertical'),
    },
    textoSuperior: bloco(dados.textoSuperior, 'o texto superior', MAX_SUPERIOR),
    titulo: bloco(dados.titulo, 'o título', MAX_TITULO),
    botao: botao(dados.botao),
    ativo: dados.ativo ?? true,
  };
}

function validarPadrao(corpo) {
  if (typeof corpo?.exibir !== 'boolean') throw new ErroRequisicao(400, 'Informe se o banner padrão será exibido.');
  return { exibir: corpo.exibir, botao: botao(corpo.botao) };
}

// ---------- leitura

const paraBanner = (linha) => ({
  id: linha.id,
  nome: linha.nome,
  imagem: linha.imagem,
  enquadramento: { x: linha.enq_x, y: linha.enq_y },
  textoSuperior: { texto: linha.texto_superior, visivel: linha.texto_superior_visivel === 1 },
  titulo: { texto: linha.titulo, visivel: linha.titulo_visivel === 1 },
  botao: linha.botao,
  ativo: linha.ativo === 1,
  ordem: linha.ordem,
  criadoEm: linha.criado_em,
  atualizadoEm: linha.atualizado_em,
});

const COLUNAS = `id, nome, imagem, enq_x, enq_y, texto_superior, texto_superior_visivel, titulo, titulo_visivel,
  botao, ativo, ordem, criado_em, atualizado_em`;

async function lerAjustePadrao() {
  const [linhas] = await database.execute('SELECT valor FROM configuracoes WHERE chave = ? LIMIT 1', [CHAVE_PADRAO]);
  if (!linhas[0]) return { ...AJUSTE_PADRAO };
  const valor = typeof linhas[0].valor === 'string' ? JSON.parse(linhas[0].valor) : linhas[0].valor;
  return {
    exibir: typeof valor.exibir === 'boolean' ? valor.exibir : AJUSTE_PADRAO.exibir,
    botao: BOTOES.includes(valor.botao) ? valor.botao : AJUSTE_PADRAO.botao,
  };
}

async function listarBanners() {
  const [linhas] = await database.execute(`SELECT ${COLUNAS} FROM banners_home ORDER BY ordem, id`);
  return linhas.map(paraBanner);
}

async function buscarBanner(id) {
  const [linhas] = await database.execute(`SELECT ${COLUNAS} FROM banners_home WHERE id = ? LIMIT 1`, [id]);
  if (!linhas[0]) throw new ErroRequisicao(404, 'Banner não encontrado.');
  return paraBanner(linhas[0]);
}

/** Tudo o que a tela administrativa precisa: o ajuste do padrão e todos os banners (ativos ou não). */
async function painelDosBanners() {
  return { padrao: await lerAjustePadrao(), banners: await listarBanners() };
}

// Banner original, na forma que o aplicativo desenha. Os textos originais nunca mudam.
const slidePadrao = (botaoDoPadrao) => ({
  id: null,
  modo: 'padrao',
  imagem: null,
  enquadramento: { x: 50, y: 50 },
  textoSuperior: { texto: TEXTO_SUPERIOR, visivel: true },
  titulo: { texto: TITULO, visivel: true },
  botao: botaoDoPadrao,
  atualizadoEm: null,
});

/**
 * Lista final do carrossel, na ordem em que aparece na Home: o banner padrão primeiro (se estiver
 * habilitado), depois os personalizados ativos. Sem nenhum personalizado ativo, o padrão aparece
 * sempre, mesmo desabilitado: a Home nunca fica sem banner.
 */
async function slidesPublicos() {
  const [ajuste, banners] = await Promise.all([lerAjustePadrao(), listarBanners()]);
  const personalizados = banners
    .filter((banner) => banner.ativo)
    .map((banner) => ({
      id: banner.id,
      modo: 'personalizado',
      imagem: banner.imagem,
      enquadramento: banner.enquadramento,
      textoSuperior: banner.textoSuperior,
      titulo: banner.titulo,
      botao: banner.botao,
      atualizadoEm: banner.atualizadoEm,
    }));
  if (personalizados.length === 0) return [slidePadrao(ajuste.botao)];
  return ajuste.exibir ? [slidePadrao(ajuste.botao), ...personalizados] : personalizados;
}

// ---------- escrita

const valoresDe = (config) => [
  config.nome,
  config.imagem,
  config.enquadramento.x,
  config.enquadramento.y,
  config.textoSuperior.texto,
  config.textoSuperior.visivel ? 1 : 0,
  config.titulo.texto,
  config.titulo.visivel ? 1 : 0,
  config.botao,
  config.ativo ? 1 : 0,
];

async function criarBanner(config) {
  const [[{ total }]] = await database.execute('SELECT COUNT(*) AS total FROM banners_home');
  if (Number(total) >= MAX_BANNERS) {
    throw new ErroRequisicao(409, `A Home aceita até ${MAX_BANNERS} banners personalizados. Exclua algum para adicionar outro.`);
  }
  const [resultado] = await database.execute(
    `INSERT INTO banners_home (nome, imagem, enq_x, enq_y, texto_superior, texto_superior_visivel, titulo,
       titulo_visivel, botao, ativo, ordem)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(MAX(ordem), 0) + 1 FROM banners_home`,
    valoresDe(config),
  );
  return resultado.insertId;
}

async function atualizarBanner(id, config) {
  await database.execute(
    `UPDATE banners_home SET nome = ?, imagem = ?, enq_x = ?, enq_y = ?, texto_superior = ?,
       texto_superior_visivel = ?, titulo = ?, titulo_visivel = ?, botao = ?, ativo = ? WHERE id = ?`,
    [...valoresDe(config), id],
  );
}

async function definirAtivo(id, ativo) {
  await database.execute('UPDATE banners_home SET ativo = ? WHERE id = ?', [ativo ? 1 : 0, id]);
}

async function excluirBanner(id) {
  await database.execute('DELETE FROM banners_home WHERE id = ?', [id]);
}

// A nova ordem precisa listar exatamente os banners existentes: evita perder um banner por lista velha.
async function reordenarBanners(ids) {
  const existentes = (await listarBanners()).map((banner) => banner.id);
  if (ids.length !== existentes.length || !ids.every((id) => existentes.includes(id))) {
    throw new ErroRequisicao(409, 'A lista mudou. Atualize a tela e tente novamente.');
  }
  await database.query(
    `UPDATE banners_home SET ordem = CASE id ${ids.map(() => 'WHEN ? THEN ?').join(' ')} END WHERE id IN (?)`,
    [...ids.flatMap((id, indice) => [id, indice + 1]), ids],
  );
}

async function gravarAjustePadrao(ajuste, usuarioId) {
  await database.execute(
    `INSERT INTO configuracoes (chave, valor, atualizado_por) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE valor = VALUES(valor), atualizado_por = VALUES(atualizado_por)`,
    [CHAVE_PADRAO, JSON.stringify(ajuste), usuarioId],
  );
}

/**
 * Converte o banner único das versões anteriores (configuracoes.banner_home) para o carrossel:
 * um banner personalizado publicado vira o primeiro banner da lista, com a mesma imagem, e o
 * banner padrão continua habilitado ou não como estava; a cor do botão do padrão é mantida.
 * Só age se ainda existir a configuração antiga, que é apagada ao final.
 */
async function migrarBannerUnico() {
  const [linhas] = await database.execute("SELECT valor FROM configuracoes WHERE chave = 'banner_home' LIMIT 1");
  if (!linhas[0]) return false;
  const antigo = typeof linhas[0].valor === 'string' ? JSON.parse(linhas[0].valor) : linhas[0].valor;
  const personalizado = antigo.modo === 'personalizado' && URL_DE_IMAGEM.test(antigo.imagem ?? '');

  if (personalizado) {
    const config = {
      nome: 'Banner publicado',
      imagem: antigo.imagem,
      enquadramento: antigo.enquadramento ?? { x: 50, y: 50 },
      textoSuperior: antigo.textoSuperior ?? { texto: TEXTO_SUPERIOR, visivel: true },
      titulo: antigo.titulo ?? { texto: TITULO, visivel: true },
      botao: BOTOES.includes(antigo.botao) ? antigo.botao : 'champagne',
      ativo: true,
    };
    const [existente] = await database.execute('SELECT 1 FROM banners_home WHERE imagem = ? LIMIT 1', [config.imagem]);
    if (existente.length === 0) await criarBanner(config);
  }
  const ajuste = {
    exibir: !personalizado,
    botao: !personalizado && BOTOES.includes(antigo.botao) ? antigo.botao : 'champagne',
  };
  await gravarAjustePadrao(ajuste, null);
  await database.execute("DELETE FROM configuracoes WHERE chave = 'banner_home'");
  return true;
}

module.exports = {
  validarBanner,
  validarPadrao,
  painelDosBanners,
  buscarBanner,
  slidesPublicos,
  criarBanner,
  atualizarBanner,
  definirAtivo,
  excluirBanner,
  reordenarBanners,
  gravarAjustePadrao,
  migrarBannerUnico,
};
