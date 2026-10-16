const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { TIPOS, pasta, garantirPastas, assinaturaValida, duracaoDaMidia } = require('../config/storage');
const { prepararVideo } = require('../utils/prepararVideo');

const megabytes = (bytes) => Math.round(bytes / 1024 / 1024);

// Recebe o arquivo como corpo bruto da requisição (Content-Type = tipo do arquivo) e grava em
// disco conforme chega, sem carregar tudo em memória. Rota exclusiva de ADMIN.
function receberArquivo(req, res, tipo, concluir) {

  const declarado = (req.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const extensao = tipo.formatos[declarado];
  if (!extensao) {
    return res.status(415).json({
      message: `Formato não aceito. Envie um arquivo ${[...new Set(Object.values(tipo.formatos))].join(', ')}.`,
    });
  }

  const grande = { message: `O arquivo excede o limite de ${megabytes(tipo.limite)} MB.` };
  if (Number(req.get('content-length')) > tipo.limite) {
    return res.status(413).set('Connection', 'close').json(grande);
  }

  garantirPastas();
  const nome = `${crypto.randomBytes(16).toString('hex')}.${extensao}`;
  const destino = path.join(pasta(tipo.pasta), nome);
  const parcial = `${destino}.parcial`;
  const saida = fs.createWriteStream(parcial);
  let recebido = 0;
  let inicio = Buffer.alloc(0);
  let encerrado = false;

  const removerGravado = () => fs.rm(destino, { force: true }, () => undefined);

  const falhar = (status, corpo) => {
    if (encerrado) return;
    encerrado = true;
    req.removeAllListeners('data');
    req.resume();
    saida.destroy();
    fs.rm(parcial, { force: true }, () => undefined);
    if (!res.headersSent) res.status(status).set('Connection', 'close').json(corpo);
  };

  req.on('data', (parte) => {
    recebido += parte.length;
    if (recebido > tipo.limite) return falhar(413, grande);
    if (inicio.length < 16) inicio = Buffer.concat([inicio, parte]).subarray(0, 16);
    if (!saida.write(parte)) {
      req.pause();
      saida.once('drain', () => req.resume());
    }
    return undefined;
  });
  req.on('aborted', () => falhar(400, { message: 'O envio foi interrompido.' }));
  req.on('error', () => falhar(400, { message: 'O envio foi interrompido.' }));
  saida.on('error', (error) => {
    console.error('Erro ao gravar upload:', error.code || error.name);
    falhar(500, { message: 'Não foi possível salvar o arquivo.' });
  });

  req.on('end', () => {
    if (encerrado) return;
    saida.end(() => {
      if (encerrado) return;
      if (recebido === 0 || !assinaturaValida(extensao, inicio)) {
        return falhar(415, { message: 'O conteúdo do arquivo não corresponde ao formato informado.' });
      }
      encerrado = true;
      return fs.rename(parcial, destino, (error) => {
        if (error) {
          console.error('Erro ao concluir upload:', error.code || error.name);
          fs.rm(parcial, { force: true }, () => undefined);
          return res.status(500).json({ message: 'Não foi possível salvar o arquivo.' });
        }
        if (concluir) return concluir(res, { nome, tamanho: recebido, falhar: removerGravado });
        if (tipo.pasta === 'imagens') {
          return res.status(201).json({ arquivo: nome, tamanho: recebido, url: `/arquivos/imagens/${nome}` });
        }
        // Vídeos e áudios: a duração é lida do próprio arquivo (null se o formato não a informa).
        if (req.params.tipo === 'video') void prepararVideo(nome);
        return duracaoDaMidia(nome).then((duracaoSegundos) =>
          res.status(201).json({ arquivo: nome, tamanho: recebido, duracaoSegundos }),
        );
      });
    });
  });

  return undefined;
}

function receberUpload(req, res) {
  const tipo = TIPOS[req.params.tipo];
  if (!tipo || req.params.tipo === 'perfil') return res.status(404).json({ message: 'Tipo de arquivo desconhecido.' });
  return receberArquivo(req, res, tipo);
}

module.exports = { receberUpload, receberArquivo };
