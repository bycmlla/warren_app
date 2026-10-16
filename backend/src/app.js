const express = require('express');
const cors = require('cors');
const usuarioRoutes = require('./routes/usuarioRoutes');
const adminRoutes = require('./routes/adminRoutes');
const catalogoRoutes = require('./routes/catalogoRoutes');
const { pasta } = require('./config/storage');

const app = express();

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ message: 'Backend funcionando!' });
});

app.use('/api/usuarios', usuarioRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', catalogoRoutes);

// Capas e banners são públicos; vídeos e áudios só saem por /api/aulas/:id/midia.
app.use('/arquivos/imagens', express.static(pasta('imagens'), { index: false, maxAge: '30d', immutable: true }));

app.use((error, req, res, next) => {
  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ message: 'O corpo da requisição deve conter um JSON válido.' });
  }

  if (error.type === 'entity.too.large') {
    return res.status(413).json({ message: 'O corpo da requisição excede o tamanho permitido.' });
  }

  console.error('Erro na requisição:', error.code || error.name);
  return res.status(500).json({ message: 'Erro interno do servidor.' });
});

module.exports = app;
