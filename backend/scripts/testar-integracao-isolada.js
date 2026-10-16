// Clona somente o esquema e verifica que nenhum dado do banco configurado foi alterado.
const assert = require('node:assert/strict');
const { createHash, randomBytes } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
require('dotenv').config({ path: path.join(__dirname, '../.env'), quiet: true });
const mysql = require('mysql2/promise');

async function main() {
  const source = process.env.DB_NAME || 'joanalia';
  const target = `joanalia_it_${process.pid}_${randomBytes(6).toString('hex')}`;
  const temporaryStorage = fs.mkdtempSync(path.join(os.tmpdir(), 'joanalia-integracao-'));
  let connection, created = false;
  try {
    connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '',
    });
    const [tables] = await connection.query('SHOW FULL TABLES FROM ?? WHERE Table_type = ?', [source, 'BASE TABLE']);
    const names = tables.map((row) => Object.values(row)[0]);
    const snapshot = async () => {
      const result = {};
      for (const table of names) {
        const [rows] = await connection.query('SELECT * FROM ??.??', [source, table]);
        result[table] = { count: rows.length, hash: createHash('sha256')
          .update(JSON.stringify(rows.map((row) => JSON.stringify(row)).sort())).digest('hex') };
      }
      return result;
    };
    const before = await snapshot();
    assert.notEqual(source, target);
    assert.match(target, /^joanalia_it_\d+_[a-f0-9]{12}$/);
    await connection.query('CREATE DATABASE ?? CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci', [target]);
    created = true;
    await connection.query('USE ??', [target]);
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const table of names) {
      const [definitions] = await connection.query('SHOW CREATE TABLE ??.??', [source, table]);
      const ddl = definitions[0]['Create Table'];
      assert.ok(!ddl.includes(`REFERENCES \`${source}\`.`), 'Uma referência não pode apontar para o banco original.');
      await connection.query(ddl);
    }
    await connection.query('SET FOREIGN_KEY_CHECKS = 1');
    console.log(`Banco temporário criado com ${names.length} tabelas, sem copiar dados.`);
    const execution = spawnSync(process.execPath, ['--test', '--test-concurrency=1',
      'integracao/comercial.js', 'integracao/restritos.js', 'integracao/aulas.js'], {
      cwd: path.resolve(__dirname, '..'), env: { ...process.env, DB_NAME: target, STORAGE_DIR: temporaryStorage }, stdio: 'inherit',
    });
    const after = await snapshot();
    assert.deepEqual(after, before, 'Os dados do banco configurado mudaram durante a validação.');
    console.log(`Preservação confirmada: conteúdo e contagem das ${names.length} tabelas originais permanecem iguais.`);
    if (execution.error) throw execution.error;
    process.exitCode = execution.status ?? 1;
  } finally {
    try { if (created) await connection.query('DROP DATABASE ??', [target]); }
    finally {
      if (connection) await connection.end();
      // Verifica o caminho absoluto antes de remover apenas o armazenamento criado acima.
      const resolved = fs.realpathSync(temporaryStorage);
      assert.equal(path.dirname(resolved), fs.realpathSync(os.tmpdir()));
      assert.ok(path.basename(resolved).startsWith('joanalia-integracao-'));
      fs.rmSync(resolved, { recursive: true, force: true });
    }
  }
}
main().catch((error) => { console.error(error.code || error.message); process.exitCode = 1; });
