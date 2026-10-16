const { ErroRequisicao, rota, idDaRota, listaDeIds } = require('../utils/http');
const { removerImagensSemUso } = require('../utils/cursos');
const banners = require('../utils/bannerHome');

// Tudo aqui é exclusivo de ADMIN (a rota exige sessão e permissão). Cada alteração vale para todos
// os usuários assim que é gravada; a imagem antiga só é descartada depois da gravação, então uma
// falha no meio mantém o que já estava publicado.

const listar = rota(async (req, res) => {
  res.json(await banners.painelDosBanners());
});

const criar = rota(async (req, res) => {
  const config = banners.validarBanner(req.body);
  const id = await banners.criarBanner(config);
  res.status(201).json({ banner: await banners.buscarBanner(id) });
});

const atualizar = rota(async (req, res) => {
  const id = idDaRota(req.params.id);
  const anterior = await banners.buscarBanner(id);
  const config = banners.validarBanner({ ativo: anterior.ativo, ...req.body });
  await banners.atualizarBanner(id, config);
  if (anterior.imagem !== config.imagem) await removerImagensSemUso([anterior.imagem]);
  res.json({ banner: await banners.buscarBanner(id) });
});

const alterarStatus = rota(async (req, res) => {
  const id = idDaRota(req.params.id);
  if (typeof req.body?.ativo !== 'boolean') throw new ErroRequisicao(400, 'O campo ativo deve ser verdadeiro ou falso.');
  await banners.buscarBanner(id);
  await banners.definirAtivo(id, req.body.ativo);
  res.json({ banner: await banners.buscarBanner(id) });
});

const reordenar = rota(async (req, res) => {
  await banners.reordenarBanners(listaDeIds(req.body?.ids));
  res.json(await banners.painelDosBanners());
});

const excluir = rota(async (req, res) => {
  const id = idDaRota(req.params.id);
  const anterior = await banners.buscarBanner(id);
  await banners.excluirBanner(id);
  await removerImagensSemUso([anterior.imagem]);
  res.json({ message: 'Banner excluído.' });
});

// O banner padrão não é uma linha da tabela e não tem rota de exclusão: só se ajusta se participa
// do carrossel e a cor do seu botão.
const ajustarPadrao = rota(async (req, res) => {
  const ajuste = banners.validarPadrao(req.body);
  await banners.gravarAjustePadrao(ajuste, req.usuario.id);
  res.json(await banners.painelDosBanners());
});

module.exports = { listar, criar, atualizar, alterarStatus, reordenar, excluir, ajustarPadrao };
