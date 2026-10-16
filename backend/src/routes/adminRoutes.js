const express = require('express');
const categorias = require('../controllers/adminCategoriaController');
const comercial = require('../controllers/adminComercialController');
const personalizacao = require('../controllers/adminPersonalizacaoController');
const conteudo = require('../controllers/adminConteudoController');
const cursos = require('../controllers/adminCursoController');
const { receberUpload } = require('../controllers/uploadController');
const { autenticar, exigirAdmin } = require('../middlewares/auth');

const router = express.Router();

// Toda rota administrativa exige sessão válida e permissão ADMIN.
router.use(autenticar, exigirAdmin);

router.get('/categorias', categorias.listarCategorias);
router.post('/categorias', categorias.criarCategoria);
router.put('/categorias/ordem', categorias.reordenarCategorias);
router.put('/categorias/:id', categorias.atualizarCategoria);
router.delete('/categorias/:id', categorias.excluirCategoria);

router.get('/cursos/indicadores', cursos.indicadoresCursos);
router.get('/cursos', cursos.listarCursos);
router.post('/cursos', cursos.criarCurso);
router.get('/cursos/:id', cursos.obterCurso);
router.put('/cursos/:id', cursos.atualizarCurso);
router.put('/cursos/:id/status', cursos.alterarStatus);
router.delete('/cursos/:id', cursos.excluirCurso);

router.post('/cursos/:cursoId/modulos', conteudo.criarModulo);
router.put('/cursos/:cursoId/modulos/ordem', conteudo.reordenarModulos);
router.put('/modulos/:id', conteudo.atualizarModulo);
router.delete('/modulos/:id', conteudo.excluirModulo);

router.post('/cursos/:cursoId/aulas', conteudo.criarAula);
router.put('/modulos/:id/aulas/ordem', conteudo.reordenarAulas);
router.put('/aulas/:id', conteudo.atualizarAula);
router.delete('/aulas/:id', conteudo.excluirAula);

// Vendas e direitos de acesso. Não há rota que altere um pagamento: a situação de uma compra
// só muda pela confirmação do provedor.
router.get('/comercial/resumo', comercial.resumoComercial);
router.get('/pedidos', comercial.listarPedidos);
router.get('/acessos', comercial.listarAcessos);
router.post('/acessos', comercial.liberarAcesso);
router.post('/acessos/revogar', comercial.revogar);
router.get('/alunos', comercial.buscarAlunos);

// Personalização do aplicativo: carrossel de banners da Home. O banner padrão só tem ajuste, não exclusão.
router.get('/personalizacao/banners', personalizacao.listar);
router.post('/personalizacao/banners', personalizacao.criar);
router.put('/personalizacao/banners/ordem', personalizacao.reordenar);
router.put('/personalizacao/banners/padrao', personalizacao.ajustarPadrao);
router.put('/personalizacao/banners/:id', personalizacao.atualizar);
router.put('/personalizacao/banners/:id/status', personalizacao.alterarStatus);
router.delete('/personalizacao/banners/:id', personalizacao.excluir);

// :tipo = imagem | video | audio. O corpo da requisição é o próprio arquivo.
router.post('/uploads/:tipo', receberUpload);

module.exports = router;
