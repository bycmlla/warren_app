// Cria apenas arquivos derivados. O conteúdo original e o progresso não são alterados.
const fs = require('node:fs');
const path = require('node:path');
const database = require('../src/config/database');
const { pasta } = require('../src/config/storage');
const { prepararVideo, reproducaoDoArquivo } = require('../src/utils/prepararVideo');

async function main() {
  const [rows] = await database.query("SELECT arquivo FROM aula_videos UNION SELECT arquivo FROM aulas WHERE tipo = 'video' AND arquivo IS NOT NULL");
  const result = [];
  for (const { arquivo } of rows) {
    const metadata = await prepararVideo(arquivo);
    const original = path.join(pasta('midias'), arquivo);
    const derived = reproducaoDoArquivo(arquivo);
    const originalBytes = fs.existsSync(original) ? fs.statSync(original).size : null;
    const streamBytes = fs.existsSync(derived) ? fs.statSync(derived).size : null;
    const info = { arquivo, duracaoSegundos: metadata?.duration ?? null, bitrateOriginal: metadata?.bitrate ?? null,
      originalBytes, streamBytes, reducaoPercentual: streamBytes && originalBytes ? Math.round((1 - streamBytes / originalBytes) * 100) : null };
    result.push(info);
    console.log(JSON.stringify(info));
  }
  const output = path.resolve(__dirname, '../../validacao-experiencia-aulas');
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'otimizacao.json'), JSON.stringify(result, null, 2));
}
main().catch((error) => { console.error(error.code || error.message); process.exitCode = 1; }).finally(() => database.end());
