// Teste de integração do fluxo de compra, contra o banco configurado no .env.
//
// Uso: npm run test:integracao      (NÃO execute contra o banco de produção)
//
// Cria alunos, cursos e uma versão de teste dos Termos de Uso com um marcador próprio e apaga
// tudo ao terminar. Como ainda não há provedor de pagamentos integrado, as confirmações vêm de
// um provedor FALSO que existe apenas neste arquivo: o teste prova as regras do backend (aceite
// obrigatório, valores calculados no servidor, liberação só após confirmação, idempotência,
// prazos e revogação), não uma cobrança real.
process.env.JWT_SECRET = 'segredo-usado-apenas-nos-testes-automatizados';

const assert = require('node:assert/strict');
const { createHash, randomBytes } = require('node:crypto');
const { once } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const app = require('../src/app');
const { gerarToken } = require('../src/config/auth');
const database = require('../src/config/database');
const { pasta } = require('../src/config/storage');
const pagamentos = require('../src/pagamentos');
const { ErroRequisicao } = require('../src/utils/http');

const MARCA = `it4-${Date.now()}`;
const ASSINATURA = 'assinatura-correta-do-provedor-falso';

// Provedor falso: guarda os "pagamentos" em memória e muda de situação quando o teste manda.
const cobrancas = new Map();
const provedorFalso = {
  nome: 'teste-integracao',
  metodos: ['pix', 'cartao'],
  async parcelas({ totalCentavos, maxParcelas, parcelasSemJuros }) {
    return Array.from({ length: maxParcelas }, (_, indice) => {
      const parcelas = indice + 1;
      const total = parcelas <= parcelasSemJuros ? totalCentavos : Math.round(totalCentavos * (1 + 0.02 * parcelas));
      const valorParcelaCentavos = Math.ceil(total / parcelas);
      return { parcelas, valorParcelaCentavos, totalCentavos: valorParcelaCentavos * parcelas };
    });
  },
  async criarCobranca({ pedido }) {
    const pagamentoId = `pg-${MARCA}-${cobrancas.size + 1}`;
    // Cartão: aprovado na hora, como uma compra parcelada aceita pela operadora. Pix: aguarda.
    const status = pedido.forma_pagamento === 'cartao' ? 'aprovado' : 'pendente';
    cobrancas.set(pagamentoId, { pedidoId: pedido.id, status, valorCentavos: pedido.total_centavos });
    return {
      pagamentoId,
      status,
      expiraEm: new Date(Date.now() + 30 * 60 * 1000),
      pix: pedido.forma_pagamento === 'pix' ? { copiaECola: `00020126-TESTE-${pagamentoId}`, qrBase64: null } : undefined,
    };
  },
  async consultar(pagamentoId) {
    return { pagamentoId, ...cobrancas.get(pagamentoId) };
  },
  async validarNotificacao(req) {
    if (req.get('x-assinatura') !== ASSINATURA) throw new ErroRequisicao(401, 'Assinatura inválida.');
    return { eventoId: req.body.eventoId, pagamentoId: req.body.pagamentoId };
  },
};

test('fluxo de compra, termos e liberação de cursos', async (t) => {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const ids = { usuarios: [], cursos: [], documento: null };
  const arquivosDeTeste = [];
  const provedorAnterior = process.env.PAGAMENTO_PROVEDOR;

  const consulta = async (sql, parametros = []) => (await database.query(sql, parametros))[0];
  const chamar = async (metodo, caminho, { usuario, corpo, cabecalhos } = {}) => {
    const response = await fetch(`${base}${caminho}`, {
      method: metodo,
      headers: {
        ...(corpo !== undefined && { 'Content-Type': 'application/json' }),
        ...(usuario !== undefined && { Authorization: `Bearer ${gerarToken(usuario)}` }),
        ...cabecalhos,
      },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    return { status: response.status, dados: await response.json() };
  };
  const notificar = (pagamentoId, eventoId, assinatura = ASSINATURA) =>
    chamar('POST', `/api/pagamentos/notificacoes/${provedorFalso.nome}`, {
      corpo: { eventoId, pagamentoId },
      cabecalhos: { 'x-assinatura': assinatura },
    });

  t.after(async () => {
    pagamentos.remover(provedorFalso.nome);
    if (provedorAnterior === undefined) delete process.env.PAGAMENTO_PROVEDOR;
    else process.env.PAGAMENTO_PROVEDOR = provedorAnterior;

    // Só linhas criadas por este teste (ids guardados acima), na ordem das dependências.
    if (ids.usuarios.length > 0) {
      await consulta('DELETE FROM transacoes WHERE pedido_id IN (SELECT id FROM pedidos WHERE usuario_id IN (?))', [ids.usuarios]);
      await consulta('DELETE FROM historico_acessos WHERE usuario_id IN (?)', [ids.usuarios]);
      await consulta('DELETE FROM matriculas WHERE usuario_id IN (?)', [ids.usuarios]);
      await consulta('DELETE FROM pedidos WHERE usuario_id IN (?)', [ids.usuarios]);
      await consulta('DELETE FROM progresso_aulas WHERE usuario_id IN (?)', [ids.usuarios]);
      await consulta('DELETE FROM aceites_termos WHERE usuario_id IN (?)', [ids.usuarios]);
    }
    if (ids.documento !== null) await consulta('DELETE FROM documentos_legais WHERE id = ? AND versao = ?', [ids.documento, MARCA]);
    if (ids.cursos.length > 0) await consulta('DELETE FROM cursos WHERE id IN (?) AND titulo LIKE ?', [ids.cursos, `%${MARCA}%`]);
    if (ids.categoria) await consulta('DELETE FROM categorias WHERE id = ? AND nome LIKE ?', [ids.categoria, `%${MARCA}%`]);
    if (ids.usuarios.length > 0) await consulta('DELETE FROM usuarios WHERE id IN (?) AND email LIKE ?', [ids.usuarios, `%${MARCA}%`]);
    for (const arquivo of arquivosDeTeste) fs.rmSync(arquivo, { force: true });
    await new Promise((resolve) => server.close(resolve));
    await database.end();
  });

  // ---------- preparação
  const criarUsuario = async (nome, tipo) => {
    const resultado = await consulta('INSERT INTO usuarios (nome, email, senha, tipo) VALUES (?, ?, ?, ?)', [
      `${nome} ${MARCA}`,
      `${nome.toLowerCase()}-${MARCA}@teste.invalid`,
      'sem-login',
      tipo,
    ]);
    ids.usuarios.push(resultado.insertId);
    return resultado.insertId;
  };
  const ana = await criarUsuario('Ana', 'aluno');
  const bia = await criarUsuario('Bia', 'aluno');
  const carla = await criarUsuario('Carla', 'aluno');
  const admin = await criarUsuario('Admin', 'admin');

  const criarCurso = async (nome, campos) => {
    const dados = { titulo: `${nome} ${MARCA}`, descricao: 'Curso de teste.', status: 'publicado', ...campos };
    const resultado = await consulta('INSERT INTO cursos SET ?', [dados]);
    ids.cursos.push(resultado.insertId);
    const modulo = await consulta("INSERT INTO modulos (curso_id, titulo, ordem) VALUES (?, 'Aulas', 1)", [resultado.insertId]);
    const aulas = [];
    for (const [ordem, demonstrativa] of [[1, 0], [2, 0], [3, 1]]) {
      const aula = await consulta(
        `INSERT INTO aulas (modulo_id, titulo, tipo, link_externo, demonstrativa, ordem)
         VALUES (?, ?, 'spotify', 'https://open.spotify.com/track/teste', ?, ?)`,
        [modulo.insertId, `Aula ${ordem}`, demonstrativa, ordem],
      );
      aulas.push(aula.insertId);
    }
    await consulta('UPDATE cursos SET total_aulas = 3 WHERE id = ?', [resultado.insertId]);
    return { id: resultado.insertId, aulas };
  };
  const pago = await criarCurso('Pago', {
    tipo_acesso: 'pago',
    gratuito: 0,
    preco_centavos: 29700,
    pix_habilitado: 1,
    pix_desconto_percentual: 10,
    cartao_habilitado: 1,
    cartao_max_parcelas: 12,
    cartao_parcelas_sem_juros: 3,
    prazo_acesso_meses: 12,
  });
  const gratuito = await criarCurso('Gratuito', { tipo_acesso: 'gratuito', gratuito: 1 });
  const restrito = await criarCurso('Restrito', { tipo_acesso: 'restrito', gratuito: 0, prazo_acesso_meses: 24 });

  const texto = `Documento de teste automatizado ${MARCA}. Não é o texto dos Termos de Uso.`;
  const hash = createHash('sha256').update(texto).digest('hex');
  ids.documento = (
    await consulta(
      "INSERT INTO documentos_legais (tipo, versao, vigente_desde, texto, hash) VALUES ('termos', ?, CURDATE(), ?, ?)",
      [MARCA, texto, hash],
    )
  ).insertId;

  const comprar = (usuario, corpo) => chamar('POST', '/api/pedidos', { usuario, corpo: { cursoId: pago.id, ...corpo } });
  const detalhes = async (usuario, curso) => (await chamar('GET', `/api/cursos/${curso.id}`, { usuario })).dados;
  const abrirAula = (usuario, aula) => chamar('GET', `/api/aulas/${aula}`, { usuario });
  const pedidosDe = (usuario) => consulta('SELECT * FROM pedidos WHERE usuario_id = ? ORDER BY id', [usuario]);
  const matriculaDe = async (usuario, curso) =>
    (
      await consulta(
        `SELECT m.*, TIMESTAMPDIFF(MONTH, inicio_em, expira_em) AS meses,
                ABS(TIMESTAMPDIFF(SECOND, inicio_em, NOW())) AS idade_segundos
         FROM matriculas m WHERE usuario_id = ? AND curso_id = ?`,
        [usuario, curso.id],
      )
    )[0];

  // ---------- termos de uso
  await t.test('visitante vê preço e condições do curso pago, sem acesso', async () => {
    const { curso, acesso, termosPendentes } = await detalhes(undefined, pago);
    assert.equal(acesso.estado, 'visitante');
    assert.equal(termosPendentes, false);
    assert.equal(curso.tipoAcesso, 'pago');
    assert.deepEqual(curso.comercial, {
      precoCentavos: 29700,
      prazoAcessoMeses: 12,
      pix: { descontoPercentual: 10, descontoCentavos: 2970, totalCentavos: 26730 },
      cartao: { maxParcelas: 12, parcelasSemJuros: 3 },
    });
    assert.equal((await chamar('GET', `/api/cursos/${pago.id}/oferta`)).status, 401);
    assert.equal((await chamar('POST', '/api/pedidos', { corpo: { cursoId: pago.id } })).status, 401);
  });

  await t.test('sem aceite dos termos: nem oferta, nem pedido, nem aula (mesmo com provedor ativo)', async () => {
    pagamentos.registrar(provedorFalso);
    process.env.PAGAMENTO_PROVEDOR = provedorFalso.nome;

    assert.equal((await detalhes(ana, pago)).termosPendentes, true);
    for (const resposta of [
      await chamar('GET', `/api/cursos/${pago.id}/oferta`, { usuario: ana }),
      await comprar(ana, { formaPagamento: 'pix' }),
      await abrirAula(ana, gratuito.aulas[0]),
      await abrirAula(ana, pago.aulas[2]),
    ]) {
      assert.equal(resposta.status, 428);
      assert.equal(resposta.dados.codigo, 'TERMOS_PENDENTES');
    }
    assert.equal((await pedidosDe(ana)).length, 0);
  });

  await t.test('o aceite exige a marcação explícita e o documento vigente', async () => {
    const aceitar = (corpo) => chamar('POST', '/api/termos/aceite', { usuario: ana, corpo });
    assert.equal((await aceitar({ documentoId: ids.documento, hash })).status, 400);
    assert.equal((await aceitar({ documentoId: ids.documento, hash, aceito: false })).status, 400);
    assert.equal((await aceitar({ documentoId: ids.documento, hash: 'outro', aceito: true })).status, 409);
    assert.equal((await aceitar({ documentoId: ids.documento + 999, hash, aceito: true })).status, 409);
    assert.equal((await consulta('SELECT COUNT(*) AS n FROM aceites_termos WHERE usuario_id = ?', [ana]))[0].n, 0);
  });

  await t.test('aceitar registra usuário, versão, hash e horário; repetir não cria outro registro', async () => {
    const vigente = (await chamar('GET', '/api/termos', { usuario: ana })).dados;
    assert.equal(vigente.termos.versao, MARCA);
    assert.equal(vigente.termos.texto, texto);
    assert.equal(vigente.aceite, null);

    for (const usuario of [ana, bia, carla]) {
      const resposta = await chamar('POST', '/api/termos/aceite', {
        usuario,
        corpo: { documentoId: vigente.termos.id, hash: vigente.termos.hash, aceito: true },
      });
      assert.equal(resposta.status, 201);
      assert.equal(resposta.dados.aceite.versao, MARCA);
    }
    const [registro] = await consulta('SELECT * FROM aceites_termos WHERE usuario_id = ?', [ana]);
    assert.equal(registro.documento_id, ids.documento);
    assert.equal(registro.versao, MARCA);
    assert.equal(registro.hash, hash);
    assert.ok(registro.aceito_em instanceof Date);

    await chamar('POST', '/api/termos/aceite', { usuario: ana, corpo: { documentoId: ids.documento, hash, aceito: true } });
    const depois = await consulta('SELECT id, aceito_em FROM aceites_termos WHERE usuario_id = ?', [ana]);
    assert.equal(depois.length, 1);
    assert.equal(depois[0].id, registro.id);
    assert.equal((await detalhes(ana, pago)).termosPendentes, false);
    assert.equal((await chamar('GET', '/api/termos', { usuario: ana })).dados.aceite.versao, MARCA);
  });

  // ---------- tipos de acesso
  await t.test('curso gratuito e curso restrito não têm oferta nem pedido', async () => {
    assert.equal((await detalhes(ana, gratuito)).acesso.estado, 'liberado');
    assert.equal((await chamar('GET', `/api/cursos/${restrito.id}`, { usuario: ana })).status, 404);
    assert.equal((await abrirAula(ana, gratuito.aulas[0])).status, 200);
    assert.equal((await abrirAula(ana, restrito.aulas[0])).status, 403);
    for (const curso of [gratuito, restrito]) {
      const oferta = await chamar('GET', `/api/cursos/${curso.id}/oferta`, { usuario: ana });
      assert.equal(oferta.status, 409);
      assert.equal(oferta.dados.codigo, 'NAO_VENDIDO');
      const pedido = await chamar('POST', '/api/pedidos', { usuario: ana, corpo: { cursoId: curso.id, formaPagamento: 'pix' } });
      assert.equal(pedido.status, 409);
    }
    assert.equal((await pedidosDe(ana)).length, 0);
  });

  await t.test('sem provedor de pagamentos nenhum pedido é criado', async () => {
    delete process.env.PAGAMENTO_PROVEDOR;
    const oferta = (await chamar('GET', `/api/cursos/${pago.id}/oferta`, { usuario: ana })).dados;
    assert.equal(oferta.pagamentos.disponivel, false);
    assert.equal(oferta.pagamentos.metodos.find((metodo) => metodo.forma === 'cartao').opcoes, null);
    const resposta = await comprar(ana, { formaPagamento: 'pix' });
    assert.equal(resposta.status, 503);
    assert.equal(resposta.dados.codigo, 'PAGAMENTO_INDISPONIVEL');
    assert.equal((await pedidosDe(ana)).length, 0);
    process.env.PAGAMENTO_PROVEDOR = provedorFalso.nome;
  });

  await t.test('a oferta traz o preço real, o Pix com desconto e as parcelas informadas pelo provedor', async () => {
    assert.equal((await detalhes(ana, pago)).acesso.estado, 'comprar');
    const bloqueios = (await detalhes(ana, pago)).modulos.flatMap((modulo) => modulo.aulas);
    assert.equal(bloqueios[0].bloqueio, 'acesso');
    const { dados: oferta } = await chamar('GET', `/api/cursos/${pago.id}/oferta`, { usuario: ana });
    assert.equal(oferta.curso.totalAulas, 3);
    assert.equal(oferta.curso.totalModulos, 1);
    assert.equal(oferta.comercial.precoCentavos, 29700);
    assert.equal(oferta.pagamentos.disponivel, true);
    const [pix, cartao] = oferta.pagamentos.metodos;
    assert.deepEqual(pix, { forma: 'pix', totalCentavos: 26730, descontoCentavos: 2970 });
    assert.equal(cartao.opcoes.length, 12);
    assert.deepEqual(cartao.opcoes[2], { parcelas: 3, valorParcelaCentavos: 9900, totalCentavos: 29700, jurosCentavos: 0 });
    // 6x com juros (regra do provedor falso): 29700 * 1,12 = 33264 → 6 x 5544.
    assert.deepEqual(cartao.opcoes[5], { parcelas: 6, valorParcelaCentavos: 5544, totalCentavos: 33264, jurosCentavos: 3564 });
  });

  // ---------- pedido, pagamento e liberação
  let pedidoAna;
  let pagamentoAna;
  await t.test('o pedido usa os valores do servidor e, pendente, não libera o curso', async () => {
    assert.equal((await comprar(ana, { formaPagamento: 'boleto' })).status, 400);
    assert.equal((await comprar(ana, { formaPagamento: 'pix', parcelas: 3 })).status, 400);
    assert.equal((await comprar(ana, { formaPagamento: 'cartao', parcelas: 13 })).status, 400);

    // Valores enviados pelo aplicativo são ignorados.
    const resposta = await comprar(ana, { formaPagamento: 'pix', totalCentavos: 1, precoCentavos: 1, descontoCentavos: 29699 });
    assert.equal(resposta.status, 201);
    pedidoAna = resposta.dados.pedido;
    assert.equal(pedidoAna.status, 'pendente');
    assert.equal(pedidoAna.precoCentavos, 29700);
    assert.equal(pedidoAna.descontoCentavos, 2970);
    assert.equal(pedidoAna.totalCentavos, 26730);
    assert.equal(pedidoAna.prazoAcessoMeses, 12);
    assert.match(pedidoAna.pix.copiaECola, /TESTE/);
    assert.ok(pedidoAna.expiraEm);
    [pagamentoAna] = [...cobrancas.keys()];

    assert.equal((await matriculaDe(ana, pago)), undefined);
    const curso = await detalhes(ana, pago);
    assert.equal(curso.acesso.estado, 'pendente');
    assert.equal(curso.acesso.pedidoId, pedidoAna.id);
    const aula = await abrirAula(ana, pago.aulas[0]);
    assert.equal(aula.status, 403);
    assert.equal(aula.dados.codigo, 'SEM_ACESSO');
  });

  await t.test('repetir a compra devolve o mesmo pedido, sem nova cobrança', async () => {
    const [primeira, segunda] = await Promise.all([comprar(ana, { formaPagamento: 'pix' }), comprar(ana, { formaPagamento: 'cartao', parcelas: 2 })]);
    assert.equal(primeira.dados.pedido.id, pedidoAna.id);
    assert.equal(segunda.dados.pedido.id, pedidoAna.id);
    assert.equal((await pedidosDe(ana)).length, 1);
    assert.equal(cobrancas.size, 1);
  });

  await t.test('aula demonstrativa abre sem compra; as demais continuam protegidas', async () => {
    const demonstracao = await abrirAula(ana, pago.aulas[2]);
    assert.equal(demonstracao.status, 200);
    assert.equal(demonstracao.dados.demonstracao, true);
    assert.equal(demonstracao.dados.proxima, null);
    assert.equal((await abrirAula(ana, pago.aulas[1])).status, 403);
    const curso = await detalhes(ana, pago);
    assert.deepEqual(curso.modulos[0].aulas.map((aula) => aula.demonstrativa), [false, false, true]);
  });

  await t.test('notificação sem assinatura válida ou com pagamento ainda pendente não libera nada', async () => {
    assert.equal((await notificar(pagamentoAna, `${MARCA}-forjada`, 'assinatura-errada')).status, 401);
    assert.equal((await notificar(pagamentoAna, `${MARCA}-pendente`)).status, 200);
    assert.equal((await chamar('GET', `/api/pedidos/${pedidoAna.id}`, { usuario: ana })).dados.pedido.status, 'pendente');
    assert.equal(await matriculaDe(ana, pago), undefined);
  });

  await t.test('pagamento com valor diferente do pedido não é aprovado', async () => {
    cobrancas.get(pagamentoAna).status = 'aprovado';
    cobrancas.get(pagamentoAna).valorCentavos = 100;
    assert.equal((await notificar(pagamentoAna, `${MARCA}-valor-errado`)).status, 200);
    assert.equal((await pedidosDe(ana))[0].status, 'pendente');
    assert.equal(await matriculaDe(ana, pago), undefined);
    cobrancas.get(pagamentoAna).valorCentavos = 26730;
  });

  await t.test('pagamento confirmado libera o curso e o prazo começa na confirmação', async () => {
    // O pedido foi "criado" há 10 dias: o prazo não pode contar a partir da criação.
    await consulta('UPDATE pedidos SET criado_em = DATE_SUB(NOW(), INTERVAL 10 DAY) WHERE id = ?', [pedidoAna.id]);
    assert.equal((await notificar(pagamentoAna, `${MARCA}-aprovado`)).status, 200);

    const [pedido] = await pedidosDe(ana);
    assert.equal(pedido.status, 'aprovado');
    assert.ok(pedido.aprovado_em instanceof Date);
    const matricula = await matriculaDe(ana, pago);
    assert.equal(matricula.origem, 'compra');
    assert.equal(matricula.pedido_id, pedidoAna.id);
    assert.equal(matricula.meses, 12);
    assert.ok(matricula.idade_segundos < 60, 'o início do acesso deve ser o momento da aprovação');
    assert.equal(matricula.inicio_em.getTime(), pedido.aprovado_em.getTime());

    const curso = await detalhes(ana, pago);
    assert.equal(curso.acesso.estado, 'liberado');
    assert.equal(curso.acesso.origem, 'compra');
    assert.ok(curso.acesso.diasRestantes >= 364);
    assert.equal(curso.acesso.pertoDeVencer, false);
    const publico = (await chamar('GET', `/api/pedidos/${pedidoAna.id}`, { usuario: ana })).dados.pedido;
    assert.equal(publico.pix, null);
  });

  await t.test('notificações repetidas não liberam nem registram duas vezes', async () => {
    const liberacoes = () =>
      consulta("SELECT COUNT(*) AS n FROM historico_acessos WHERE usuario_id = ? AND acao = 'liberacao_compra'", [ana]);
    const antes = await matriculaDe(ana, pago);
    await Promise.all([
      notificar(pagamentoAna, `${MARCA}-aprovado`),
      notificar(pagamentoAna, `${MARCA}-aprovado`),
      notificar(pagamentoAna, `${MARCA}-aprovado-de-novo`),
    ]);
    await chamar('GET', `/api/pedidos/${pedidoAna.id}`, { usuario: ana });
    assert.equal((await liberacoes())[0].n, 1);
    assert.equal((await consulta('SELECT COUNT(*) AS n FROM matriculas WHERE usuario_id = ?', [ana]))[0].n, 1);
    assert.equal((await matriculaDe(ana, pago)).expira_em.getTime(), antes.expira_em.getTime());
    const eventos = await consulta('SELECT evento_id FROM transacoes WHERE pedido_id = ?', [pedidoAna.id]);
    assert.equal(eventos.filter((evento) => evento.evento_id === `${MARCA}-aprovado`).length, 1);
  });

  await t.test('quem já tem acesso não é cobrado de novo', async () => {
    const resposta = await comprar(ana, { formaPagamento: 'pix' });
    assert.equal(resposta.status, 409);
    assert.equal(resposta.dados.codigo, 'JA_LIBERADO');
    assert.equal((await chamar('GET', `/api/cursos/${pago.id}/oferta`, { usuario: ana })).status, 409);
    assert.equal((await pedidosDe(ana)).length, 1);
    assert.equal(cobrancas.size, 1);
  });

  await t.test('Meus cursos e histórico mostram a compra; a progressão das aulas continua valendo', async () => {
    const aulas = (await detalhes(ana, pago)).modulos.flatMap((modulo) => modulo.aulas);
    assert.equal(aulas[0].bloqueio, null);
    assert.equal(aulas[1].bloqueio, 'sequencia');
    const { cursos } = (await chamar('GET', '/api/meus-cursos', { usuario: ana })).dados;
    const meu = cursos.find((curso) => curso.id === pago.id);
    assert.equal(meu.situacao, 'ativo');
    assert.equal(meu.percentual, 0);
    assert.ok(meu.inicioEm && meu.expiraEm);

    const { pedidos } = (await chamar('GET', '/api/pedidos', { usuario: ana })).dados;
    assert.equal(pedidos.length, 1);
    assert.equal(pedidos[0].status, 'aprovado');
    assert.equal(pedidos[0].formaPagamento, 'pix');

    assert.equal((await abrirAula(ana, pago.aulas[0])).status, 200);
    const bloqueada = await abrirAula(ana, pago.aulas[1]);
    assert.equal(bloqueada.status, 403);
    assert.equal(bloqueada.dados.codigo, 'BLOQUEADA');
    const concluir = await chamar('POST', `/api/aulas/${pago.aulas[0]}/progresso`, { usuario: ana, corpo: { finalizada: true } });
    assert.equal(concluir.dados.concluida, true);
    assert.equal((await abrirAula(ana, pago.aulas[1])).status, 200);
    assert.equal((await detalhes(ana, pago)).progresso.concluidas, 1);
  });

  await t.test('compra parcelada aprovada libera na hora, com parcelas e juros do provedor', async () => {
    const resposta = await comprar(bia, { formaPagamento: 'cartao', parcelas: 6 });
    assert.equal(resposta.status, 201);
    const { pedido } = resposta.dados;
    assert.equal(pedido.status, 'aprovado');
    assert.equal(pedido.parcelas, 6);
    assert.equal(pedido.valorParcelaCentavos, 5544);
    assert.equal(pedido.totalCentavos, 33264);
    assert.equal(pedido.jurosCentavos, 3564);
    assert.equal(pedido.descontoCentavos, 0);
    assert.equal((await detalhes(bia, pago)).acesso.estado, 'liberado');
    assert.equal((await matriculaDe(bia, pago)).meses, 12);
  });

  await t.test('alterar o preço do curso não muda compras já feitas', async () => {
    await consulta('UPDATE cursos SET preco_centavos = 49700, prazo_acesso_meses = 24 WHERE id = ?', [pago.id]);
    const [pedido] = await pedidosDe(ana);
    assert.equal(pedido.preco_centavos, 29700);
    assert.equal(pedido.total_centavos, 26730);
    assert.equal(pedido.prazo_acesso_meses, 12);
    assert.equal((await detalhes(carla, pago)).curso.comercial.precoCentavos, 49700);
  });

  // ---------- vencimento, reembolso e revogação
  await t.test('acesso vencido bloqueia a reprodução e preserva o progresso', async () => {
    await consulta('UPDATE matriculas SET expira_em = DATE_SUB(NOW(), INTERVAL 1 DAY) WHERE usuario_id = ? AND curso_id = ?', [ana, pago.id]);
    const aula = await abrirAula(ana, pago.aulas[1]);
    assert.equal(aula.status, 403);
    assert.match(aula.dados.message, /prazo de acesso/);
    assert.equal((await chamar('GET', `/api/aulas/${pago.aulas[1]}/midia`, { usuario: ana })).status, 403);

    const curso = await detalhes(ana, pago);
    assert.equal(curso.acesso.estado, 'comprar');
    assert.equal(curso.acesso.motivo, 'vencido');
    assert.equal(curso.progresso.concluidas, 1);
    assert.equal(curso.progresso.proximaAulaId, null);
    const { cursos } = (await chamar('GET', '/api/meus-cursos', { usuario: ana })).dados;
    assert.equal(cursos.find((item) => item.id === pago.id).situacao, 'vencido');
    assert.equal(cursos.find((item) => item.id === pago.id).aulasConcluidas, 1);
  });

  await t.test('reembolso encerra o acesso da compra sem apagar o pedido nem o progresso', async () => {
    const [pagamentoBia] = [...cobrancas.keys()].slice(-1);
    await chamar('POST', `/api/aulas/${pago.aulas[0]}/progresso`, { usuario: bia, corpo: { finalizada: true } });
    cobrancas.get(pagamentoBia).status = 'reembolsado';
    assert.equal((await notificar(pagamentoBia, `${MARCA}-reembolso`)).status, 200);

    const [pedido] = await pedidosDe(bia);
    assert.equal(pedido.status, 'reembolsado');
    assert.ok(pedido.aprovado_em instanceof Date);
    const matricula = await matriculaDe(bia, pago);
    assert.ok(matricula.revogado_em instanceof Date);
    assert.equal(matricula.motivo_revogacao, 'Compra reembolsada.');
    assert.equal((await abrirAula(bia, pago.aulas[1])).status, 403);
    const curso = await detalhes(bia, pago);
    assert.equal(curso.acesso.motivo, 'revogado');
    assert.equal(curso.progresso.concluidas, 1);
  });

  await t.test('ADMIN libera e revoga manualmente; isso não gera pagamento', async () => {
    const pedidosAntes = (await consulta('SELECT COUNT(*) AS n FROM pedidos'))[0].n;
    const liberar = (corpo) => chamar('POST', '/api/admin/acessos', { usuario: admin, corpo });

    assert.equal((await liberar({ usuarioId: carla, cursoId: gratuito.id })).status, 400);
    assert.equal((await liberar({ usuarioId: carla, cursoId: restrito.id, prazoMeses: 7 })).status, 400);
    assert.equal((await liberar({ usuarioId: carla, cursoId: restrito.id, inicioEm: '31/12/2026' })).status, 400);
    assert.equal((await liberar({ usuarioId: carla, cursoId: restrito.id, inicioEm: '2020-01-01', prazoMeses: 12 })).status, 400);
    assert.equal((await liberar({ usuarioId: admin, cursoId: restrito.id })).status, 404);

    // Sem prazo informado, vale o do curso (24 meses), contado a partir da concessão.
    assert.equal((await liberar({ usuarioId: carla, cursoId: restrito.id })).status, 201);
    let matricula = await matriculaDe(carla, restrito);
    assert.equal(matricula.origem, 'manual');
    assert.equal(matricula.concedido_por, admin);
    assert.equal(matricula.meses, 24);
    assert.ok(matricula.idade_segundos < 60);
    assert.equal((await abrirAula(carla, restrito.aulas[0])).status, 200);

    // Com data de início e prazo próprios.
    assert.equal((await liberar({ usuarioId: carla, cursoId: restrito.id, inicioEm: '2026-01-15', prazoMeses: null })).status, 201);
    matricula = await matriculaDe(carla, restrito);
    assert.equal(matricula.expira_em, null);
    assert.equal(matricula.inicio_em.getFullYear(), 2026);
    assert.equal((await consulta('SELECT COUNT(*) AS n FROM pedidos'))[0].n, pedidosAntes);

    await chamar('POST', `/api/aulas/${restrito.aulas[0]}/progresso`, { usuario: carla, corpo: { finalizada: true } });
    const revogar = (corpo) => chamar('POST', '/api/admin/acessos/revogar', { usuario: admin, corpo });
    assert.equal((await revogar({ usuarioId: carla, cursoId: restrito.id, motivo: 'Teste.' })).status, 200);
    assert.equal((await revogar({ usuarioId: carla, cursoId: restrito.id })).status, 404);
    const aula = await abrirAula(carla, restrito.aulas[1]);
    assert.equal(aula.status, 403);
    assert.match(aula.dados.message, /encerrado/);
    assert.equal((await chamar('GET', `/api/cursos/${restrito.id}`, { usuario: carla })).status, 404);
    assert.equal((await consulta('SELECT COUNT(*) AS n FROM progresso_aulas WHERE usuario_id = ? AND concluida = 1', [carla]))[0].n, 1);

    const historico = await consulta('SELECT acao FROM historico_acessos WHERE usuario_id = ? ORDER BY id', [carla]);
    assert.deepEqual(historico.map((linha) => linha.acao), ['liberacao_manual', 'liberacao_manual', 'revogacao']);
  });

  await t.test('ADMIN consulta compras e acessos; aluno não acessa nem altera nada disso', async () => {
    const compras = (await chamar('GET', `/api/admin/pedidos?busca=${MARCA}`, { usuario: admin })).dados.pedidos;
    assert.deepEqual(compras.map((pedido) => pedido.status).sort(), ['aprovado', 'reembolsado']);
    assert.ok(compras.every((pedido) => pedido.aluno.email.includes(MARCA)));
    const aprovadas = (await chamar('GET', `/api/admin/pedidos?status=aprovado&busca=${MARCA}`, { usuario: admin })).dados.pedidos;
    assert.equal(aprovadas.length, 1);
    assert.equal(aprovadas[0].totalCentavos, 26730);

    const acessos = (await chamar('GET', `/api/admin/acessos?busca=${MARCA}`, { usuario: admin })).dados.acessos;
    assert.deepEqual(acessos.map((acesso) => acesso.situacao).sort(), ['revogado', 'revogado', 'vencido']);
    const vencidos = (await chamar('GET', `/api/admin/acessos?situacao=vencido&busca=${MARCA}`, { usuario: admin })).dados.acessos;
    assert.equal(vencidos.length, 1);
    assert.equal(vencidos[0].aluno.id, ana);

    const resumo = (await chamar('GET', '/api/admin/comercial/resumo', { usuario: admin })).dados;
    assert.ok(resumo.pedidos.aprovados >= 1 && resumo.pedidos.reembolsados >= 1);
    assert.ok(resumo.pedidos.recebidoCentavos >= 26730);
    assert.equal(resumo.pagamentos.provedor, provedorFalso.nome);
    const alunos = (await chamar('GET', `/api/admin/alunos?busca=${MARCA}`, { usuario: admin })).dados.alunos;
    assert.equal(alunos.length, 3);

    for (const [metodo, caminho, corpo] of [
      ['GET', '/api/admin/pedidos'],
      ['GET', '/api/admin/acessos'],
      ['GET', '/api/admin/alunos'],
      ['GET', '/api/admin/comercial/resumo'],
      ['POST', '/api/admin/acessos', { usuarioId: carla, cursoId: pago.id }],
      ['POST', '/api/admin/acessos/revogar', { usuarioId: ana, cursoId: pago.id }],
    ]) {
      assert.equal((await chamar(metodo, caminho, { usuario: carla, corpo })).status, 403, caminho);
    }
    assert.equal(await matriculaDe(carla, pago), undefined);

    // Um aluno não enxerga nem cancela a compra de outro.
    assert.equal((await chamar('GET', `/api/pedidos/${pedidoAna.id}`, { usuario: carla })).status, 404);
    assert.equal((await chamar('POST', `/api/pedidos/${pedidoAna.id}/cancelar`, { usuario: carla })).status, 404);
    // E uma compra aprovada não pode ser "cancelada" pelo aplicativo.
    assert.equal((await chamar('POST', `/api/pedidos/${pedidoAna.id}/cancelar`, { usuario: ana })).status, 409);
  });

  await t.test('o aluno pode desistir de uma compra pendente e tentar de novo', async () => {
    const primeira = (await comprar(carla, { formaPagamento: 'pix' })).dados.pedido;
    assert.equal(primeira.totalCentavos, 44730); // preço novo (497,00) com 10% de desconto
    const cancelada = await chamar('POST', `/api/pedidos/${primeira.id}/cancelar`, { usuario: carla });
    assert.equal(cancelada.dados.pedido.status, 'cancelado');
    assert.equal((await detalhes(carla, pago)).acesso.estado, 'comprar');
    const segunda = (await comprar(carla, { formaPagamento: 'pix' })).dados.pedido;
    assert.notEqual(segunda.id, primeira.id);
    assert.equal((await pedidosDe(carla)).length, 2);
  });

  await t.test('uma nova versão dos termos que exige aceite volta a bloquear a compra', async () => {
    const novo = await consulta(
      "INSERT INTO documentos_legais (tipo, versao, vigente_desde, texto, hash) VALUES ('termos', ?, CURDATE(), ?, ?)",
      [`${MARCA}b`.slice(0, 20), `${texto} v2`, createHash('sha256').update(`${texto} v2`).digest('hex')],
    );
    try {
      assert.equal((await detalhes(bia, pago)).termosPendentes, true);
      assert.equal((await comprar(bia, { formaPagamento: 'pix' })).status, 428);
      assert.equal((await chamar('GET', '/api/termos', { usuario: bia })).dados.aceite, null);
      // O aceite da versão antiga é recusado para o documento novo.
      const antigo = await chamar('POST', '/api/termos/aceite', { usuario: bia, corpo: { documentoId: ids.documento, hash, aceito: true } });
      assert.equal(antigo.status, 409);
      assert.equal(antigo.dados.codigo, 'TERMOS_ATUALIZADOS');

      // Uma versão que não exige novo aceite mantém válido o aceite anterior.
      await consulta('UPDATE documentos_legais SET exige_novo_aceite = 0 WHERE id = ?', [novo.insertId]);
      assert.equal((await detalhes(bia, pago)).termosPendentes, false);
    } finally {
      await consulta('DELETE FROM documentos_legais WHERE id = ?', [novo.insertId]);
    }
  });

  await t.test('curso pago sem preço válido: salva como rascunho, mas a API não publica', async () => {
    const categoria = await consulta('INSERT INTO categorias (nome) VALUES (?)', [`Categoria ${MARCA}`]);
    ids.categoria = categoria.insertId;
    const comoAdmin = (metodo, caminho, corpo) => chamar(metodo, `/api/admin/cursos${caminho}`, { usuario: admin, corpo });
    const PRECO = 'Este curso está configurado como pago, mas ainda não possui um valor válido cadastrado. Informe o preço antes de publicar.';

    // Rascunho pago sem preço: aceito.
    const base = { titulo: `Novo ${MARCA}`, descricao: 'Curso de teste.', categoriaId: ids.categoria, tipoAcesso: 'pago' };
    const criado = await comoAdmin('POST', '', base);
    assert.equal(criado.status, 201);
    const rascunho = criado.dados.curso;
    ids.cursos.push(rascunho.id);
    assert.equal(rascunho.status, 'rascunho');
    assert.equal(rascunho.tipoAcesso, 'pago');
    assert.equal(rascunho.precoCentavos, null);

    // Valores inválidos nunca são gravados, nem em rascunho.
    for (const precoCentavos of [0, -100, 297.5, '29700', 10000001]) {
      assert.equal((await comoAdmin('PUT', `/${rascunho.id}`, { ...base, precoCentavos })).status, 400, String(precoCentavos));
    }

    // Publicar direto pela API: recusado, com a mensagem e os campos pendentes.
    await consulta("INSERT INTO modulos (curso_id, titulo, ordem) VALUES (?, 'Aulas', 1)", [rascunho.id]);
    await consulta(
      "INSERT INTO aulas (modulo_id, titulo, tipo, link_externo, ordem) SELECT id, 'Aula', 'spotify', 'https://open.spotify.com/track/teste', 1 FROM modulos WHERE curso_id = ?",
      [rascunho.id],
    );
    await consulta('UPDATE cursos SET total_aulas = 1 WHERE id = ?', [rascunho.id]);
    let publicar = await comoAdmin('PUT', `/${rascunho.id}/status`, { status: 'publicado' });
    assert.equal(publicar.status, 422);
    assert.equal(publicar.dados.message, 'Não é possível publicar este curso.');
    assert.deepEqual(publicar.dados.campos, ['preco', 'pagamento']);
    assert.equal(publicar.dados.pendencias[0], PRECO);
    assert.equal((await consulta('SELECT status FROM cursos WHERE id = ?', [rascunho.id]))[0].status, 'rascunho');

    // Com preço, mas sem forma de pagamento: ainda não publica.
    assert.equal((await comoAdmin('PUT', `/${rascunho.id}`, { ...base, precoCentavos: 29700 })).status, 200);
    publicar = await comoAdmin('PUT', `/${rascunho.id}/status`, { status: 'publicado' });
    assert.deepEqual(publicar.dados.campos, ['pagamento']);

    // Preço válido e Pix habilitado: publica.
    const completo = { ...base, precoCentavos: 29700, pixHabilitado: true, prazoAcessoMeses: 12 };
    assert.equal((await comoAdmin('PUT', `/${rascunho.id}`, completo)).status, 200);
    assert.equal((await comoAdmin('PUT', `/${rascunho.id}/status`, { status: 'publicado' })).status, 200);

    // Publicado: não pode voltar a ficar sem preço por uma edição, e nada é alterado.
    const semPreco = await comoAdmin('PUT', `/${rascunho.id}`, { ...completo, precoCentavos: null });
    assert.equal(semPreco.status, 422);
    assert.deepEqual(semPreco.dados.campos, ['preco']);
    assert.equal((await consulta('SELECT preco_centavos FROM cursos WHERE id = ?', [rascunho.id]))[0].preco_centavos, 29700);
    // Curso gratuito ou restrito não exige preço.
    assert.equal((await comoAdmin('PUT', `/${rascunho.id}`, { ...base, tipoAcesso: 'restrito' })).status, 200);
    assert.equal((await comoAdmin('PUT', `/${rascunho.id}`, completo)).status, 200);

    // Um curso pago publicado sem preço por outro caminho (direto no banco) é apontado no resumo
    // e não é vendido: o aluno não recebe oferta nem cria pedido.
    await consulta('UPDATE cursos SET preco_centavos = NULL WHERE id = ?', [rascunho.id]);
    const resumo = (await chamar('GET', '/api/admin/comercial/resumo', { usuario: admin })).dados;
    const apontado = resumo.cursosComPendencias.find((curso) => curso.id === rascunho.id);
    assert.deepEqual(apontado.pendencias, [PRECO]);
    const oferta = await chamar('GET', `/api/cursos/${rascunho.id}/oferta`, { usuario: carla });
    assert.equal(oferta.status, 409);
    assert.equal(oferta.dados.codigo, 'NAO_VENDIDO');
    assert.equal((await chamar('POST', '/api/pedidos', { usuario: carla, corpo: { cursoId: rascunho.id, formaPagamento: 'pix' } })).status, 409);
    assert.equal((await chamar('GET', `/api/aulas/${(await consulta('SELECT a.id FROM aulas a JOIN modulos m ON m.id = a.modulo_id WHERE m.curso_id = ?', [rascunho.id]))[0].id}`, { usuario: carla })).status, 403);
  });

  await t.test('a oferta traz instrutora e descrição do curso', async () => {
    await consulta("UPDATE cursos SET instrutora = 'Instrutora Teste', subtitulo = 'Resumo do curso' WHERE id = ?", [pago.id]);
    const { dados } = await chamar('GET', `/api/cursos/${pago.id}/oferta`, { usuario: carla });
    assert.equal(dados.curso.instrutora, 'Instrutora Teste');
    assert.equal(dados.curso.subtitulo, 'Resumo do curso');
    assert.equal(dados.curso.descricao, 'Curso de teste.');
  });

  await t.test('outro curso pago reutiliza o aceite vigente e entrega somente as próprias condições', async () => {
    const outro = await criarCurso('Outro pago', {
      tipo_acesso: 'pago', gratuito: 0, preco_centavos: 15990,
      instrutora: 'Outra instrutora', descricao: 'Descrição do segundo curso.',
      subtitulo: 'Subtítulo do segundo curso.', pix_habilitado: 1, prazo_acesso_meses: 24,
    });
    const antes = await consulta('SELECT id, versao, hash, aceito_em FROM aceites_termos WHERE usuario_id = ?', [ana]);
    assert.equal((await detalhes(ana, outro)).termosPendentes, false);
    const resposta = await chamar('GET', `/api/cursos/${outro.id}/oferta`, { usuario: ana });
    assert.equal(resposta.status, 200);
    assert.equal(resposta.dados.curso.id, outro.id);
    assert.equal(resposta.dados.curso.titulo, `Outro pago ${MARCA}`);
    assert.equal(resposta.dados.curso.instrutora, 'Outra instrutora');
    assert.equal(resposta.dados.curso.descricao, 'Descrição do segundo curso.');
    assert.equal(resposta.dados.comercial.precoCentavos, 15990);
    assert.equal(resposta.dados.comercial.prazoAcessoMeses, 24);
    assert.deepEqual(await consulta('SELECT id, versao, hash, aceito_em FROM aceites_termos WHERE usuario_id = ?', [ana]), antes);
  });

  await t.test('curso gratuito inicia sem compra e salva a progressão até a conclusão', async () => {
    const pedidosAntes = await pedidosDe(bia);
    assert.equal((await detalhes(bia, gratuito)).termosPendentes, false);
    assert.equal((await abrirAula(bia, gratuito.aulas[1])).status, 403);
    for (const [indice, aulaId] of gratuito.aulas.entries()) {
      const aula = await abrirAula(bia, aulaId);
      assert.equal(aula.status, 200);
      assert.equal(aula.dados.aula.tipo, 'spotify');
      assert.equal(aula.dados.aula.linkExterno, 'https://open.spotify.com/track/teste');
      const progresso = await chamar('POST', `/api/aulas/${aulaId}/progresso`, {
        usuario: bia, corpo: { finalizada: true },
      });
      assert.equal(progresso.status, 200);
      assert.equal(progresso.dados.concluida, true);
      const curso = await detalhes(bia, gratuito);
      assert.equal(curso.acesso.estado, 'liberado');
      assert.equal(curso.progresso.concluidas, indice + 1);
      assert.equal(curso.progresso.percentual, Math.round((indice + 1) / 3 * 100));
    }
    assert.equal((await detalhes(bia, gratuito)).progresso.concluido, true);
    assert.equal((await chamar('GET', `/api/cursos/${gratuito.id}/oferta`, { usuario: bia })).status, 409);
    assert.equal(await matriculaDe(bia, gratuito), undefined);
    assert.deepEqual(await pedidosDe(bia), pedidosAntes);
  });

  await t.test('aula, mídia e progresso ficam protegidos, inclusive por URL direta e após revogação', async () => {
    const protegido = await criarCurso('Mídia protegida', {
      tipo_acesso: 'pago', gratuito: 0, preco_centavos: 9900, pix_habilitado: 1,
    });
    const arquivo = `${randomBytes(16).toString('hex')}.wav`;
    const caminho = path.join(pasta('midias'), arquivo);
    // WAV PCM de um segundo; arquivo exclusivo deste teste, removido no encerramento.
    const midia = Buffer.alloc(44 + 8000);
    midia.write('RIFF', 0); midia.writeUInt32LE(midia.length - 8, 4); midia.write('WAVEfmt ', 8);
    midia.writeUInt32LE(16, 16); midia.writeUInt16LE(1, 20); midia.writeUInt16LE(1, 22);
    midia.writeUInt32LE(8000, 24); midia.writeUInt32LE(8000, 28);
    midia.writeUInt16LE(1, 32); midia.writeUInt16LE(8, 34);
    midia.write('data', 36); midia.writeUInt32LE(8000, 40); midia.fill(128, 44);
    fs.mkdirSync(pasta('midias'), { recursive: true });
    arquivosDeTeste.push(caminho);
    fs.writeFileSync(caminho, midia, { flag: 'wx' });
    const aulaId = protegido.aulas[0];
    await consulta("UPDATE aulas SET tipo = 'audio', arquivo = ?, link_externo = NULL, duracao_segundos = 1 WHERE id = ?", [arquivo, aulaId]);

    const conferirBloqueio = async (usuario, status) => {
      for (const [metodo, rota, corpo] of [
        ['GET', `/api/aulas/${aulaId}`],
        ['GET', `/api/aulas/${aulaId}/midia`],
        ['POST', `/api/aulas/${aulaId}/progresso`, { finalizada: true, posicaoSegundos: 1 }],
      ]) {
        const resposta = await chamar(metodo, rota, { usuario, corpo });
        assert.equal(resposta.status, status, rota);
        if (status === 403) assert.equal(resposta.dados.codigo, 'SEM_ACESSO');
        for (const campo of ['aula', 'arquivo', 'midia', 'linkExterno', 'proxima']) {
          assert.equal(resposta.dados[campo], undefined, `${rota}: ${campo}`);
        }
      }
    };
    await conferirBloqueio(undefined, 401);
    await conferirBloqueio(bia, 403);
    const publico = await chamar('GET', `/api/cursos/${protegido.id}`);
    assert.equal(JSON.stringify(publico.dados).includes(arquivo), false);
    for (const rota of [`/arquivos/midias/${arquivo}`, `/storage/midias/${arquivo}`]) {
      assert.equal((await fetch(`${base}${rota}`)).status, 404);
    }
    assert.equal((await consulta('SELECT COUNT(*) AS n FROM progresso_aulas WHERE usuario_id = ? AND aula_id = ?', [bia, aulaId]))[0].n, 0);

    // Uma concessão administrativa real no banco de teste permite leitura e Range.
    assert.equal((await chamar('POST', '/api/admin/acessos', { usuario: admin, corpo: { usuarioId: bia, cursoId: protegido.id } })).status, 201);
    assert.equal((await abrirAula(bia, aulaId)).status, 200);
    const headers = { Authorization: `Bearer ${gerarToken(bia)}` };
    const inteira = await fetch(`${base}/api/aulas/${aulaId}/midia`, { headers });
    assert.equal(inteira.status, 200);
    assert.match(inteira.headers.get('content-type'), /^audio\/wav/);
    assert.equal(inteira.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(Buffer.from(await inteira.arrayBuffer()), midia);
    const trecho = await fetch(`${base}/api/aulas/${aulaId}/midia`, { headers: { ...headers, Range: 'bytes=0-43' } });
    assert.equal(trecho.status, 206);
    assert.deepEqual(Buffer.from(await trecho.arrayBuffer()), midia.subarray(0, 44));
    assert.equal((await chamar('POST', `/api/aulas/${aulaId}/progresso`, { usuario: bia, corpo: { finalizada: true, posicaoSegundos: 1 } })).status, 200);
    const salvo = await consulta('SELECT posicao_segundos, concluida FROM progresso_aulas WHERE usuario_id = ? AND aula_id = ?', [bia, aulaId]);
    assert.equal((await chamar('POST', '/api/admin/acessos/revogar', { usuario: admin, corpo: { usuarioId: bia, cursoId: protegido.id } })).status, 200);
    await conferirBloqueio(bia, 403);
    assert.deepEqual(await consulta('SELECT posicao_segundos, concluida FROM progresso_aulas WHERE usuario_id = ? AND aula_id = ?', [bia, aulaId]), salvo);
  });
});
