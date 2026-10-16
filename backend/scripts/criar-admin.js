// Provisiona a primeira conta administrativa.
//
// Uso interativo (recomendado):  npm run criar-admin
// Uso não interativo:            defina ADMIN_NOME, ADMIN_EMAIL e ADMIN_SENHA no ambiente
//
// A senha nunca é exibida nem registrada. Se o e-mail já existir, nada é alterado.
const readline = require('node:readline');
const bcrypt = require('bcrypt');
const database = require('../src/config/database');
const { CUSTO_BCRYPT } = require('../src/config/auth');

const SENHA_MINIMA = 12;

function criarPrompt() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const linhas = [];
  let aguardando = null;
  let encerrado = false;
  let oculto = false;

  // Enquanto uma senha é digitada, nada do que o readline ecoaria chega ao terminal.
  const escrever = rl._writeToOutput.bind(rl);
  rl._writeToOutput = (texto) => {
    if (!oculto) escrever(texto);
  };

  rl.on('line', (linha) => {
    if (!aguardando) return linhas.push(linha);
    const { resolve } = aguardando;
    aguardando = null;
    return resolve(linha);
  });
  rl.on('close', () => {
    encerrado = true;
    aguardando?.reject(new Error('A entrada foi encerrada antes de concluir. Nenhuma alteração foi feita.'));
  });

  async function perguntar(pergunta, { oculto: ocultar = false } = {}) {
    rl.setPrompt(pergunta);
    rl.prompt();
    oculto = ocultar;
    try {
      if (linhas.length > 0) return linhas.shift();
      if (encerrado) throw new Error('A entrada foi encerrada antes de concluir. Nenhuma alteração foi feita.');
      return await new Promise((resolve, reject) => {
        aguardando = { resolve, reject };
      });
    } finally {
      oculto = false;
      if (ocultar) process.stdout.write('\n');
    }
  }

  return { perguntar, fechar: () => rl.close() };
}

async function lerDados() {
  const { ADMIN_NOME, ADMIN_EMAIL, ADMIN_SENHA } = process.env;
  if (ADMIN_NOME && ADMIN_EMAIL && ADMIN_SENHA) {
    return { nome: ADMIN_NOME, email: ADMIN_EMAIL, senha: ADMIN_SENHA };
  }

  if (!process.stdin.isTTY) {
    throw new Error(
      'Execute em um terminal interativo ou defina ADMIN_NOME, ADMIN_EMAIL e ADMIN_SENHA no ambiente.',
    );
  }

  const { perguntar, fechar } = criarPrompt();
  try {
    const nome = await perguntar('Nome da administradora: ');
    const email = await perguntar('E-mail: ');
    const senha = await perguntar(`Senha (mínimo de ${SENHA_MINIMA} caracteres): `, { oculto: true });
    const confirmacao = await perguntar('Confirme a senha: ', { oculto: true });
    if (senha !== confirmacao) throw new Error('As senhas não conferem. Nenhuma alteração foi feita.');
    return { nome, email, senha };
  } finally {
    fechar();
  }
}

function validar({ nome, email, senha }) {
  const dados = { nome: nome.trim(), email: email.trim(), senha };
  if (!dados.nome || dados.nome.length > 150) throw new Error('Informe um nome com até 150 caracteres.');
  if (dados.email.length > 150 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dados.email)) {
    throw new Error('Informe um e-mail válido com até 150 caracteres.');
  }
  if ([...senha].length < SENHA_MINIMA) {
    throw new Error(`A senha deve ter pelo menos ${SENHA_MINIMA} caracteres.`);
  }
  if (Buffer.byteLength(senha, 'utf8') > 72) throw new Error('A senha é longa demais. Use uma senha mais curta.');
  return dados;
}

async function criarAdmin() {
  const { nome, email, senha } = validar(await lerDados());

  const [existentes] = await database.execute('SELECT id, tipo FROM usuarios WHERE email = ? LIMIT 1', [email]);
  if (existentes[0]) {
    if (existentes[0].tipo === 'admin') {
      console.log(`A conta administrativa ${email} já existe. Nenhuma alteração foi feita.`);
      return 0;
    }
    console.error(
      `Já existe uma conta comum com o e-mail ${email}. Nenhuma alteração foi feita: use outro e-mail para a administradora.`,
    );
    return 1;
  }

  try {
    const senhaHash = await bcrypt.hash(senha, CUSTO_BCRYPT);
    const [resultado] = await database.execute(
      "INSERT INTO usuarios (nome, email, senha, tipo) VALUES (?, ?, ?, 'admin')",
      [nome, email, senhaHash],
    );
    console.log(`Conta administrativa criada: ${email} (id ${resultado.insertId}).`);
    return 0;
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      console.error(`O e-mail ${email} acabou de ser cadastrado por outra operação. Nenhuma alteração foi feita.`);
      return 1;
    }
    throw error;
  }
}

criarAdmin()
  .catch((error) => {
    console.error('Não foi possível criar a conta administrativa:', error.code || error.message);
    return 1;
  })
  .then(async (codigo) => {
    await database.end();
    process.exitCode = codigo;
  });
