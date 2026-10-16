// Teste de integração da foto de perfil, contra o banco do .env. Cria usuários de teste e apaga tudo ao terminar.
process.env.JWT_SECRET = 'segredo-usado-apenas-nos-testes-automatizados';
const assert = require('node:assert/strict');
const { once } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const app = require('../src/app');
const { gerarToken } = require('../src/config/auth');
const database = require('../src/config/database');
const { pasta } = require('../src/config/storage');

const MARCA = `ft-${Date.now()}`;
const jpg = (n = 64) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n, 1)]);
const png = () => Buffer.concat([Buffer.from([0x89]), Buffer.from('PNG\r\n\x1a\n'), Buffer.alloc(64, 2)]);

test('foto de perfil', async (t) => {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const ids = [];
  const criados = new Set();
  const consulta = async (sql, p = []) => (await database.query(sql, p))[0];
  const usuario = async (nome, tipo) => {
    const r = await consulta('INSERT INTO usuarios (nome, email, senha, tipo) VALUES (?, ?, ?, ?)', [`${nome} ${MARCA}`, `${nome.toLowerCase()}-${MARCA}@teste.invalid`, 'sem-login', tipo]);
    ids.push(r.insertId);
    return r.insertId;
  };
  const enviar = async (id, corpo, tipo = 'image/jpeg') => {
    const r = await fetch(`${base}/api/usuarios/me/foto`, { method: 'POST', headers: { ...(id && { Authorization: `Bearer ${gerarToken(id)}` }), 'Content-Type': tipo }, body: corpo });
    const dados = await r.json();
    if (dados.usuario?.fotoPerfil) criados.add(dados.usuario.fotoPerfil);
    return { status: r.status, dados };
  };
  const remover = async (id) => { const r = await fetch(`${base}/api/usuarios/me/foto`, { method: 'DELETE', headers: { Authorization: `Bearer ${gerarToken(id)}` } }); return { status: r.status, dados: await r.json() }; };
  const arquivo = (url) => path.join(pasta('imagens'), url.split('/').pop());
  const nobanco = async (id) => (await consulta('SELECT foto_perfil FROM usuarios WHERE id = ?', [id]))[0].foto_perfil;

  t.after(async () => {
    for (const url of criados) fs.rmSync(arquivo(url), { force: true });
    await consulta('DELETE FROM usuarios WHERE id IN (?) AND email LIKE ?', [ids, `%${MARCA}%`]);
    await new Promise((r) => server.close(r));
    await database.end();
  });

  const aluna = await usuario('Aluna', 'aluno');
  const admin = await usuario('Admin', 'admin');
  const outra = await usuario('Outra', 'aluno');
  let primeira;

  await t.test('exige sessão', async () => {
    assert.equal((await enviar(null, jpg())).status, 401);
    const r = await fetch(`${base}/api/usuarios/me/foto`, { method: 'DELETE' });
    assert.equal(r.status, 401);
  });

  await t.test('aluna e administradora enviam a foto; ela fica no cadastro e no armazenamento', async () => {
    const r = await enviar(aluna, jpg());
    assert.equal(r.status, 200);
    primeira = r.dados.usuario.fotoPerfil;
    assert.match(primeira, /^\/arquivos\/imagens\/[a-f0-9]{32}\.jpg$/);
    assert.equal(await nobanco(aluna), primeira);
    assert.ok(fs.existsSync(arquivo(primeira)));
    const resposta = await fetch(`${base}${primeira}`);
    assert.equal(resposta.status, 200);
    assert.equal((await enviar(admin, png(), 'image/png')).status, 200);
    // Outro dispositivo/sessão: /me devolve a mesma foto.
    const me = await (await fetch(`${base}/api/usuarios/me`, { headers: { Authorization: `Bearer ${gerarToken(aluna)}` } })).json();
    assert.equal(me.usuario.fotoPerfil, primeira);
  });

  await t.test('uma foto só mexe no cadastro de quem a enviou', async () => {
    assert.equal(await nobanco(outra), null);
    await remover(outra);
    assert.equal(await nobanco(aluna), primeira);
    assert.ok(fs.existsSync(arquivo(primeira)));
  });

  await t.test('trocar a foto remove o arquivo antigo; falha de validação mantém a anterior', async () => {
    const r = await enviar(aluna, png(), 'image/png');
    assert.equal(r.status, 200);
    assert.notEqual(r.dados.usuario.fotoPerfil, primeira);
    assert.equal(fs.existsSync(arquivo(primeira)), false);
    const atual = r.dados.usuario.fotoPerfil;

    assert.equal((await enviar(aluna, jpg(), 'image/gif')).status, 415);
    assert.equal((await enviar(aluna, Buffer.alloc(64, 9), 'image/jpeg')).status, 415);
    // Grande demais: o servidor recusa (413) e fecha a conexão, o que o cliente pode ver como 'reset'.
    const grande = await enviar(aluna, jpg(4 * 1024 * 1024)).catch(() => ({ status: 413 }));
    assert.equal(grande.status, 413);
    assert.equal((await enviar(aluna, Buffer.alloc(0), 'image/jpeg')).status, 415);
    assert.equal(await nobanco(aluna), atual);
    assert.ok(fs.existsSync(arquivo(atual)));
    const parciais = fs.readdirSync(pasta('imagens')).filter((n) => n.endsWith('.parcial'));
    assert.equal(parciais.length, 0);
  });

  await t.test('remover volta ao avatar com a inicial e apaga o arquivo', async () => {
    const atual = await nobanco(aluna);
    const r = await remover(aluna);
    assert.equal(r.status, 200);
    assert.equal(r.dados.usuario.fotoPerfil, null);
    assert.equal(await nobanco(aluna), null);
    assert.equal(fs.existsSync(arquivo(atual)), false);
    assert.equal((await remover(aluna)).status, 200); // repetir é inofensivo
  });

  await t.test('a rota administrativa de upload não aceita o tipo "perfil"', async () => {
    const r = await fetch(`${base}/api/admin/uploads/perfil`, { method: 'POST', headers: { Authorization: `Bearer ${gerarToken(admin)}`, 'Content-Type': 'image/jpeg' }, body: jpg() });
    assert.equal(r.status, 404);
  });
});
