const express = require('express');
const aulas = require('../controllers/aulaController');
const catalogo = require('../controllers/catalogoController');
const pedidos = require('../controllers/pedidoController');
const termos = require('../controllers/termosController');
const miniaturas = require('../controllers/miniaturaController');
const { autenticar, autenticarMidia, autenticarMiniatura, autenticarOpcional } = require('../middlewares/auth');

const router = express.Router();

// Apresentação pública dos conteúdos publicados.
router.get('/home', catalogo.home);
router.get('/categorias', catalogo.listarCategorias);
router.get('/cursos', catalogo.listarCursos);
router.get('/cursos/:id', autenticarOpcional, catalogo.detalharCurso);

// Aulas: exigem sessão e direito de acesso ao curso.
router.get('/aulas/:id', autenticar, aulas.obterAula);
router.get('/aulas/:id/miniatura', autenticarMiniatura, miniaturas.obter);
router.get('/aulas/:id/midia', autenticarMidia, aulas.transmitirMidia);
router.post('/aulas/:id/progresso', autenticar, aulas.registrarProgresso);
// Aulas de vídeo: cada vídeo tem a sua reprodução e o seu progresso.
router.get('/aulas/:id/videos/:videoId/midia', autenticarMidia, aulas.transmitirVideo);
router.post('/aulas/:id/videos/:videoId/progresso', autenticar, aulas.registrarProgressoDoVideo);

// Termos de Uso e Política de Privacidade: leitura pública; o aceite exige sessão.
router.get('/termos', autenticarOpcional, termos.obterTermos);
router.post('/termos/aceite', autenticar, termos.aceitarTermos);
router.get('/privacidade', termos.obterPrivacidade);

// Compra de cursos pagos e cursos do aluno. Tudo aqui vale só para o próprio usuário da sessão.
router.get('/cursos/:id/oferta', autenticar, pedidos.obterOferta);
router.get('/meus-cursos', autenticar, pedidos.meusCursos);
router.get('/pedidos', autenticar, pedidos.listarPedidos);
router.post('/pedidos', autenticar, pedidos.criarPedido);
router.get('/pedidos/:id', autenticar, pedidos.obterPedido);
router.post('/pedidos/:id/cancelar', autenticar, pedidos.cancelarPedido);

// Webhook do provedor de pagamentos: sem sessão; a autenticidade vem da assinatura da notificação.
router.post('/pagamentos/notificacoes/:provedor', pedidos.receberNotificacao);

module.exports = router;
