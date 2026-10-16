process.env.JWT_SECRET = 'segredo-usado-apenas-nos-testes-automatizados';

const assert = require('node:assert/strict');
const { once } = require('node:events');
const { test } = require('node:test');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const database = require('../src/config/database');
const { gerarToken } = require('../src/config/auth');

test('autenticação e autorização', async (t) => {
  const server = app.listen(0, '127.0.0.1');
  const originalExecute = database.execute;

  t.after(async () => {
    database.execute = originalExecute;
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await database.end();
  });

  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = (path, token) => fetch(`${base}${path}`, {
    headers: token === undefined ? {} : { Authorization: token },
  });
  const aluno = { id: 7, nome: 'Aluna', email: 'aluna@example.com', telefone: null, tipo: 'aluno', status: 'ativo' };
  const admin = { ...aluno, id: 1, nome: 'Administradora', email: 'admin@example.com', tipo: 'admin' };
  const bearer = (id) => `Bearer ${gerarToken(id)}`;
  const banco = (usuario) => { database.execute = async () => [usuario ? [usuario] : []]; };
  const rotas = ['/api/usuarios/me', '/api/admin/cursos/indicadores', '/api/admin/cursos', '/api/admin/categorias', '/api/aulas/1', '/api/aulas/1/midia'];
  const rotasAdmin = rotas.slice(1, 4);

  await t.test('exige token Bearer nas rotas protegidas sem consultar o banco', async () => {
    let calls = 0;
    database.execute = async () => { calls += 1; };

    for (const rota of rotas) {
      for (const cabecalho of [undefined, '', 'Bearer', 'Bearer ', 'Basic abc', gerarToken(aluno.id)]) {
        const response = await get(rota, cabecalho);
        assert.equal(response.status, 401);
        assert.deepEqual(await response.json(), { message: 'Autenticação necessária.' });
      }
    }
    assert.equal(calls, 0);
  });

  await t.test('rejeita tokens inválidos, expirados, de outro segredo ou sem assinatura', async () => {
    let calls = 0;
    database.execute = async () => { calls += 1; };
    const segredo = process.env.JWT_SECRET;
    const tokens = [
      'nao-e-um-token',
      jwt.sign({}, segredo, { subject: '1', expiresIn: -10 }),
      jwt.sign({}, 'outro-segredo-qualquer-com-mais-de-32-caracteres', { subject: '1' }),
      jwt.sign({}, segredo, { subject: '1', algorithm: 'HS512' }),
      `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from('{"sub":"1"}').toString('base64url')}.`,
    ];

    for (const rota of rotas) {
      for (const token of tokens) {
        const response = await get(rota, `Bearer ${token}`);
        assert.equal(response.status, 401);
        assert.deepEqual(await response.json(), { message: 'Sessão inválida ou expirada. Entre novamente.' });
      }
    }
    assert.equal(calls, 0);
  });

  await t.test('GET /api/usuarios/me devolve os dados atuais do banco com o perfil', async () => {
    let calls = 0;
    database.execute = async (sql, parameters) => {
      calls += 1;
      assert.equal(sql, 'SELECT id, nome, email, telefone, foto_perfil, tipo, status FROM usuarios WHERE id = ? LIMIT 1');
      assert.deepEqual(parameters, [aluno.id]);
      return [[{ ...aluno, senha: 'hash privado', foto_perfil: 'https://example.com/foto.jpg' }]];
    };

    const response = await get('/api/usuarios/me', bearer(aluno.id));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      usuario: {
        id: aluno.id,
        nome: aluno.nome,
        email: aluno.email,
        telefone: null,
        fotoPerfil: 'https://example.com/foto.jpg',
        role: 'USER',
      },
    });
    assert.equal(calls, 1);

    banco(admin);
    assert.equal((await (await get('/api/usuarios/me', bearer(admin.id))).json()).usuario.role, 'ADMIN');
  });

  await t.test('encerra a sessão de usuário removido e bloqueia usuário inativo', async () => {
    for (const rota of rotas) {
      banco(undefined);
      let response = await get(rota, bearer(aluno.id));
      assert.equal(response.status, 401);
      await response.json();

      for (const status of ['inativo', 'bloqueado', null]) {
        banco({ ...admin, status });
        response = await get(rota, bearer(admin.id));
        assert.equal(response.status, 403);
        assert.deepEqual(await response.json(), { message: 'Usuário inativo ou bloqueado.' });
      }
    }
  });

  // Simula o banco: a consulta do usuário da sessão vem antes da consulta de cursos.
  const bancoAdmin = (usuario, cursos) => {
    database.execute = async (sql) => (sql.includes('FROM usuarios') ? [[usuario]] : cursos(sql));
  };

  await t.test('rotas administrativas recusam USER sem consultar os cursos', async () => {
    for (const rota of rotasAdmin) {
      for (const tipo of ['aluno', null, 'ADMIN', 'outro']) {
        let consultasDeCursos = 0;
        bancoAdmin({ ...aluno, tipo }, () => { consultasDeCursos += 1; return [[]]; });
        const response = await get(rota, bearer(aluno.id));
        assert.equal(response.status, 403);
        assert.deepEqual(await response.json(), { message: 'Acesso restrito à administração.' });
        assert.equal(consultasDeCursos, 0);
      }
    }
  });

  await t.test('a permissão vem do banco: um token antigo perde o acesso após o rebaixamento', async () => {
    const token = bearer(admin.id);
    bancoAdmin(admin, () => [[]]);
    assert.equal((await get('/api/admin/cursos', token)).status, 200);

    bancoAdmin({ ...admin, tipo: 'aluno' }, () => [[]]);
    assert.equal((await get('/api/admin/cursos', token)).status, 403);
  });

  await t.test('GET /api/admin/cursos/indicadores conta por status e destaque', async () => {
    bancoAdmin(admin, (sql) => {
      assert.match(sql, /FROM cursos/);
      assert.match(sql, /status = 'publicado'/);
      assert.match(sql, /status = 'rascunho' OR status IS NULL/);
      assert.match(sql, /destaque = 1/);
      // O MySQL devolve SUM() como texto decimal.
      return [[{ total: 7, publicados: '3', rascunhos: '2', arquivados: '2', destaques: '1' }]];
    });
    let response = await get('/api/admin/cursos/indicadores', bearer(admin.id));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      indicadores: { total: 7, publicados: 3, rascunhos: 2, arquivados: 2, destaques: 1 },
    });

    bancoAdmin(admin, () => [[{ total: 0, publicados: '0', rascunhos: '0', arquivados: '0', destaques: '0' }]]);
    response = await get('/api/admin/cursos/indicadores', bearer(admin.id));
    assert.deepEqual(await response.json(), {
      indicadores: { total: 0, publicados: 0, rascunhos: 0, arquivados: 0, destaques: 0 },
    });
  });

  await t.test('GET /api/admin/cursos lista os cursos com os campos da listagem', async () => {
    const atualizado = '2026-01-02T00:00:00.000Z';
    bancoAdmin(admin, (sql) => {
      assert.match(sql, /FROM cursos c LEFT JOIN categorias k ON k\.id = c\.categoria_id\s+ORDER BY c\.criado_em DESC, c\.id DESC/);
      return [[
        { id: 2, titulo: 'Curso B', subtitulo: null, descricao: 'Texto', instrutora: 'Joana', imagem_capa: '/arquivos/imagens/b.jpg', imagem_banner: null, categoria_id: 5, categoria: 'Energia', secao: 'praticas', destaque: 1, tipo_acesso: 'pago', preco_centavos: 29700, pix_habilitado: 1, pix_desconto_percentual: '5.00', cartao_habilitado: 1, cartao_max_parcelas: 12, cartao_parcelas_sem_juros: 3, prazo_acesso_meses: 12, progressao_sequencial: 1, status: 'publicado', total_aulas: 3, duracao_minutos: 12, atualizado_em: atualizado, senha: 'não listada' },
        { id: 1, titulo: 'Curso A', subtitulo: 'Sub', descricao: null, instrutora: null, imagem_capa: null, imagem_banner: null, categoria_id: null, categoria: null, secao: null, destaque: null, tipo_acesso: 'gratuito', preco_centavos: null, pix_habilitado: 0, pix_desconto_percentual: '0.00', cartao_habilitado: 0, cartao_max_parcelas: 1, cartao_parcelas_sem_juros: 1, prazo_acesso_meses: null, progressao_sequencial: 0, status: null, total_aulas: null, duracao_minutos: null, atualizado_em: atualizado },
      ]];
    });
    const response = await get('/api/admin/cursos', bearer(admin.id));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      cursos: [
        { id: 2, titulo: 'Curso B', subtitulo: null, descricao: 'Texto', instrutora: 'Joana', imagemCapa: '/arquivos/imagens/b.jpg', imagemBanner: null, categoriaId: 5, categoria: 'Energia', secao: 'praticas', destaque: true, tipoAcesso: 'pago', gratuito: false, precoCentavos: 29700, pixHabilitado: true, pixDescontoPercentual: 5, cartaoHabilitado: true, cartaoMaxParcelas: 12, cartaoParcelasSemJuros: 3, prazoAcessoMeses: 12, sequencial: true, status: 'publicado', totalAulas: 3, duracaoMinutos: 12, atualizadoEm: atualizado },
        { id: 1, titulo: 'Curso A', subtitulo: 'Sub', descricao: null, instrutora: null, imagemCapa: null, imagemBanner: null, categoriaId: null, categoria: null, secao: null, destaque: false, tipoAcesso: 'gratuito', gratuito: true, precoCentavos: null, pixHabilitado: false, pixDescontoPercentual: 0, cartaoHabilitado: false, cartaoMaxParcelas: 1, cartaoParcelasSemJuros: 1, prazoAcessoMeses: null, sequencial: false, status: 'rascunho', totalAulas: 0, duracaoMinutos: 0, atualizadoEm: atualizado },
      ],
    });

    bancoAdmin(admin, () => [[]]);
    assert.deepEqual(await (await get('/api/admin/cursos', bearer(admin.id))).json(), { cursos: [] });
  });

  await t.test('rotas de cursos tratam falha no banco sem retornar detalhes privados', async () => {
    bancoAdmin(admin, () => {
      throw Object.assign(new Error('Detalhes privados do banco'), { code: 'ER_NO_SUCH_TABLE' });
    });
    for (const rota of ['/api/admin/cursos/indicadores', '/api/admin/cursos', '/api/admin/categorias']) {
      const response = await get(rota, bearer(admin.id));
      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), { message: 'Não foi possível concluir a operação.' });
    }
  });

  await t.test('rotas públicas do catálogo não exigem sessão e só consultam cursos publicados', async () => {
    const consultas = [];
    database.execute = async (sql) => { consultas.push(sql); return [[]]; };
    for (const rota of ['/api/home', '/api/categorias', '/api/cursos', '/api/cursos?busca=abc&categoriaId=2&secao=metodo&pagina=3']) {
      const response = await get(rota);
      assert.equal(response.status, 200, rota);
      await response.json();
    }
    assert.ok(consultas.length >= 4);
    // A configuração do banner da Home é pública por definição e não é consulta de cursos.
    for (const sql of consultas.filter((item) => !item.includes('FROM configuracoes') && !item.includes('FROM banners_home'))) {
      assert.match(sql, /status = 'publicado'/);
      assert.match(sql, /tipo_acesso <> 'restrito'/);
    }
    assert.match(consultas.at(-1), /LIMIT 13 OFFSET 24/);

    for (const rota of ['/api/cursos?categoriaId=abc', '/api/cursos?secao=outra']) {
      assert.equal((await get(rota)).status, 400, rota);
    }
  });

  await t.test('detalhes de curso não publicado só existem para ADMIN', async () => {
    const curso = { id: 3, titulo: 'Rascunho', status: 'rascunho', tipo_acesso: 'gratuito', progressao_sequencial: 1 };
    const banco = (usuario) => {
      database.execute = async (sql) => {
        if (sql.includes('FROM usuarios')) return [[usuario]];
        if (sql.includes('FROM cursos c')) return [[curso]];
        return [[]];
      };
    };
    banco(aluno);
    assert.equal((await get('/api/cursos/3')).status, 404);
    assert.equal((await get('/api/cursos/3', bearer(aluno.id))).status, 404);
    banco(admin);
    const response = await get('/api/cursos/3', bearer(admin.id));
    assert.equal(response.status, 200);
    const detalhes = await response.json();
    assert.equal(detalhes.acesso.estado, 'liberado');
    assert.equal(detalhes.termosPendentes, false);
  });

  await t.test('trata falha no banco sem retornar detalhes privados', async () => {
    database.execute = async () => {
      throw Object.assign(new Error('Detalhes privados do banco'), { code: 'ER_ACCESS_DENIED_ERROR' });
    };
    const response = await get('/api/usuarios/me', bearer(aluno.id));
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { message: 'Não foi possível validar a sessão.' });
  });
});
