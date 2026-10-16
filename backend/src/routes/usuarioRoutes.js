const express = require('express');
const { criarUsuario, loginUsuario, usuarioAutenticado } = require('../controllers/usuarioController');
const { enviarFoto, removerFoto } = require('../controllers/fotoPerfilController');
const { autenticar } = require('../middlewares/auth');

const router = express.Router();

router.post('/', criarUsuario);
router.post('/login', loginUsuario);
router.get('/me', autenticar, usuarioAutenticado);

// Foto de perfil do próprio usuário (administradores e alunos). O corpo do POST é a própria imagem.
router.post('/me/foto', autenticar, enviarFoto);
router.delete('/me/foto', autenticar, removerFoto);

module.exports = router;
