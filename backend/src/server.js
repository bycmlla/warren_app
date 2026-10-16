const http = require('node:http');
const app = require('./app');
const database = require('./config/database');
const { garantirPastas } = require('./config/storage');
const port = process.env.PORT || 3000;

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('JWT_SECRET ausente ou curto no .env: o login não emitirá sessões até ser configurado.');
}

database.execute('SELECT 1')
  .then(() => {
    console.log('Conexão com MySQL estabelecida.');
  })
  .catch((error) => {
    console.error('Erro ao conectar ao MySQL:', error.code || error.name);
  });

garantirPastas();

// Por padrão o Node encerra (408) qualquer requisição que leve mais de 5 minutos para chegar
// inteira, o que interrompe o envio de vídeos grandes em conexões lentas. O prazo passa a ser de
// 2 horas (ajustável por UPLOAD_TIMEOUT_MIN). Ele precisa ser informado na criação do servidor:
// alterá-lo depois não tem efeito. O prazo dos cabeçalhos, que protege contra conexões abertas
// sem enviar nada, continua o padrão.
const minutos = Number(process.env.UPLOAD_TIMEOUT_MIN);
const requestTimeout = (Number.isFinite(minutos) && minutos > 0 ? minutos : 120) * 60 * 1000;

http.createServer({ requestTimeout }, app).listen(port, () => {
  console.log(`Backend rodando em http://localhost:${port}`);
}).on('error', (error) => {
  console.error('Erro ao iniciar o backend:', error.message);
  process.exitCode = 1;
});
