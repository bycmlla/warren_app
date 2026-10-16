process.env.JWT_SECRET = 'segredo-usado-apenas-nos-testes-automatizados';

const assert = require('node:assert/strict');
const { once } = require('node:events');
const { test } = require('node:test');
const bcrypt = require('bcrypt');
const app = require('../src/app');
const database = require('../src/config/database');

test('POST /api/usuarios', async (t) => {
  const server = app.listen(0, '127.0.0.1');
  const originalExecute = database.execute;

  t.after(async () => {
    database.execute = originalExecute;
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await database.end();
  });

  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}/api/usuarios`;
  const post = (body) => fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const cadastroValido = { nome: 'Joana', email: 'joana@example.com', senha: 'Teste@1234' };

  await t.test('rejeita campos obrigatórios ausentes ou de tipo inválido sem consultar o banco', async () => {
    let calls = 0;
    database.execute = async () => { calls += 1; };

    for (const body of [{}, { nome: 'Joana' }, { email: 'joana@example.com' }, { nome: ' ', email: ' ', senha: ' ' }, { nome: 123, email: true, senha: 123 }, { nome: 'Joana', email: 'joana@example.com' }]) {
      const response = await post(body);
      assert.equal(response.status, 400);
      const result = await response.json();
      assert.ok(result.campos.length > 0);
    }

    const response = await fetch(url, { method: 'POST' });
    assert.equal(response.status, 400);
    await response.json();
    assert.equal(calls, 0);
  });

  await t.test('rejeita e-mail inválido e valores acima dos limites', async () => {
    let calls = 0;
    database.execute = async () => { calls += 1; };

    for (const body of [
      { nome: 'Joana', email: 'email-invalido' },
      { nome: 'x'.repeat(151), email: 'joana@example.com' },
      { nome: 'Joana', email: `${'x'.repeat(140)}@example.com` },
    ]) {
      const response = await post({ ...cadastroValido, ...body });
      assert.equal(response.status, 400);
      await response.json();
    }

    assert.equal(calls, 0);
  });

  await t.test('rejeita senha curta, senha acima de 72 bytes e telefone inválido', async () => {
    let calls = 0;
    database.execute = async () => { calls += 1; };

    for (const fields of [
      { senha: 'curta' },
      { senha: 'x'.repeat(73) },
      { senha: 'é'.repeat(37) },
      { telefone: 71999999999 },
      { telefone: 'abc' },
      { telefone: '123' },
      { telefone: '1'.repeat(16) },
      { telefone: ' '.repeat(15) + '1'.repeat(15) + ' '.repeat(15) + '2' },
    ]) {
      const response = await post({ ...cadastroValido, ...fields });
      assert.equal(response.status, 400);
      await response.json();
    }

    assert.equal(calls, 0);
  });

  await t.test('grava hash bcrypt e telefone, preserva a senha e retorna só dados públicos', async () => {
    const nome = "Joana O'Connor";
    const email = 'joana@example.com';
    const senha = ' Teste@1234 ';
    const telefone = '(71) 99999-9999';
    let calls = 0;
    database.execute = async (sql, parameters) => {
      calls += 1;
      assert.equal(sql, "INSERT INTO usuarios (nome, email, senha, telefone, tipo) VALUES (?, ?, ?, ?, 'aluno')");
      assert.equal(parameters.length, 4);
      assert.equal(parameters[0], nome);
      assert.equal(parameters[1], email);
      assert.equal(parameters[3], telefone);
      const hash = parameters[2];
      assert.notEqual(hash, senha);
      assert.equal(bcrypt.getRounds(hash), 12);
      assert.equal(await bcrypt.compare(senha, hash), true);
      assert.equal(await bcrypt.compare(senha.trim(), hash), false);
      return [{ insertId: 42 }];
    };

    const response = await post({ nome: ` ${nome} `, email: ` ${email} `, senha, telefone: ` ${telefone} `, tipo: 'admin', role: 'ADMIN', status: 'bloqueado' });
    assert.equal(response.status, 201);
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    assert.deepEqual(await response.json(), { id: 42, nome, email, telefone, fotoPerfil: null, role: 'USER' });
    assert.equal(calls, 1);
  });

  await t.test('aceita telefone opcional e senha no limite de 72 bytes UTF-8', async () => {
    const senha = 'é'.repeat(36);
    let calls = 0;
    database.execute = async (sql, parameters) => {
      calls += 1;
      assert.equal(parameters[3], null);
      assert.equal(await bcrypt.compare(senha, parameters[2]), true);
      return [{ insertId: 43 }];
    };

    for (const extra of [{}, { telefone: null }, { telefone: ' ' }]) {
      const response = await post({ ...cadastroValido, senha, ...extra });
      assert.equal(response.status, 201);
      assert.deepEqual(await response.json(), { id: 43, nome: cadastroValido.nome, email: cadastroValido.email, telefone: null, fotoPerfil: null, role: 'USER' });
    }
    assert.equal(calls, 3);
  });

  await t.test('retorna 409 quando o MySQL indica e-mail duplicado', async () => {
    database.execute = async () => {
      throw Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY' });
    };

    const response = await post(cadastroValido);
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { message: 'E-mail já cadastrado.' });
  });

  await t.test('retorna 500 sem expor detalhes do banco quando a inserção falha', async () => {
    database.execute = async () => {
      throw Object.assign(new Error('Detalhes privados do banco'), { code: 'ER_ACCESS_DENIED_ERROR' });
    };

    const response = await post(cadastroValido);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { message: 'Não foi possível cadastrar o usuário.' });
  });

  await t.test('retorna 400 para JSON malformado sem consultar o banco', async () => {
    let calls = 0;
    database.execute = async () => { calls += 1; };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"nome":',
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { message: 'O corpo da requisição deve conter um JSON válido.' });
    assert.equal(calls, 0);
  });
});
