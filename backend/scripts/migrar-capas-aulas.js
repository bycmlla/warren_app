// Adiciona somente a capa opcional e verifica a preservação das colunas e registros anteriores.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const database = require('../src/config/database');
const { garantirCapaDasAulas } = require('../src/utils/schemaAulas');

async function main() {
  const [tables] = await database.query('SHOW FULL TABLES WHERE Table_type = ?', ['BASE TABLE']);
  const definitions = [];
  for (const row of tables) {
    const table = Object.values(row)[0];
    const [columns] = await database.query('SHOW COLUMNS FROM ??', [table]);
    definitions.push({ table, columns: columns.map((column) => column.Field) });
  }
  const snapshot = async () => {
    const result = {};
    for (const { table, columns } of definitions) {
      const [rows] = await database.query('SELECT ?? FROM ??', [columns, table]);
      result[table] = { count: rows.length, hash: createHash('sha256')
        .update(JSON.stringify(rows.map((row) => JSON.stringify(row)).sort())).digest('hex') };
    }
    return result;
  };
  const before = await snapshot();
  const changed = await garantirCapaDasAulas();
  assert.deepEqual(await snapshot(), before, 'Os registros anteriores precisam ser preservados.');
  console.log(`${changed ? 'Adicionada' : 'Já existente'}: aulas.imagem_capa. Registros e colunas anteriores das ${definitions.length} tabelas preservados.`);
}
main().catch((error) => { console.error(error.code || error.message); process.exitCode = 1; }).finally(() => database.end());
