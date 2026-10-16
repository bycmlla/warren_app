// Publica uma versão dos Termos de Uso ou da Política de Privacidade a partir de um arquivo de texto.
//
// Uso:
//   npm run publicar-documento -- termos 1.0 2026-11-01 caminho/termos-de-uso.txt
//   npm run publicar-documento -- privacidade 1.0 2026-11-01 caminho/politica.txt
//   npm run publicar-documento -- termos 1.1 2027-01-15 caminho/termos.txt --sem-novo-aceite
//
// Argumentos: tipo, versão, data de vigência (AAAA-MM-DD) e arquivo (UTF-8; texto simples ou
// Markdown básico: títulos com #, listas com -, negrito com ** e citações com >).
// A versão passa a valer na data de vigência. Por padrão, uma nova versão dos termos exige que
// cada aluno aceite de novo antes da próxima compra; use --sem-novo-aceite para correções que
// não mudam direitos nem obrigações. Uma versão publicada não é alterada nem apagada por aqui:
// mudanças no texto entram como nova versão.
const { createHash } = require('node:crypto');
const { readFile } = require('node:fs/promises');
const database = require('../src/config/database');

const TIPOS = { termos: 'Termos de Uso', privacidade: 'Política de Privacidade' };

async function publicar() {
  const argumentos = process.argv.slice(2);
  const semNovoAceite = argumentos.includes('--sem-novo-aceite');
  const [tipo, versao, vigencia, arquivo] = argumentos.filter((argumento) => !argumento.startsWith('--'));

  if (!TIPOS[tipo] || !versao || !vigencia || !arquivo) {
    throw new Error('Uso: npm run publicar-documento -- <termos|privacidade> <versão> <AAAA-MM-DD> <arquivo>');
  }
  if (versao.length > 20) throw new Error('A versão aceita até 20 caracteres (ex.: 1.0).');
  const data = /^\d{4}-\d{2}-\d{2}$/.test(vigencia) ? new Date(`${vigencia}T00:00:00Z`) : null;
  if (!data || Number.isNaN(data.getTime()) || data.toISOString().slice(0, 10) !== vigencia) {
    throw new Error('Informe a data de vigência no formato AAAA-MM-DD.');
  }

  const texto = (await readFile(arquivo, 'utf8')).replace(/^﻿/, '').replace(/\r\n/g, '\n').trim();
  if (texto.length < 200) throw new Error('O arquivo está vazio ou curto demais para ser o documento integral.');
  const hash = createHash('sha256').update(texto, 'utf8').digest('hex');

  try {
    await database.execute(
      `INSERT INTO documentos_legais (tipo, versao, vigente_desde, texto, hash, exige_novo_aceite)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [tipo, versao, vigencia, texto, hash, semNovoAceite ? 0 : 1],
    );
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      throw new Error(`A versão ${versao} de ${TIPOS[tipo]} já foi publicada. Use um novo número de versão.`);
    }
    throw error;
  }

  console.log(`${TIPOS[tipo]} — versão ${versao} publicada, vigente a partir de ${vigencia}.`);
  console.log(`Identificador do documento (SHA-256): ${hash}`);
  if (tipo === 'termos') {
    console.log(
      semNovoAceite
        ? 'Quem já aceitou a versão anterior não precisará aceitar esta.'
        : 'Cada aluno precisará aceitar esta versão antes de iniciar um curso ou uma compra.',
    );
  }
}

publicar()
  .then(() => 0)
  .catch((error) => {
    console.error(error.code ? `Não foi possível publicar: ${error.code}` : error.message);
    return 1;
  })
  .then(async (codigo) => {
    await database.end();
    process.exitCode = codigo;
  });
