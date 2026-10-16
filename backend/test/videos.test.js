process.env.JWT_SECRET = 'segredo-usado-apenas-nos-testes-automatizados';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const database = require('../src/config/database');
const { gerarToken, validarToken, gerarTokenDeMidia, validarTokenDeMidia } = require('../src/config/auth');
const { chegouAoFim } = require('../src/controllers/aulaController');
const { duracaoTotal } = require('../src/utils/videos');
const { bloqueioDaAula } = require('../src/utils/estadoDaAula');

test.after(() => database.end());

test('conclusão exige o final com no máximo dois segundos de tolerância', () => {
  assert.equal(chegouAoFim(90, 100), false);
  assert.equal(chegouAoFim(599, 600), true);
  assert.equal(chegouAoFim(590, 600), false);
  assert.equal(chegouAoFim(58, 60), false);
  assert.equal(chegouAoFim(59, 60), true);
  assert.equal(chegouAoFim(100, null), false);
  assert.equal(chegouAoFim(0, 1), false);
});

test('duração da aula é desconhecida enquanto qualquer vídeo tiver duração desconhecida', () => {
  assert.equal(duracaoTotal([{ duracao_segundos: 60 }, { duracao_segundos: 120 }]), 180);
  assert.equal(duracaoTotal([{ duracao_segundos: 60 }, { duracao_segundos: null }]), null);
  assert.equal(duracaoTotal([]), null);
});

test('credencial web abre apenas sua mídia, não é uma sessão nem abre outra aula', () => {
  const path = '/api/aulas/7/videos/10/midia';
  const ticket = gerarTokenDeMidia(5, path);
  assert.equal(validarTokenDeMidia(ticket, path), 5);
  assert.throws(() => validarToken(ticket));
  assert.throws(() => validarTokenDeMidia(ticket, '/api/aulas/8/videos/10/midia'));
  assert.throws(() => validarTokenDeMidia(gerarToken(5), path));
  assert.equal(validarToken(gerarToken(5)), 5);
});

test('motivos de bloqueio respeitam compra, progressão, login e demonstração', () => {
  const aula = { demonstrativa: 0 };
  const pago = { tipo_acesso: 'pago' };
  assert.equal(bloqueioDaAula(aula, null, pago, false, true), 'acesso');
  assert.equal(bloqueioDaAula(aula, 'bloqueada', pago, true, true), 'sequencia');
  assert.equal(bloqueioDaAula(aula, 'disponivel', pago, true, true), null);
  assert.equal(bloqueioDaAula(aula, 'concluida', pago, false, true), 'acesso');
  assert.equal(bloqueioDaAula({ demonstrativa: 1 }, null, pago, false, true), null);
  assert.equal(bloqueioDaAula({ demonstrativa: 1 }, null, { tipo_acesso: 'restrito' }, false, true), 'acesso');
  assert.equal(bloqueioDaAula(aula, null, { tipo_acesso: 'gratuito' }, false, false), 'login');
});
