// Executar somente em banco de testes. Reutiliza matriculas e historico_acessos, sem provedor.
process.env.JWT_SECRET = 'segredo-apenas-da-integracao-de-cursos-restritos';
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { once } = require('node:events');
const { test } = require('node:test');
const app = require('../src/app');
const db = require('../src/config/database');
const { gerarToken } = require('../src/config/auth');

test('seleção de alunos, visibilidade privada e permissões compartilhadas', async (t) => {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const marca = `restritos-${Date.now()}`;
  const ids = { usuarios: [], cursos: [], categorias: [], documento: null };
  const query = async (sql, args = []) => (await db.query(sql, args))[0];
  const call = async (method, route, user, body) => {
    const response = await fetch(base + route, { method, headers: {
      ...(user && { Authorization: `Bearer ${gerarToken(user)}` }),
      ...(body !== undefined && { 'Content-Type': 'application/json' }),
    }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  t.after(async () => {
    if (ids.usuarios.length) {
      for (const table of ['historico_acessos', 'matriculas', 'progresso_aulas', 'aceites_termos']) {
        await query(`DELETE FROM ${table} WHERE usuario_id IN (?)`, [ids.usuarios]);
      }
    }
    if (ids.cursos.length) await query('DELETE FROM cursos WHERE id IN (?) AND titulo LIKE ?', [ids.cursos, `%${marca}%`]);
    if (ids.documento) await query('DELETE FROM documentos_legais WHERE id = ?', [ids.documento]);
    if (ids.categorias.length) await query('DELETE FROM categorias WHERE id IN (?)', [ids.categorias]);
    if (ids.usuarios.length) await query('DELETE FROM usuarios WHERE id IN (?)', [ids.usuarios]);
    await new Promise((resolve) => server.close(resolve));
    await db.end();
  });
  const user = async (nome, tipo = 'aluno') => {
    const result = await query('INSERT INTO usuarios (nome,email,senha,tipo) VALUES (?,?,?,?)',
      [`${nome} ${marca}`, `${nome}-${marca}@teste.invalid`, 'sem-login', tipo]);
    ids.usuarios.push(result.insertId); return result.insertId;
  };
  const admin = await user('Admin', 'admin');
  const a = await user('AlunaA'), b = await user('AlunaB'), c = await user('AlunaC'), d = await user('AlunaD');
  const texto = `Termos isolados ${marca}`, hash = createHash('sha256').update(texto).digest('hex');
  ids.documento = (await query("INSERT INTO documentos_legais (tipo,versao,vigente_desde,texto,hash) VALUES ('termos',?,CURDATE(),?,?)",
    [String(Date.now()), texto, hash])).insertId;
  for (const aluno of [a, b, c, d]) {
    assert.equal((await call('POST', '/api/termos/aceite', aluno, { documentoId: ids.documento, hash, aceito: true })).status, 201);
  }
  const category = (await query('INSERT INTO categorias (nome,mostrar_home) VALUES (?,1)', [`Privada ${marca}`])).insertId;
  ids.categorias.push(category);
  const body = { titulo: `Curso restrito ${marca}`, descricao: 'Descrição privada.', categoriaId: category,
    tipoAcesso: 'restrito', prazoAcessoMeses: 24, secao: 'metodo', sequencial: true };
  let course, first, second, demo;
  const mine = async (aluno) => (await call('GET', '/api/meus-cursos', aluno)).data.cursos;
  const details = (aluno) => call('GET', `/api/cursos/${course}`, aluno);
  const accesses = async (filters) => (await call('GET', `/api/admin/acessos?${filters}`, admin)).data;

  await t.test('ADMIN cadastra um restrito e grava dois alunos somente após validar o cadastro', async () => {
    const response = await call('POST', '/api/admin/cursos', admin, { ...body,
      acessos: { conceder: [{ usuarioId: a, prazoMeses: 12 }, { usuarioId: b, prazoMeses: null }], revogar: [] } });
    assert.equal(response.status, 201); course = response.data.curso.id; ids.cursos.push(course);
    assert.equal(response.data.curso.status, 'rascunho');
    assert.equal(response.data.curso.tipoAcesso, 'restrito');
    assert.equal((await accesses(`cursoId=${course}`)).total, 2);
    const [dates] = await query('SELECT TIMESTAMPDIFF(MONTH,inicio_em,expira_em) AS meses FROM matriculas WHERE usuario_id = ? AND curso_id = ?', [a, course]);
    assert.equal(dates.meses, 12);
    const [forever] = await query('SELECT expira_em FROM matriculas WHERE usuario_id = ? AND curso_id = ?', [b, course]);
    assert.equal(forever.expira_em, null);
    assert.equal((await query('SELECT COUNT(*) AS n FROM pedidos'))[0].n, 0);
  });
  assert.ok(course, 'O cadastro deve concluir antes dos demais cenários.');
  const module = (await query('INSERT INTO modulos (curso_id,titulo,ordem) VALUES (?, ?, 1)', [course, 'Módulo privado'])).insertId;
  for (const [order, demonstration] of [[1, 0], [2, 0], [3, 1]]) {
    const lesson = (await query("INSERT INTO aulas (modulo_id,titulo,tipo,link_externo,ordem,demonstrativa) VALUES (?,?,'spotify',?,?,?)",
      [module, `Aula privada ${order}`, 'https://open.spotify.com/track/teste', order, demonstration])).insertId;
    if (order === 1) first = lesson; else if (order === 2) second = lesson; else demo = lesson;
  }
  await query('UPDATE cursos SET total_aulas = 3 WHERE id = ?', [course]);

  await t.test('rascunho permanece invisível para os alunos selecionados e disponível ao ADMIN', async () => {
    for (const aluno of [a, b]) {
      assert.equal((await details(aluno)).status, 404);
      assert.ok(!(await mine(aluno)).some((item) => item.id === course));
      assert.equal((await call('GET', `/api/aulas/${demo}`, aluno)).status, 404);
    }
    assert.equal((await details(admin)).status, 200);
    assert.equal((await call('GET', `/api/admin/cursos/${course}`, admin)).data.modulos.length, 1);
  });
  await t.test('publicar disponibiliza o curso em Meus cursos apenas para os dois alunos', async () => {
    assert.equal((await call('PUT', `/api/admin/cursos/${course}/status`, admin, { status: 'publicado' })).status, 200);
    for (const aluno of [a, b]) {
      assert.equal((await mine(aluno)).find((item) => item.id === course)?.situacao, 'ativo');
      const response = await details(aluno);
      assert.equal(response.status, 200); assert.equal(response.data.modulos[0].titulo, 'Módulo privado');
      assert.equal(response.data.acesso.estado, 'liberado');
    }
    assert.ok(!(await mine(c)).some((item) => item.id === course));
  });
  await t.test('Home, Explorar, pesquisas e categoria pública ocultam o curso, inclusive a autorizados', async () => {
    for (const aluno of [undefined, a, b, c, admin]) {
      const home = (await call('GET', '/api/home', aluno)).data;
      assert.ok(home.secoes.every((section) => section.cursos.every((item) => item.id !== course)));
      assert.ok(home.categorias.every((item) => item.id !== category));
      assert.ok((await call('GET', '/api/categorias', aluno)).data.categorias.every((item) => item.id !== category));
      for (const filter of ['', `?busca=${marca}`, `?categoriaId=${category}`, '?secao=metodo']) {
        assert.ok((await call('GET', `/api/cursos${filter}`, aluno)).data.cursos.every((item) => item.id !== course));
      }
    }
  });
  await t.test('usuário não autorizado não recebe detalhes nem aulas, mídia ou demonstração por URL', async () => {
    for (const aluno of [undefined, c, d]) {
      const response = await details(aluno); assert.equal(response.status, 404);
      assert.equal(response.data.modulos, undefined); assert.equal(response.data.curso, undefined);
      for (const lesson of [first, demo]) {
        for (const [method, suffix, payload] of [['GET', '', undefined], ['GET', '/midia', undefined], ['POST', '/progresso', { finalizada: true }]]) {
          const response = await call(method, `/api/aulas/${lesson}${suffix}`, aluno, payload);
          assert.equal(response.status, aluno ? 403 : 401); assert.equal(response.data.aula, undefined);
        }
      }
    }
  });
  await t.test('os dois autorizados iniciam, concluem e continuam com a sequência existente', async () => {
    for (const aluno of [a, b]) {
      assert.equal((await call('GET', `/api/aulas/${first}`, aluno)).status, 200);
      assert.equal((await call('GET', `/api/aulas/${second}`, aluno)).status, 403);
      assert.equal((await call('POST', `/api/aulas/${first}/progresso`, aluno, { finalizada: true })).status, 200);
      assert.equal((await call('GET', `/api/aulas/${second}`, aluno)).status, 200);
      assert.equal((await details(aluno)).data.progresso.concluidas, 1);
    }
  });
  await t.test('adicionar o terceiro aluno pelo curso não muda as autorizações dos demais', async () => {
    const before = await query('SELECT * FROM matriculas WHERE usuario_id IN (?,?) AND curso_id = ? ORDER BY usuario_id', [a, b, course]);
    assert.equal((await call('PUT', `/api/admin/cursos/${course}`, admin, { ...body,
      acessos: { conceder: [{ usuarioId: c }], revogar: [] } })).status, 200);
    assert.equal((await accesses(`cursoId=${course}`)).total, 3);
    assert.equal((await mine(c)).find((item) => item.id === course)?.situacao, 'ativo');
    assert.equal((await call('GET', `/api/aulas/${first}`, c)).status, 200);
    assert.deepEqual(await query('SELECT * FROM matriculas WHERE usuario_id IN (?,?) AND curso_id = ? ORDER BY usuario_id', [a, b, course]), before);
  });
  await t.test('pelo aluno usa a mesma matrícula e repetir a seleção preserva prazo e histórico', async () => {
    const before = await query('SELECT * FROM matriculas WHERE usuario_id = ? AND curso_id = ?', [c, course]);
    const history = await query('SELECT * FROM historico_acessos WHERE usuario_id = ? AND curso_id = ?', [c, course]);
    assert.equal((await call('POST', '/api/admin/acessos', admin, { usuarioId: c, cursoId: course })).status, 201);
    assert.equal((await accesses(`usuarioId=${c}`)).acessos.find((item) => item.cursoId === course).aluno.id, c);
    assert.deepEqual(await query('SELECT * FROM matriculas WHERE usuario_id = ? AND curso_id = ?', [c, course]), before);
    assert.deepEqual(await query('SELECT * FROM historico_acessos WHERE usuario_id = ? AND curso_id = ?', [c, course]), history);
  });
  await t.test('revogação pelo curso retira o aluno de Meus cursos e bloqueia novos acessos', async () => {
    assert.equal((await call('PUT', `/api/admin/cursos/${course}`, admin, { ...body, acessos: { conceder: [], revogar: [a] } })).status, 200);
    assert.ok(!(await mine(a)).some((item) => item.id === course)); assert.equal((await details(a)).status, 404);
    for (const lesson of [first, second, demo]) assert.equal((await call('GET', `/api/aulas/${lesson}`, a)).status, 403);
    assert.equal((await call('GET', `/api/aulas/${first}/midia`, a)).status, 403);
    assert.equal((await call('POST', `/api/aulas/${first}/progresso`, a, { finalizada: true })).status, 403);
    assert.equal((await accesses(`cursoId=${course}&usuarioId=${a}`)).acessos[0].situacao, 'revogado');
  });
  await t.test('revogação preserva progresso e reautorização retoma a próxima aula', async () => {
    const [progress] = await query('SELECT concluida FROM progresso_aulas WHERE usuario_id = ? AND aula_id = ?', [a, first]);
    assert.equal(progress.concluida, 1);
    assert.equal((await call('POST', '/api/admin/acessos', admin, { usuarioId: a, cursoId: course, prazoMeses: null })).status, 201);
    assert.equal((await details(a)).data.progresso.proximaAulaId, second);
    assert.equal((await call('GET', `/api/aulas/${second}`, a)).status, 200);
    assert.equal((await query('SELECT COUNT(*) AS n FROM matriculas WHERE usuario_id = ? AND curso_id = ?', [a, course]))[0].n, 1);
  });
  await t.test('revogação por Gerenciar acessos aparece na edição do curso e preserva progresso', async () => {
    assert.equal((await call('POST', '/api/admin/acessos/revogar', admin, { usuarioId: b, cursoId: course })).status, 200);
    assert.equal((await accesses(`cursoId=${course}&usuarioId=${b}`)).acessos[0].situacao, 'revogado');
    assert.ok(!(await mine(b)).some((item) => item.id === course));
    assert.equal((await query('SELECT concluida FROM progresso_aulas WHERE usuario_id = ? AND aula_id = ?', [b, first]))[0].concluida, 1);
  });
  await t.test('vencimento e início futuro também impedem visibilidade e acesso', async () => {
    for (const update of ["expira_em = DATE_SUB(NOW(), INTERVAL 1 DAY)", "expira_em = NULL, inicio_em = DATE_ADD(NOW(), INTERVAL 1 DAY)"]) {
      await query(`UPDATE matriculas SET ${update} WHERE usuario_id = ? AND curso_id = ?`, [c, course]);
      assert.ok(!(await mine(c)).some((item) => item.id === course)); assert.equal((await details(c)).status, 404);
      assert.equal((await call('GET', `/api/aulas/${demo}`, c)).status, 403);
    }
  });
  await t.test('USER não concede a si mesmo nem edita a seleção por requisição direta', async () => {
    for (const [method, route, payload] of [
      ['POST', '/api/admin/acessos', { usuarioId: d, cursoId: course }],
      ['POST', '/api/admin/acessos/revogar', { usuarioId: a, cursoId: course }],
      ['PUT', `/api/admin/cursos/${course}`, { ...body, acessos: { conceder: [{ usuarioId: d }], revogar: [] } }],
      ['POST', '/api/admin/cursos', { ...body, acessos: { conceder: [{ usuarioId: d }], revogar: [] } }],
      ['GET', `/api/admin/acessos?cursoId=${course}`, undefined],
    ]) assert.equal((await call(method, route, d, payload)).status, 403);
    assert.equal((await query('SELECT COUNT(*) AS n FROM matriculas WHERE usuario_id = ? AND curso_id = ?', [d, course]))[0].n, 0);
  });
  await t.test('falha em um aluno desfaz cadastro, concessões e histórico da seleção inteira', async () => {
    const title = `Inválido ${marca}`;
    const before = await query('SELECT * FROM historico_acessos ORDER BY id');
    const response = await call('POST', '/api/admin/cursos', admin, { ...body, titulo: title,
      acessos: { conceder: [{ usuarioId: d }, { usuarioId: admin }], revogar: [] } });
    assert.equal(response.status, 404);
    assert.equal((await query('SELECT COUNT(*) AS n FROM cursos WHERE titulo = ?', [title]))[0].n, 0);
    assert.deepEqual(await query('SELECT * FROM historico_acessos ORDER BY id'), before);
    assert.equal((await query('SELECT COUNT(*) AS n FROM matriculas WHERE usuario_id = ?', [d]))[0].n, 0);
  });
  await t.test('edição inválida desfaz curso e alterações de acesso, sem remover permissões válidas', async () => {
    const before = await query('SELECT * FROM matriculas WHERE curso_id = ? ORDER BY usuario_id', [course]);
    assert.equal((await call('PUT', `/api/admin/cursos/${course}`, admin, { ...body, titulo: `Outro ${marca}`,
      acessos: { conceder: [{ usuarioId: d }, { usuarioId: admin }], revogar: [a] } })).status, 404);
    assert.equal((await details(admin)).data.curso.titulo, body.titulo);
    assert.deepEqual(await query('SELECT * FROM matriculas WHERE curso_id = ? ORDER BY usuario_id', [course]), before);
    for (const selection of [{ conceder: [{ usuarioId: a }, { usuarioId: a }] },
      { conceder: [{ usuarioId: d, prazoMeses: 7 }] }, { conceder: [{ usuarioId: a }], revogar: [a] }]) {
      assert.equal((await call('PUT', `/api/admin/cursos/${course}`, admin, { ...body, acessos: selection })).status, 400);
    }
    assert.equal((await call('PUT', `/api/admin/cursos/${course}`, admin, { ...body, tipoAcesso: 'pago', precoCentavos: 29700,
      pixHabilitado: true, acessos: { conceder: [{ usuarioId: d }] } })).status, 400);
  });
  await t.test('listagem pelo curso pagina mais de cem alunos e o filtro pelo aluno é exato', async () => {
    const students = [];
    for (let i = 0; i < 101; i++) students.push(await user(`Lista${i}`));
    const response = await call('POST', '/api/admin/cursos', admin, { titulo: `Lista ${marca}`, tipoAcesso: 'restrito',
      acessos: { conceder: students.map((usuarioId) => ({ usuarioId })), revogar: [] } });
    assert.equal(response.status, 201); const id = response.data.curso.id; ids.cursos.push(id);
    const first = await accesses(`cursoId=${id}&pagina=1`), next = await accesses(`cursoId=${id}&pagina=2`);
    assert.equal(first.total, 101); assert.equal(first.acessos.length, 100); assert.equal(first.temMais, true);
    assert.equal(next.total, 101); assert.equal(next.acessos.length, 1); assert.equal(next.temMais, false);
    assert.equal(new Set([...first.acessos, ...next.acessos].map((item) => item.aluno.id)).size, 101);
    const person = await accesses(`usuarioId=${students[0]}`);
    assert.equal(person.total, 1); assert.equal(person.acessos[0].cursoId, id);
    assert.equal((await call('GET', '/api/admin/acessos?cursoId=abc', admin)).status, 400);
    assert.equal((await call('GET', '/api/admin/acessos?usuarioId=0', admin)).status, 400);
  });
});
