// Teste de integração do carrossel de banners da Home, contra o banco do .env. Guarda os banners e o
// ajuste existentes antes do teste e os restaura ao terminar; usuários e imagens de teste são apagados.
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
const { migrarBannerUnico } = require('../src/utils/bannerHome');

const MARCA = `bn-${Date.now()}`;
const png = (n) => Buffer.concat([Buffer.from([0x89]), Buffer.from('PNG\r\n\x1a\n'), Buffer.alloc(64, n)]);

test('carrossel de banners da página inicial', async (t) => {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const consulta = async (sql, p = []) => (await database.query(sql, p))[0];
  const guardadoBanners = await consulta('SELECT * FROM banners_home');
  const guardadoConfig = await consulta("SELECT chave, valor FROM configuracoes WHERE chave IN ('carrossel_home', 'banner_home')");
  const ids = [];
  const arquivos = new Set();

  const usuario = async (nome, tipo) => {
    const r = await consulta('INSERT INTO usuarios (nome, email, senha, tipo) VALUES (?, ?, ?, ?)', [`${nome} ${MARCA}`, `${nome.toLowerCase()}-${MARCA}@teste.invalid`, 'sem-login', tipo]);
    ids.push(r.insertId);
    return r.insertId;
  };
  const chamar = async (metodo, caminho, id, corpo) => {
    const r = await fetch(`${base}${caminho}`, { method: metodo, headers: { ...(id && { Authorization: `Bearer ${gerarToken(id)}` }), ...(corpo && { 'Content-Type': 'application/json' }) }, body: corpo && JSON.stringify(corpo) });
    return { status: r.status, dados: await r.json() };
  };
  const enviar = async (id, conteudo) => {
    const r = await fetch(`${base}/api/admin/uploads/imagem`, { method: 'POST', headers: { Authorization: `Bearer ${gerarToken(id)}`, 'Content-Type': 'image/png' }, body: conteudo });
    const dados = await r.json();
    arquivos.add(dados.url);
    return dados.url;
  };
  const noDisco = (url) => fs.existsSync(path.join(pasta('imagens'), url.split('/').pop()));
  const carrossel = async () => (await (await fetch(`${base}/api/home`)).json()).carrossel;
  const resumo = (slides) => slides.map((slide) => (slide.id === null ? 'padrao' : slide.id));

  const limpar = async () => {
    await consulta('DELETE FROM banners_home');
    await consulta("DELETE FROM configuracoes WHERE chave IN ('carrossel_home', 'banner_home')");
  };
  t.after(async () => {
    await limpar();
    for (const linha of guardadoBanners) {
      await consulta('INSERT INTO banners_home SET ?', [linha]);
    }
    for (const linha of guardadoConfig) {
      await consulta('INSERT INTO configuracoes (chave, valor) VALUES (?, ?)', [linha.chave, typeof linha.valor === 'string' ? linha.valor : JSON.stringify(linha.valor)]);
    }
    for (const url of arquivos) {
      const emUso = (await consulta('SELECT 1 FROM banners_home WHERE imagem = ?', [url])).length > 0;
      if (!emUso) fs.rmSync(path.join(pasta('imagens'), url.split('/').pop()), { force: true });
    }
    await consulta('DELETE FROM usuarios WHERE id IN (?) AND email LIKE ?', [ids, `%${MARCA}%`]);
    await new Promise((r) => server.close(r));
    await database.end();
  });

  const admin = await usuario('Admin', 'admin');
  const aluna = await usuario('Aluna', 'aluno');
  await limpar();
  const dados = (nome, imagem, extra = {}) => ({
    nome,
    imagem,
    botao: 'champagne',
    enquadramento: { x: 50, y: 50 },
    textoSuperior: { texto: 'Texto superior', visivel: true },
    titulo: { texto: 'Título', visivel: true },
    ...extra,
  });
  const criar = async (nome, extra) => (await chamar('POST', '/api/admin/personalizacao/banners', admin, dados(nome, await enviar(admin, png(ids.length + arquivos.size)), extra)));

  await t.test('1) sem banners personalizados: só o banner padrão, nunca vazio', async () => {
    const slides = await carrossel();
    assert.deepEqual(resumo(slides), ['padrao']);
    assert.equal(slides[0].textoSuperior.texto, 'IDENTIDADE • ENERGIA • CONSCIÊNCIA');
    assert.equal(slides[0].botao, 'champagne');
  });

  await t.test('só ADMIN gerencia; o público apenas lê', async () => {
    const rotas = [['GET', ''], ['POST', '', dados('x', '/arquivos/imagens/' + 'a'.repeat(32) + '.png')], ['PUT', '/ordem', { ids: [1] }], ['PUT', '/padrao', { exibir: true, botao: 'dark' }], ['PUT', '/1', {}], ['PUT', '/1/status', { ativo: false }], ['DELETE', '/1']];
    for (const [metodo, caminho, corpo] of rotas) {
      assert.equal((await chamar(metodo, `/api/admin/personalizacao/banners${caminho}`, null, corpo)).status, 401, `${metodo} ${caminho}`);
      assert.equal((await chamar(metodo, `/api/admin/personalizacao/banners${caminho}`, aluna, corpo)).status, 403, `${metodo} ${caminho}`);
    }
    assert.deepEqual(resumo(await carrossel()), ['padrao']);
  });

  await t.test('validações: nome, imagem, textos, cor e enquadramento', async () => {
    const url = await enviar(admin, png(1));
    const ruins = [
      dados('', url),
      dados('x'.repeat(81), url),
      dados('ok', null),
      dados('ok', '/arquivos/imagens/nao-existe.png'),
      dados('ok', 'https://exemplo.com/a.png'),
      dados('ok', url, { botao: '#FF0000' }),
      dados('ok', url, { enquadramento: { x: 120, y: 0 } }),
      dados('ok', url, { titulo: { texto: '  ', visivel: true } }),
      dados('ok', url, { textoSuperior: { texto: 'x', visivel: 'sim' } }),
    ];
    for (const corpo of ruins) assert.equal((await chamar('POST', '/api/admin/personalizacao/banners', admin, corpo)).status, 400, JSON.stringify(corpo).slice(0, 70));
    assert.equal((await chamar('GET', '/api/admin/personalizacao/banners', admin)).dados.banners.length, 0);
    // Texto vazio é aceito quando está oculto (imagem com textos próprios).
    const oculto = await chamar('POST', '/api/admin/personalizacao/banners', admin, dados('Oculto', url, { titulo: { texto: '', visivel: false }, textoSuperior: { texto: '', visivel: false } }));
    assert.equal(oculto.status, 201);
    await chamar('DELETE', `/api/admin/personalizacao/banners/${oculto.dados.banner.id}`, admin);
  });

  let b1;
  let b2;
  let b3;
  await t.test('2) um banner personalizado com o padrão desativado: só o personalizado', async () => {
    const r = await criar('Primeiro', { botao: 'white', enquadramento: { x: 20, y: 80 }, titulo: { texto: '  Título   novo ', visivel: true } });
    assert.equal(r.status, 201);
    b1 = r.dados.banner;
    assert.deepEqual([b1.nome, b1.ativo, b1.ordem, b1.botao, b1.titulo.texto], ['Primeiro', true, 1, 'white', 'Título novo']);
    assert.deepEqual(b1.enquadramento, { x: 20, y: 80 });
    assert.ok(b1.criadoEm && b1.atualizadoEm);

    // O padrão começa participando; desativá-lo deixa só o personalizado.
    assert.deepEqual(resumo(await carrossel()), ['padrao', b1.id]);
    assert.equal((await chamar('PUT', '/api/admin/personalizacao/banners/padrao', admin, { exibir: false, botao: 'champagne' })).status, 200);
    assert.deepEqual(resumo(await carrossel()), [b1.id]);
  });

  await t.test('3 e 4) vários banners com o padrão ativado: padrão primeiro, depois a ordem cadastrada', async () => {
    b2 = (await criar('Segundo', { botao: 'dark' })).dados.banner;
    b3 = (await criar('Terceiro')).dados.banner;
    assert.deepEqual([b2.ordem, b3.ordem], [2, 3]);
    assert.deepEqual(resumo(await carrossel()), [b1.id, b2.id, b3.id]);
    await chamar('PUT', '/api/admin/personalizacao/banners/padrao', admin, { exibir: true, botao: 'white' });
    const slides = await carrossel();
    assert.deepEqual(resumo(slides), ['padrao', b1.id, b2.id, b3.id]);
    // 10) cada banner tem a sua cor de botão, e o padrão também.
    assert.deepEqual(slides.map((slide) => slide.botao), ['white', 'white', 'dark', 'champagne']);
  });

  await t.test('6) a ordem pode ser alterada, e uma lista desatualizada é recusada', async () => {
    const r = await chamar('PUT', '/api/admin/personalizacao/banners/ordem', admin, { ids: [b3.id, b1.id, b2.id] });
    assert.equal(r.status, 200);
    assert.deepEqual(r.dados.banners.map((banner) => banner.id), [b3.id, b1.id, b2.id]);
    assert.deepEqual(resumo(await carrossel()), ['padrao', b3.id, b1.id, b2.id]);
    assert.equal((await chamar('PUT', '/api/admin/personalizacao/banners/ordem', admin, { ids: [b3.id, b1.id] })).status, 409);
    assert.equal((await chamar('PUT', '/api/admin/personalizacao/banners/ordem', admin, { ids: [b3.id, b1.id, 999999] })).status, 409);
    assert.deepEqual((await chamar('GET', '/api/admin/personalizacao/banners', admin)).dados.banners.map((banner) => banner.id), [b3.id, b1.id, b2.id]);
  });

  await t.test('7) desativar tira do carrossel sem apagar; reativar traz de volta', async () => {
    assert.equal((await chamar('PUT', `/api/admin/personalizacao/banners/${b1.id}/status`, admin, { ativo: false })).status, 200);
    assert.deepEqual(resumo(await carrossel()), ['padrao', b3.id, b2.id]);
    const todos = (await chamar('GET', '/api/admin/personalizacao/banners', admin)).dados.banners;
    assert.equal(todos.find((banner) => banner.id === b1.id).ativo, false);
    assert.equal((await chamar('PUT', `/api/admin/personalizacao/banners/${b1.id}/status`, admin, { ativo: 'sim' })).status, 400);
    await chamar('PUT', `/api/admin/personalizacao/banners/${b1.id}/status`, admin, { ativo: true });
    assert.deepEqual(resumo(await carrossel()), ['padrao', b3.id, b1.id, b2.id]);
  });

  await t.test('editar troca a imagem (a antiga sai do armazenamento) e a cor do botão', async () => {
    const nova = await enviar(admin, png(99));
    const r = await chamar('PUT', `/api/admin/personalizacao/banners/${b2.id}`, admin, dados('Segundo editado', nova, { botao: 'champagne' }));
    assert.equal(r.status, 200);
    assert.deepEqual([r.dados.banner.nome, r.dados.banner.botao, r.dados.banner.imagem, r.dados.banner.ativo], ['Segundo editado', 'champagne', nova, true]);
    assert.equal(noDisco(b2.imagem), false);
    assert.ok(noDisco(nova));
    b2 = r.dados.banner;
    // Edição inválida não muda nada.
    assert.equal((await chamar('PUT', `/api/admin/personalizacao/banners/${b2.id}`, admin, dados('', nova))).status, 400);
    assert.equal((await chamar('GET', '/api/admin/personalizacao/banners', admin)).dados.banners.find((banner) => banner.id === b2.id).nome, 'Segundo editado');
    assert.equal((await chamar('PUT', '/api/admin/personalizacao/banners/999999', admin, dados('x', nova))).status, 404);
  });

  await t.test('8) excluir apaga o banner e a imagem; o padrão não tem exclusão', async () => {
    const imagem = b3.imagem;
    assert.equal((await chamar('DELETE', `/api/admin/personalizacao/banners/${b3.id}`, admin)).status, 200);
    assert.equal(noDisco(imagem), false);
    assert.deepEqual(resumo(await carrossel()), ['padrao', b1.id, b2.id]);
    assert.equal((await chamar('DELETE', `/api/admin/personalizacao/banners/${b3.id}`, admin)).status, 404);
    // 9) o padrão continua, mesmo sem nenhum personalizado e com a exibição desligada.
    await chamar('PUT', '/api/admin/personalizacao/banners/padrao', admin, { exibir: false, botao: 'champagne' });
    for (const banner of [b1, b2]) assert.equal((await chamar('DELETE', `/api/admin/personalizacao/banners/${banner.id}`, admin)).status, 200);
    assert.deepEqual(resumo(await carrossel()), ['padrao']);
    assert.equal((await chamar('DELETE', '/api/admin/personalizacao/banners/padrao', admin)).status, 404);
    assert.equal((await chamar('GET', '/api/admin/personalizacao/banners', admin)).dados.padrao.exibir, false);
  });

  await t.test('só personalizados inativos: o padrão aparece mesmo desabilitado', async () => {
    const r = (await criar('Inativo', { ativo: false })).dados.banner;
    assert.deepEqual(resumo(await carrossel()), ['padrao']);
    await chamar('DELETE', `/api/admin/personalizacao/banners/${r.id}`, admin);
  });

  await t.test('migração: o banner único publicado antes do carrossel vira o primeiro banner', async () => {
    await limpar();
    const url = await enviar(admin, png(7));
    const antigo = { modo: 'personalizado', imagem: url, botao: 'dark', enquadramento: { x: 10, y: 90 }, textoSuperior: { texto: 'Sup', visivel: false }, titulo: { texto: 'Tit', visivel: true } };
    await consulta("INSERT INTO configuracoes (chave, valor) VALUES ('banner_home', ?)", [JSON.stringify(antigo)]);
    assert.equal(await migrarBannerUnico(), true);
    assert.equal(await migrarBannerUnico(), false);
    const slides = await carrossel();
    assert.equal(slides.length, 1);
    assert.deepEqual([slides[0].modo, slides[0].imagem, slides[0].botao, slides[0].textoSuperior.visivel], ['personalizado', url, 'dark', false]);
    assert.deepEqual(slides[0].enquadramento, { x: 10, y: 90 });
    assert.equal((await consulta("SELECT 1 FROM configuracoes WHERE chave = 'banner_home'")).length, 0);

    // Banner único no modo padrão com botão branco: o padrão continua, com o botão escolhido.
    await limpar();
    await consulta("INSERT INTO configuracoes (chave, valor) VALUES ('banner_home', ?)", [JSON.stringify({ modo: 'padrao', botao: 'white' })]);
    await migrarBannerUnico();
    const [padrao] = await carrossel();
    assert.deepEqual([padrao.id, padrao.botao], [null, 'white']);
  });
});
