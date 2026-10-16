process.env.JWT_SECRET = 'segredo-usado-apenas-nos-testes-automatizados';

const assert = require('node:assert/strict');
const { once } = require('node:events');
const { test } = require('node:test');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const database = require('../src/config/database');

test('POST /api/usuarios/login', async (t) => {
  const server = app.listen(0, '127.0.0.1');
  const originalExecute = database.execute;

  t.after(async () => {
    database.execute = originalExecute;
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await database.end();
  });

  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}/api/usuarios/login`;
  const post = (body) => fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const senha = ' Teste@1234 ';
  const credenciais = { email: "jo'ana@example.com", senha };
  const usuario = {
    id: 42,
    nome: 'Joana',
    email: credenciais.email,
    telefone: '71999999999',
    senha: await bcrypt.hash(senha, 12),
    tipo: 'aluno',
    status: 'ativo',
  };
  const erroSenha = { message: 'Senha incorreta.' };

  await t.test('valida os campos antes de consultar o banco', async () => {
    let calls = 0;
    database.execute = async () => { calls += 1; };

    for (const body of [{}, { email: credenciais.email }, { senha }, { email: true, senha: 123 }, { email: ' ', senha: ' ' }]) {
      const response = await post(body);
      assert.equal(response.status, 400);
      assert.ok((await response.json()).campos.length > 0);
    }

    for (const fields of [{ email: 'email-invalido' }, { email: `${'x'.repeat(140)}@example.com` }, { senha: 'é'.repeat(37) }]) {
      const response = await post({ ...credenciais, ...fields });
      assert.equal(response.status, 400);
      await response.json();
    }

    const response = await fetch(url, { method: 'POST' });
    assert.equal(response.status, 400);
    await response.json();
    assert.equal(calls, 0);
  });

  await t.test('rejeita e-mail não cadastrado com 404 e mensagem específica', async () => {
    database.execute = async () => [[]];
    const response = await post(credenciais);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { message: 'E-mail não cadastrado.' });
  });

  await t.test('rejeita senha incorreta e preserva espaços na comparação', async () => {
    database.execute = async () => [[usuario]];
    for (const senhaIncorreta of ['SenhaIncorreta', senha.trim()]) {
      const response = await post({ ...credenciais, senha: senhaIncorreta });
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), erroSenha);
    }
  });

  await t.test('consulta por parâmetros e retorna apenas os dados públicos', async () => {
    let calls = 0;
    database.execute = async (sql, parameters) => {
      calls += 1;
      assert.equal(sql, 'SELECT id, nome, email, telefone, foto_perfil, senha, tipo, status FROM usuarios WHERE email = ? LIMIT 1');
      assert.deepEqual(parameters, [credenciais.email]);
      return [[{ ...usuario, foto_perfil: 'https://example.com/foto.jpg', criado_em: 'valor privado' }]];
    };

    const response = await post({ ...credenciais, email: ` ${credenciais.email} ` });
    assert.equal(response.status, 200);
    const { token, ...resultado } = await response.json();
    assert.deepEqual(resultado, {
      message: 'Login realizado com sucesso.',
      usuario: {
        id: usuario.id,
        nome: usuario.nome,
        email: usuario.email,
        telefone: usuario.telefone,
        fotoPerfil: 'https://example.com/foto.jpg',
        role: 'USER',
      },
    });
    const sessao = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    assert.equal(sessao.sub, String(usuario.id));
    assert.ok(sessao.exp > sessao.iat);
    assert.deepEqual(Object.keys(sessao).sort(), ['exp', 'iat', 'sub']);
    assert.equal(calls, 1);
  });

  await t.test('informa o perfil ADMIN somente quando o banco indica tipo admin', async () => {
    for (const [tipo, role] of [['admin', 'ADMIN'], ['aluno', 'USER'], [null, 'USER']]) {
      database.execute = async () => [[{ ...usuario, tipo }]];
      const response = await post({ ...credenciais, role: 'ADMIN', tipo: 'admin' });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).usuario.role, role);
    }
  });

  await t.test('não emite sessão quando o segredo de assinatura não está configurado', async () => {
    const segredo = process.env.JWT_SECRET;
    t.after(() => { process.env.JWT_SECRET = segredo; });
    database.execute = async () => [[usuario]];

    for (const valor of ['', 'curto']) {
      process.env.JWT_SECRET = valor;
      const response = await post(credenciais);
      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), { message: 'Não foi possível realizar o login.' });
    }
    process.env.JWT_SECRET = segredo;
  });

  await t.test('rejeita contas inativas ou bloqueadas após conferir a senha', async () => {
    for (const status of ['inativo', 'bloqueado', null]) {
      database.execute = async () => [[{ ...usuario, status }]];
      const response = await post(credenciais);
      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), { message: 'Usuário inativo ou bloqueado.' });
    }

    database.execute = async () => [[{ ...usuario, status: 'bloqueado' }]];
    const response = await post({ ...credenciais, senha: 'SenhaIncorreta' });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), erroSenha);
  });

  await t.test('não aceita senha armazenada em texto puro como credencial válida', async () => {
    database.execute = async () => [[{ ...usuario, senha }]];
    const response = await post(credenciais);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), erroSenha);
  });

  await t.test('trata falha no banco sem retornar detalhes privados', async () => {
    database.execute = async () => {
      throw Object.assign(new Error('Detalhes privados do banco'), { code: 'ER_ACCESS_DENIED_ERROR' });
    };
    const response = await post(credenciais);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { message: 'Não foi possível realizar o login.' });
  });

  await t.test('rejeita JSON malformado antes de consultar o banco', async () => {
    let calls = 0;
    database.execute = async () => { calls += 1; };
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"email":' });
    assert.equal(response.status, 400);
    await response.json();
    assert.equal(calls, 0);
  });
});
