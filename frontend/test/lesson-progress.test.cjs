const assert = require('node:assert/strict');
const { test } = require('node:test');
const { ProgressQueue } = require('../src/utils/progress-queue.ts');
const { lessonDuration, lessonPercent, resumePoint } = require('../src/utils/lesson-progress.ts');

const entry = (videoId, seconds, updatedAt, finished = false) => ({ lessonId: 7, videoId, seconds, updatedAt, finished });
const storage = () => {
  let disk = [];
  return { read: async () => structuredClone(disk), write: async (values) => { disk = structuredClone(values); } };
};

test('queda de conexão mantém checkpoints no armazenamento e uma nova fila os recupera', async () => {
  const disk = storage();
  const queue = new ProgressQueue(disk);
  await queue.put(entry(10, 31, 1));
  await assert.rejects(queue.flush(async () => { throw new Error('offline'); }));
  const reopened = new ProgressQueue(disk);
  const sent = [];
  await reopened.flush(async (value) => { sent.push(value); return true; });
  assert.deepEqual(sent.map((value) => [value.videoId, value.seconds]), [[10, 31]]);
  assert.deepEqual(await disk.read(), []);
});

test('checkpoints são compactados, preservam conclusão pendente e retomada após reinício', async () => {
  const queue = new ProgressQueue(storage());
  await queue.put(entry(10, 10, 1));
  await queue.put(entry(10, 60, 2, true));
  await queue.put(entry(10, 0, 3));
  const pending = await queue.entries();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].seconds, 0);
  assert.equal(pending[0].finished, true);
  assert.equal(pending[0].completionSeconds, 60);
});

test('envios são serializados e um checkpoint novo durante o envio não é perdido', async () => {
  const queue = new ProgressQueue(storage());
  await queue.put(entry(10, 10, 1));
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  const sent = [];
  let started;
  const starting = new Promise((resolve) => { started = resolve; });
  const flush = queue.flush(async (value) => {
    sent.push(value.seconds);
    if (sent.length === 1) { started(); await blocked; }
    return true;
  });
  await starting;
  await queue.put(entry(10, 20, 2));
  const sameFlush = queue.flush(async () => { throw new Error('envio concorrente'); });
  release();
  await Promise.all([flush, sameFlush]);
  assert.deepEqual(sent, [10, 20]);
  assert.deepEqual(await queue.entries(), []);
});

test('retoma o último vídeo pela ordem dos checkpoints, independentemente da lista', async () => {
  const queue = new ProgressQueue(storage());
  await queue.put(entry(20, 30, 1));
  await queue.put(entry(10, 50, 2));
  await queue.put(entry(20, 45, 3));
  const sent = [];
  await queue.flush(async (value) => { sent.push(value.videoId); return true; });
  assert.deepEqual(sent, [10, 20]);
});

test('armazenamentos de alunos diferentes não compartilham checkpoints', async () => {
  const first = new ProgressQueue(storage());
  const second = new ProgressQueue(storage());
  await first.put(entry(10, 40, 1));
  assert.deepEqual(await second.entries(), []);
});

test('vídeos removidos não bloqueiam os próximos salvamentos e substituição não herda conclusão pendente', async () => {
  const queue = new ProgressQueue(storage());
  await queue.put({ ...entry(10, 60, 1, true), mediaVersion: 'antigo' });
  await queue.put({ ...entry(10, 0, 2), mediaVersion: 'novo' });
  assert.equal((await queue.entries())[0].finished, false);
  await queue.put(entry(20, 40, 3));
  const results = await queue.flush(async (value) => {
    if (value.videoId === 10) throw new Error('removido');
    return value.seconds;
  }, (error) => error.message === 'removido');
  assert.equal(results.get('7.20'), 40);
  assert.deepEqual(await queue.entries(), []);
});

test('falha de um conteúdo mantém sua pendência e permite salvar os outros vídeos', async () => {
  const queue = new ProgressQueue(storage());
  await queue.put(entry(10, 30, 1));
  await queue.put(entry(20, 40, 2));
  const results = await queue.flush(async (value) => {
    if (value.videoId === 10) throw new Error('acesso interrompido');
    return value.seconds;
  });
  assert.equal(results.get('7.20'), 40);
  assert.equal(queue.errorFor('7.10').message, 'acesso interrompido');
  assert.deepEqual((await queue.entries()).map((value) => value.videoId), [10]);
});

test('duração e progresso consideram todos os vídeos, sem duração ou conclusão fictícias', () => {
  const videos = [
    { duracaoSegundos: 60, posicaoSegundos: 0, concluido: true },
    { duracaoSegundos: 120, posicaoSegundos: 60, concluido: false },
  ];
  assert.equal(lessonDuration(videos), 180);
  assert.equal(lessonPercent(videos), 66);
  assert.equal(lessonPercent(videos.map((video) => ({ ...video, posicaoSegundos: 1000 }))), 99);
  assert.equal(lessonPercent(videos.map((video) => ({ ...video, concluido: true }))), 100);
  assert.equal(lessonDuration([{ ...videos[0], duracaoSegundos: null }]), null);
  assert.equal(lessonDuration([]), null);
});

test('retomada perto do final mantém o ponto salvo e posições inválidas são limitadas', () => {
  assert.equal(resumePoint(58, 60), 58);
  assert.equal(resumePoint(100, 60), 59.9);
  assert.equal(resumePoint(-3, 60), 0);
  assert.equal(resumePoint(30, 0), 0);
});
