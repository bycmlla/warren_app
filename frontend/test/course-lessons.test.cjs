const assert = require('node:assert/strict');
const { test } = require('node:test');
const { formatDuration } = require('../src/utils/format.ts');
const { courseLessonState, courseLessonDescriptions } = require('../src/utils/course-lesson-state.ts');

test('duração em minutos, horas e estado neutro sem números fictícios', () => {
  assert.equal(formatDuration(180), '3 min');
  assert.equal(formatDuration(1560), '26 min');
  assert.equal(formatDuration(4200), '1h 10min');
  assert.equal(formatDuration(3), 'menos de 1 min');
  for (const unknown of [null, undefined, 0, NaN, Infinity, -1]) assert.equal(formatDuration(unknown), '');
});

test('acesso e sequência têm estados e mensagens distintos; conclusão não concede acesso', () => {
  const lesson = { demonstrativa: false, estado: 'bloqueada', bloqueio: 'acesso' };
  assert.equal(courseLessonState(lesson), 'acesso');
  assert.equal(courseLessonState({ ...lesson, bloqueio: 'sequencia' }), 'sequencia');
  assert.notEqual(courseLessonDescriptions.acesso, courseLessonDescriptions.sequencia);
  assert.equal(courseLessonState({ ...lesson, estado: 'concluida' }), 'acesso');
  assert.equal(courseLessonState({ ...lesson, estado: 'concluida', bloqueio: null }), 'concluida');
  assert.equal(courseLessonState({ ...lesson, estado: 'disponivel', bloqueio: null }), 'disponivel');
  assert.equal(courseLessonState({ ...lesson, estado: null, demonstrativa: true, bloqueio: null }), 'demonstracao');
  assert.equal(courseLessonState({ ...lesson, estado: null, bloqueio: 'login' }), 'login');
});
