// Teste de integração das aulas com vários vídeos, contra o banco configurado no .env.
//
// Uso: npm run test:integracao      (NÃO execute contra o banco de produção)
//
// Cria usuários, um curso e arquivos de vídeo mínimos (com a duração gravada no cabeçalho, como
// em um MP4 real) e apaga tudo ao terminar. Cobre: duração automática, vários vídeos por aula,
// progresso por aluno e por vídeo, retomada, conclusão da aula e conversão das aulas antigas.
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
const { migrarVideosLegados } = require('../src/utils/videos');
const { prepararVideo, reproducaoDoArquivo } = require('../src/utils/prepararVideo');
const { executarFFmpeg } = require('../src/config/ferramentasMidia');

const MARCA = `iv-${Date.now()}`;

// MP4 mínimo: cabeçalho, a caixa `moov` com a duração (em `mvhd`) e alguns bytes de "vídeo".
function mp4(segundos) {
  const caixa = (tipo, conteudo) => {
    const cabecalho = Buffer.alloc(8);
    cabecalho.writeUInt32BE(8 + conteudo.length, 0);
    cabecalho.write(tipo, 4, 'latin1');
    return Buffer.concat([cabecalho, conteudo]);
  };
  const mvhd = Buffer.alloc(100);
  mvhd.writeUInt32BE(1000, 12);
  mvhd.writeUInt32BE(segundos * 1000, 16);
  return Buffer.concat([
    caixa('ftyp', Buffer.concat([Buffer.from('mp42'), Buffer.alloc(8)])),
    caixa('moov', caixa('mvhd', mvhd)),
    caixa('mdat', Buffer.alloc(256, 1)),
  ]);
}

test('aulas com vários vídeos, duração automática e progresso do aluno', async (t) => {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const ids = { usuarios: [], curso: null, categoria: null };
  const arquivos = new Set();

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
    const texto = await response.text();
    let dados = null;
    try {
      dados = JSON.parse(texto);
    } catch {
      dados = null;
    }
    return { status: response.status, dados, response };
  };
  const enviar = async (usuario, conteudo, tipo = 'video/mp4') => {
    const response = await fetch(`${base}/api/admin/uploads/video`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${gerarToken(usuario)}`, 'Content-Type': tipo },
      body: conteudo,
    });
    const dados = await response.json();
    if (dados.arquivo) arquivos.add(dados.arquivo);
    return { status: response.status, dados };
  };
  const noDisco = (arquivo) => fs.existsSync(path.join(pasta('midias'), arquivo));

  t.after(async () => {
    if (ids.usuarios.length > 0) {
      await consulta('DELETE FROM aceites_termos WHERE usuario_id IN (?)', [ids.usuarios]);
      await consulta('DELETE FROM progresso_aulas WHERE usuario_id IN (?)', [ids.usuarios]);
      await consulta('DELETE FROM progresso_videos WHERE usuario_id IN (?)', [ids.usuarios]);
    }
    if (ids.curso !== null) await consulta('DELETE FROM cursos WHERE id = ? AND titulo LIKE ?', [ids.curso, `%${MARCA}%`]);
    if (ids.categoria !== null) await consulta('DELETE FROM categorias WHERE id = ? AND nome LIKE ?', [ids.categoria, `%${MARCA}%`]);
    if (ids.usuarios.length > 0) await consulta('DELETE FROM usuarios WHERE id IN (?) AND email LIKE ?', [ids.usuarios, `%${MARCA}%`]);
    for (const arquivo of arquivos) fs.rmSync(path.join(pasta('midias'), arquivo), { force: true });
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
  const admin = await criarUsuario('Admin', 'admin');
  const ana = await criarUsuario('Ana', 'aluno');
  const bia = await criarUsuario('Bia', 'aluno');
  // Se há Termos de Uso em vigor, as alunas de teste já os aceitaram (o aceite é exigido para aulas).
  const [termo] = await consulta(
    "SELECT id, versao, hash FROM documentos_legais WHERE tipo = 'termos' AND vigente_desde <= CURDATE() ORDER BY vigente_desde DESC, id DESC LIMIT 1",
  );
  if (termo) {
    for (const usuario of [ana, bia]) {
      await consulta('INSERT INTO aceites_termos (usuario_id, documento_id, versao, hash) VALUES (?, ?, ?, ?)', [
        usuario,
        termo.id,
        termo.versao,
        termo.hash,
      ]);
    }
  }

  ids.categoria = (await consulta('INSERT INTO categorias (nome) VALUES (?)', [`Categoria ${MARCA}`])).insertId;
  const criado = await chamar('POST', '/api/admin/cursos', {
    usuario: admin,
    corpo: { titulo: `Vídeos ${MARCA}`, descricao: 'Curso de teste.', categoriaId: ids.categoria, tipoAcesso: 'gratuito' },
  });
  assert.equal(criado.status, 201);
  ids.curso = criado.dados.curso.id;
  const aulasDoCurso = async () =>
    (await chamar('GET', `/api/admin/cursos/${ids.curso}`, { usuario: admin })).dados.modulos.flatMap((modulo) => modulo.aulas);
  const criarAula = (corpo) => chamar('POST', `/api/admin/cursos/${ids.curso}/aulas`, { usuario: admin, corpo });

  let aula;
  let v1;
  let v2;
  let v3;

  await t.test('o envio identifica a duração do vídeo; formatos sem essa informação ficam sem valor', async () => {
    const um = await enviar(admin, mp4(60));
    assert.equal(um.status, 201);
    assert.equal(um.dados.duracaoSegundos, 60);
    const webm = await enviar(admin, Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64)]), 'video/webm');
    assert.equal(webm.status, 201);
    assert.equal(webm.dados.duracaoSegundos, null);
    v1 = um.dados.arquivo;
    v2 = (await enviar(admin, mp4(120))).dados.arquivo;
    v3 = (await enviar(admin, mp4(30))).dados.arquivo;
  });

  await t.test('uma aula aceita vários vídeos e a duração dela é a soma, sem digitação', async () => {
    assert.equal((await criarAula({ titulo: 'Sem vídeo', tipo: 'video', videos: [] })).status, 400);
    assert.equal((await criarAula({ titulo: 'Arquivo inexistente', tipo: 'video', videos: [{ arquivo: `${'0'.repeat(32)}.mp4` }] })).status, 400);

    // Uma duração enviada pelo aplicativo é ignorada quando o arquivo informa a sua.
    const resposta = await criarAula({
      titulo: 'Aula com três vídeos',
      tipo: 'video',
      duracaoSegundos: 9999,
      videos: [
        { titulo: 'Abertura', arquivo: v1, duracaoSegundos: 5 },
        { titulo: 'Prática', arquivo: v2 },
        { arquivo: v3 },
      ],
    });
    assert.equal(resposta.status, 201);
    [aula] = (await aulasDoCurso()).filter((item) => item.id === resposta.dados.aula.id);
    assert.equal(aula.duracaoSegundos, 210);
    assert.equal(aula.arquivo, null);
    assert.deepEqual(
      aula.videos.map((video) => [video.titulo, video.arquivo, video.duracaoSegundos]),
      [['Abertura', v1, 60], ['Prática', v2, 120], [null, v3, 30]],
    );

    // Segunda aula, para conferir a liberação em sequência.
    assert.equal((await criarAula({ titulo: 'Aula seguinte', tipo: 'spotify', linkExterno: 'https://open.spotify.com/track/teste' })).status, 201);
    assert.equal((await chamar('PUT', `/api/admin/cursos/${ids.curso}/status`, { usuario: admin, corpo: { status: 'publicado' } })).status, 200);
  });

  const abrir = async (usuario) => (await chamar('GET', `/api/aulas/${aula.id}`, { usuario })).dados;
  const progresso = (usuario, video, corpo) =>
    chamar('POST', `/api/aulas/${aula.id}/videos/${video}/progresso`, { usuario, corpo });
  const idsDosVideos = () => aula.videos.map((video) => video.id);

  await t.test('player web recebe mídia com Range sem expor o token da sessão e respeita conta bloqueada', async () => {
    const dados = await abrir(ana);
    const midia = dados.videos[0].midiaWeb;
    const web = await chamar('GET', midia, { cabecalhos: { Range: 'bytes=0-15' } });
    assert.equal(web.status, 206);
    const ticket = new URL(midia, base).searchParams.get('acesso');
    assert.equal((await chamar('GET', '/api/usuarios/me', { cabecalhos: { Authorization: `Bearer ${ticket}` } })).status, 401);
    assert.equal((await chamar('GET', `/api/aulas/${aula.id}/videos/${aula.videos[1].id}/midia?acesso=${ticket}`)).status, 401);
    await consulta("UPDATE usuarios SET status = 'bloqueado' WHERE id = ?", [ana]);
    assert.equal((await chamar('GET', midia)).status, 403);
    await consulta("UPDATE usuarios SET status = 'ativo' WHERE id = ?", [ana]);
  });

  await t.test('a aula abre com os vídeos em ordem, sem progresso, no primeiro', async () => {
    const dados = await abrir(ana);
    assert.equal(dados.aula.duracaoSegundos, 210);
    assert.deepEqual(dados.videos.map((video) => video.id), idsDosVideos());
    assert.deepEqual(dados.videos.map((video) => [video.posicaoSegundos, video.concluido]), [[0, false], [0, false], [0, false]]);
    assert.equal(dados.videoAtualId, aula.videos[0].id);
    assert.equal(dados.aula.concluida, false);
  });

  await t.test('o vídeo só é entregue a quem pode abrir a aula, com suporte a trechos', async () => {
    const [primeiro] = idsDosVideos();
    const caminho = `/api/aulas/${aula.id}/videos/${primeiro}/midia`;
    assert.equal((await fetch(`${base}${caminho}`)).status, 401);
    const trecho = await fetch(`${base}${caminho}`, { headers: { Authorization: `Bearer ${gerarToken(ana)}`, Range: 'bytes=0-9' } });
    assert.equal(trecho.status, 206);
    assert.equal((await trecho.arrayBuffer()).byteLength, 10);
    assert.equal(trecho.headers.get('content-type'), 'video/mp4');
    assert.equal((await chamar('GET', `/api/aulas/${aula.id}/videos/999999999/midia`, { usuario: ana })).status, 404);
  });

  await t.test('o ponto de reprodução é salvo por aluno e por vídeo, e a aula reabre onde parou', async () => {
    const [, segundo] = idsDosVideos();
    assert.equal((await progresso(ana, segundo, { posicaoSegundos: 50.7 })).status, 200);
    assert.equal((await progresso(ana, segundo, { posicaoSegundos: -1 })).status, 400);
    assert.equal((await progresso(ana, 999999999, { posicaoSegundos: 1 })).status, 404);

    const dados = await abrir(ana);
    assert.equal(dados.videoAtualId, segundo);
    assert.deepEqual(dados.videos.map((video) => video.posicaoSegundos), [0, 51, 0]);
    // O progresso da Ana não aparece para a Bia.
    const outra = await abrir(bia);
    assert.deepEqual(outra.videos.map((video) => video.posicaoSegundos), [0, 0, 0]);
    assert.equal(outra.videoAtualId, aula.videos[0].id);
  });

  await t.test('terminar um vídeo não conclui a aula nem libera a aula seguinte', async () => {
    const [primeiro, segundo] = idsDosVideos();
    const cedo = await progresso(ana, primeiro, { posicaoSegundos: 10, finalizado: true });
    assert.equal(cedo.status, 422);
    assert.equal(cedo.dados.codigo, 'INCOMPLETA');

    const fim = await progresso(ana, primeiro, { posicaoSegundos: 59, finalizado: true });
    assert.equal(fim.status, 200);
    assert.deepEqual(
      [fim.dados.concluido, fim.dados.videosConcluidos, fim.dados.totalVideos, fim.dados.aulaConcluida],
      [true, 1, 3, false],
    );
    const dados = await abrir(ana);
    assert.equal(dados.aula.concluida, false);
    assert.equal(dados.proxima.estado, 'bloqueada');
    // O último vídeo assistido já foi concluído: a aula reabre no próximo pendente.
    assert.equal(dados.videoAtualId, segundo);
    // A rota antiga de conclusão da aula também recusa enquanto faltarem vídeos.
    const antiga = await chamar('POST', `/api/aulas/${aula.id}/progresso`, { usuario: ana, corpo: { posicaoSegundos: 210, finalizada: true } });
    assert.equal(antiga.status, 422);
    assert.equal((await chamar('GET', `/api/aulas/${dados.proxima.id}`, { usuario: ana })).status, 403);
  });

  await t.test('rever um vídeo concluído mantém a conclusão', async () => {
    const [primeiro] = idsDosVideos();
    const revisto = await progresso(ana, primeiro, { posicaoSegundos: 5 });
    assert.equal(revisto.dados.concluido, true);
    const dados = await abrir(ana);
    assert.deepEqual([dados.videos[0].posicaoSegundos, dados.videos[0].concluido], [5, true]);
  });

  await t.test('a aula é concluída quando todos os vídeos terminam, e só para aquele aluno', async () => {
    const [, segundo, terceiro] = idsDosVideos();
    const meio = await progresso(ana, segundo, { posicaoSegundos: 120, finalizado: true });
    assert.equal(meio.dados.aulaConcluida, false);
    const fim = await progresso(ana, terceiro, { posicaoSegundos: 30, finalizado: true });
    assert.deepEqual([fim.dados.videosConcluidos, fim.dados.aulaConcluida, fim.dados.cursoConcluido], [3, true, false]);
    assert.equal(fim.dados.proxima.estado, 'disponivel');

    const dados = await abrir(ana);
    assert.equal(dados.aula.concluida, true);
    assert.equal((await chamar('GET', `/api/aulas/${dados.proxima.id}`, { usuario: ana })).status, 200);
    const curso = (await chamar('GET', `/api/cursos/${ids.curso}`, { usuario: ana })).dados;
    assert.equal(curso.progresso.concluidas, 1);

    const outra = await abrir(bia);
    assert.equal(outra.aula.concluida, false);
    assert.equal(outra.proxima.estado, 'bloqueada');
    assert.equal((await chamar('GET', `/api/cursos/${ids.curso}`, { usuario: bia })).dados.progresso.concluidas, 0);
  });

  await t.test('reordenar e renomear vídeos não muda quem eles são nem o progresso salvo', async () => {
    const [primeiro, segundo, terceiro] = aula.videos;
    await progresso(bia, segundo.id, { posicaoSegundos: 33 });
    const corpo = {
      titulo: aula.titulo,
      tipo: 'video',
      videos: [
        { id: terceiro.id, titulo: 'Encerramento', arquivo: terceiro.arquivo },
        { id: primeiro.id, titulo: primeiro.titulo, arquivo: primeiro.arquivo },
        { id: segundo.id, titulo: segundo.titulo, arquivo: segundo.arquivo },
      ],
    };
    assert.equal((await chamar('PUT', `/api/admin/aulas/${aula.id}`, { usuario: admin, corpo })).status, 200);
    [aula] = (await aulasDoCurso()).filter((item) => item.id === aula.id);
    assert.deepEqual(aula.videos.map((video) => video.id), [terceiro.id, primeiro.id, segundo.id]);
    assert.equal(aula.videos[0].titulo, 'Encerramento');
    assert.equal(aula.duracaoSegundos, 210);

    const dados = await abrir(bia);
    assert.deepEqual(dados.videos.map((video) => [video.id, video.posicaoSegundos]), [[terceiro.id, 0], [primeiro.id, 0], [segundo.id, 33]]);
    assert.equal(dados.videoAtualId, segundo.id);
    assert.equal((await abrir(ana)).aula.concluida, true);
  });

  await t.test('trocar o arquivo atualiza a duração, zera o ponto salvo e mantém a conclusão', async () => {
    const alvo = aula.videos[2];
    const novo = (await enviar(admin, mp4(90))).dados.arquivo;
    const corpo = {
      titulo: aula.titulo,
      tipo: 'video',
      videos: aula.videos.map((video) => ({ id: video.id, titulo: video.titulo, arquivo: video.id === alvo.id ? novo : video.arquivo })),
    };
    assert.equal((await chamar('PUT', `/api/admin/aulas/${aula.id}`, { usuario: admin, corpo })).status, 200);
    [aula] = (await aulasDoCurso()).filter((item) => item.id === aula.id);
    assert.equal(aula.videos[2].duracaoSegundos, 90);
    assert.equal(aula.duracaoSegundos, 180);
    // O arquivo substituído sai do armazenamento; o novo fica.
    assert.equal(noDisco(alvo.arquivo), false);
    assert.equal(noDisco(novo), true);

    const daBia = (await abrir(bia)).videos.find((video) => video.id === alvo.id);
    assert.equal(daBia.posicaoSegundos, 0);
    const atrasado = await progresso(bia, alvo.id, { posicaoSegundos: 33, versaoMidia: alvo.arquivo });
    assert.equal(atrasado.status, 409);
    assert.equal(atrasado.dados.codigo, 'VIDEO_SUBSTITUIDO');
    assert.equal((await abrir(bia)).videos.find((video) => video.id === alvo.id).posicaoSegundos, 0);
    const daAna = (await abrir(ana)).videos.find((video) => video.id === alvo.id);
    assert.equal(daAna.concluido, true);
  });

  await t.test('adicionar um vídeo exige concluí-lo e remover preserva o progresso dos vídeos mantidos', async () => {
    const extra = (await enviar(admin, mp4(45))).dados.arquivo;
    const comExtra = {
      titulo: aula.titulo,
      tipo: 'video',
      videos: [...aula.videos.map((video) => ({ id: video.id, titulo: video.titulo, arquivo: video.arquivo })), { titulo: 'Bônus', arquivo: extra }],
    };
    assert.equal((await chamar('PUT', `/api/admin/aulas/${aula.id}`, { usuario: admin, corpo: comExtra })).status, 200);
    [aula] = (await aulasDoCurso()).filter((item) => item.id === aula.id);
    assert.equal(aula.videos.length, 4);
    assert.equal(aula.duracaoSegundos, 225);

    const daAna = await abrir(ana);
    assert.equal(daAna.aula.concluida, false);
    assert.deepEqual(daAna.videos.map((video) => video.concluido), [true, true, true, false]);
    assert.equal(daAna.proxima.estado, 'bloqueada');
    const finalizou = await progresso(ana, aula.videos[3].id, { posicaoSegundos: 45, finalizado: true });
    assert.equal(finalizou.dados.aulaConcluida, true);
    // Um vídeo novo, que ninguém assistiu, pode ser removido.
    const semExtra = { ...comExtra, videos: comExtra.videos.slice(0, 3).map((video, indice) => ({ ...video, id: aula.videos[indice].id })) };
    assert.equal((await chamar('PUT', `/api/admin/aulas/${aula.id}`, { usuario: admin, corpo: semExtra })).status, 200);
    assert.equal(noDisco(extra), false);
    [aula] = (await aulasDoCurso()).filter((item) => item.id === aula.id);
    assert.equal(aula.duracaoSegundos, 180);
    assert.equal((await abrir(ana)).aula.concluida, true);
    assert.deepEqual((await abrir(ana)).videos.map((video) => video.concluido), [true, true, true]);
  });

  await t.test('aluno não altera vídeos nem aulas', async () => {
    const corpo = { titulo: 'x', tipo: 'video', videos: [{ arquivo: aula.videos[0].arquivo }] };
    assert.equal((await chamar('PUT', `/api/admin/aulas/${aula.id}`, { usuario: ana, corpo })).status, 403);
    assert.equal((await chamar('POST', `/api/admin/cursos/${ids.curso}/aulas`, { usuario: ana, corpo })).status, 403);
  });

  await t.test('duração desconhecida é recuperada dos metadados do player e não permite conclusão fictícia', async () => {
    const arquivo = (await enviar(admin, Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64)]), 'video/webm')).dados.arquivo;
    const anteriores = aula.videos.map((video) => ({ id: video.id, titulo: video.titulo, arquivo: video.arquivo }));
    const corpo = { titulo: aula.titulo, tipo: 'video', videos: [...anteriores, { arquivo }] };
    assert.equal((await chamar('PUT', `/api/admin/aulas/${aula.id}`, { usuario: admin, corpo })).status, 200);
    const atual = (await aulasDoCurso()).find((item) => item.id === aula.id);
    const novo = atual.videos[3].id;
    assert.equal((await abrir(ana)).aula.duracaoSegundos, null);
    assert.equal((await progresso(ana, novo, { posicaoSegundos: 120, finalizado: true })).status, 422);
    assert.equal((await progresso(ana, novo, { posicaoSegundos: 1, duracaoSegundos: -1 })).status, 400);
    const metadados = await progresso(ana, novo, { posicaoSegundos: 0, duracaoSegundos: 120 });
    assert.equal(metadados.status, 200);
    assert.equal(metadados.dados.duracaoAulaSegundos, 300);
    assert.equal((await abrir(ana)).aula.duracaoSegundos, 300);
    assert.equal((await progresso(ana, novo, { posicaoSegundos: 108, finalizado: true })).status, 422);
    assert.equal((await progresso(ana, novo, { posicaoSegundos: 119, finalizado: true })).dados.aulaConcluida, true);
    // Remove inclusive um vídeo assistido, mantendo as conclusões dos outros.
    assert.equal((await chamar('PUT', `/api/admin/aulas/${aula.id}`, { usuario: admin,
      corpo: { ...corpo, videos: anteriores } })).status, 200);
    assert.equal((await abrir(ana)).aula.duracaoSegundos, 180);
    assert.equal((await abrir(ana)).aula.concluida, true);
  });

  await t.test('conclusões simultâneas não deixam a aula incompleta depois que todos os vídeos terminam', async () => {
    const arquivosNovos = [(await enviar(admin, mp4(20))).dados.arquivo, (await enviar(admin, mp4(25))).dados.arquivo];
    const anteriores = aula.videos.map((video) => ({ id: video.id, titulo: video.titulo, arquivo: video.arquivo }));
    const corpo = { titulo: aula.titulo, tipo: 'video', videos: [...anteriores, ...arquivosNovos.map((arquivo) => ({ arquivo }))] };
    assert.equal((await chamar('PUT', `/api/admin/aulas/${aula.id}`, { usuario: admin, corpo })).status, 200);
    const atual = (await aulasDoCurso()).find((item) => item.id === aula.id);
    const results = await Promise.all(atual.videos.slice(3).map((video) =>
      progresso(ana, video.id, { posicaoSegundos: video.duracaoSegundos, finalizado: true })));
    assert.ok(results.every((result) => result.status === 200));
    assert.equal((await abrir(ana)).aula.concluida, true);
    assert.equal((await abrir(bia)).aula.concluida, false);
    assert.equal((await chamar('PUT', `/api/admin/aulas/${aula.id}`, { usuario: admin,
      corpo: { ...corpo, videos: anteriores } })).status, 200);
  });

  await t.test('miniatura real, duração verificada, capa manual e reprodução leve preservam o original', async () => {
    const fixture = path.join(pasta('midias'), `fixture-${MARCA}.mp4`);
    await executarFFmpeg(['-f', 'lavfi', '-i', 'color=c=0xB69A61:s=640x360:r=30:d=1',
      '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', '-y', fixture]);
    const conteudo = fs.readFileSync(fixture);
    fs.rmSync(fixture);
    const arquivo = (await enviar(admin, conteudo)).dados.arquivo;
    await prepararVideo(arquivo);
    assert.ok(fs.existsSync(reproducaoDoArquivo(arquivo)));
    assert.deepEqual(fs.readFileSync(path.join(pasta('midias'), arquivo)), conteudo);
    const criada = (await criarAula({ titulo: 'Miniatura real', tipo: 'video', arquivo })).dados.aula.id;
    const [video] = await consulta('SELECT id FROM aula_videos WHERE aula_id = ?', [criada]);
    // Simula um valor legado incorreto: a leitura do arquivo corrige a duração.
    await consulta('UPDATE aula_videos SET duracao_segundos = 3 WHERE id = ?', [video.id]);
    await consulta('UPDATE aulas SET duracao_segundos = 3 WHERE id = ?', [criada]);
    let item = (await chamar('GET', `/api/cursos/${ids.curso}`, { usuario: ana })).dados.modulos
      .flatMap((modulo) => modulo.aulas).find((aula) => aula.id === criada);
    assert.equal(item.duracaoSegundos, 1);
    assert.equal(item.totalVideos, 1);
    assert.equal(item.bloqueio, 'sequencia');
    const thumb = await fetch(`${base}${item.thumbnail}`);
    assert.equal(thumb.status, 200);
    assert.match(thumb.headers.get('content-type'), /image\/jpeg/);
    const jpeg = Buffer.from(await thumb.arrayBuffer());
    assert.deepEqual([...jpeg.subarray(0, 3)], [0xff, 0xd8, 0xff]);
    // O vídeo continua protegido mesmo quando a imagem de apresentação pode ser vista.
    assert.equal((await chamar('GET', `/api/aulas/${criada}/videos/${video.id}/midia`, { usuario: ana })).status, 403);
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aA1cAAAAASUVORK5CYII=', 'base64');
    const response = await fetch(`${base}/api/admin/uploads/imagem`, { method: 'POST',
      headers: { Authorization: `Bearer ${gerarToken(admin)}`, 'Content-Type': 'image/png' }, body: png });
    const imagem = await response.json();
    assert.equal(response.status, 201);
    assert.equal((await chamar('PUT', `/api/admin/aulas/${criada}`, { usuario: admin,
      corpo: { titulo: 'Miniatura real', tipo: 'video', arquivo, imagemCapa: imagem.url } })).status, 200);
    item = (await chamar('GET', `/api/cursos/${ids.curso}`, { usuario: ana })).dados.modulos
      .flatMap((modulo) => modulo.aulas).find((aula) => aula.id === criada);
    assert.equal(item.thumbnail, imagem.url);
    assert.equal((await chamar('PUT', `/api/admin/aulas/${criada}`, { usuario: admin,
      corpo: { titulo: 'Miniatura real', tipo: 'video', arquivo, imagemCapa: null } })).status, 200);
    assert.equal(fs.existsSync(path.join(pasta('imagens'), imagem.arquivo)), false);
  });

  await t.test('aulas de vídeo no formato antigo são convertidas com o progresso dos alunos', async () => {
    const arquivo = (await enviar(admin, mp4(75))).dados.arquivo;
    const [modulo] = await consulta('SELECT id FROM modulos WHERE curso_id = ? LIMIT 1', [ids.curso]);
    // Como era antes: o arquivo e a duração direto na aula, e o progresso só por aula.
    const antiga = (
      await consulta(
        "INSERT INTO aulas (modulo_id, titulo, tipo, arquivo, duracao_segundos, ordem) VALUES (?, 'Aula antiga', 'video', ?, 75, 99)",
        [modulo.id, arquivo],
      )
    ).insertId;
    await consulta('INSERT INTO progresso_aulas (usuario_id, aula_id, posicao_segundos, concluida) VALUES (?, ?, 40, 0)', [ana, antiga]);

    await migrarVideosLegados();
    await migrarVideosLegados(); // repetir não duplica nada

    const videos = await consulta('SELECT id, arquivo, duracao_segundos, ordem FROM aula_videos WHERE aula_id = ?', [antiga]);
    assert.equal(videos.length, 1);
    assert.deepEqual([videos[0].arquivo, videos[0].duracao_segundos, videos[0].ordem], [arquivo, 75, 1]);
    assert.equal((await consulta('SELECT arquivo FROM aulas WHERE id = ?', [antiga]))[0].arquivo, null);
    const [salvo] = await consulta('SELECT posicao_segundos, concluido FROM progresso_videos WHERE usuario_id = ? AND video_id = ?', [ana, videos[0].id]);
    assert.deepEqual([salvo.posicao_segundos, salvo.concluido], [40, 0]);
    assert.equal(
      (await consulta('SELECT ultimo_video_id FROM progresso_aulas WHERE usuario_id = ? AND aula_id = ?', [ana, antiga]))[0].ultimo_video_id,
      videos[0].id,
    );

    // Versão anterior do aplicativo editando a aula: envia só o arquivo; o vídeo e o progresso continuam os mesmos.
    const corpo = { titulo: 'Aula antiga', tipo: 'video', arquivo };
    assert.equal((await chamar('PUT', `/api/admin/aulas/${antiga}`, { usuario: admin, corpo })).status, 200);
    const depois = await consulta('SELECT id FROM aula_videos WHERE aula_id = ?', [antiga]);
    assert.deepEqual(depois.map((video) => video.id), [videos[0].id]);
    assert.equal((await consulta('SELECT COUNT(*) AS n FROM progresso_videos WHERE video_id = ?', [videos[0].id]))[0].n, 1);
  });
});
