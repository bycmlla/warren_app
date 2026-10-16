// Validação real no Edge, com banco e navegador temporários. Não encerra Expo nem a API em uso.
const assert = require('node:assert/strict');
const { createHash, randomBytes } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
require('dotenv').config({ path: path.join(__dirname, '../.env'), quiet: true });
const mysql = require('mysql2/promise');
const express = require('express');
const bcrypt = require('bcrypt');
const workspace = path.resolve(__dirname, '../..');
const output = path.join(workspace, process.env.VALIDACAO_OUTPUT || 'validacao-aulas');
const experience = process.argv.includes('--experiencia');
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function main() {
  const source = process.env.DB_NAME || 'joanalia';
  const target = `joanalia_web_${process.pid}_${randomBytes(5).toString('hex')}`;
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'joanalia-web-'));
  let connection, pool, api, web, browser, cdp, created = false;
  try {
    connection = await mysql.createConnection({ host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '' });
    const [tables] = await connection.query('SHOW FULL TABLES FROM ?? WHERE Table_type = ?', [source, 'BASE TABLE']);
    const names = tables.map((row) => Object.values(row)[0]);
    const snapshot = async () => {
      const result = {};
      for (const name of names) {
        const [rows] = await connection.query('SELECT * FROM ??.??', [source, name]);
        result[name] = { count: rows.length, hash: createHash('sha256').update(JSON.stringify(rows.map(JSON.stringify).sort())).digest('hex') };
      }
      return result;
    };
    const before = await snapshot();
    assert.notEqual(source, target);
    assert.match(target, /^joanalia_web_\d+_[a-f0-9]{10}$/);
    await connection.query('CREATE DATABASE ?? CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci', [target]);
    created = true;
    await connection.query('USE ??', [target]);
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const name of names) {
      const [definitions] = await connection.query('SHOW CREATE TABLE ??.??', [source, name]);
      const ddl = definitions[0]['Create Table'];
      assert.ok(!ddl.includes(`REFERENCES \`${source}\`.`));
      await connection.query(ddl);
    }
    await connection.query('SET FOREIGN_KEY_CHECKS = 1');
    process.env.DB_NAME = target;
    process.env.STORAGE_DIR = path.join(temporary, 'storage');
    process.env.JWT_SECRET = 'segredo-exclusivo-da-validacao-web-isolada';
    const app = require('../src/app');
    const { gerarToken } = require('../src/config/auth');
    pool = require('../src/config/database');
    api = await new Promise((resolve) => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
    const apiBase = `http://127.0.0.1:${api.address().port}`;
    const sql = async (query, parameters = []) => (await pool.query(query, parameters))[0];
    const password = 'validacao-web-aulas-2026';
    const hash = await bcrypt.hash(password, 4);
    const users = [];
    for (const [name, type] of [['Admin', 'admin'], ['Ana', 'aluno'], ['Bia', 'aluno']]) {
      users.push((await sql('INSERT INTO usuarios (nome, email, senha, tipo) VALUES (?, ?, ?, ?)',
        [name, `${name.toLowerCase()}@aulas-web.invalid`, hash, type])).insertId);
    }
    const [admin, ana, bia] = users;
    const request = async (method, route, user, body) => {
      const response = await fetch(`${apiBase}${route}`, { method,
        headers: { Authorization: `Bearer ${gerarToken(user)}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body) });
      const data = await response.json();
      assert.ok(response.ok, JSON.stringify(data));
      return data;
    };
    const category = (await sql("INSERT INTO categorias (nome) VALUES ('Validação de aulas')")).insertId;
    const course = (await request('POST', '/api/admin/cursos', admin, { titulo: 'Curso de validação', descricao: 'Validação automática de reprodução.',
      categoriaId: category, tipoAcesso: 'gratuito', secao: 'para-voce', sequencial: false })).curso.id;
    // Usa um MP4 real já existente como fixture, apenas lendo o original.
    const mediaFolder = path.join(workspace, 'backend/storage/midias');
    const fixture = fs.readdirSync(mediaFolder).filter((name) => name.endsWith('.mp4'))
      .sort((a, b) => fs.statSync(path.join(mediaFolder, b)).size - fs.statSync(path.join(mediaFolder, a)).size)[0];
    assert.ok(fixture, 'É necessário um MP4 real no armazenamento para validar decodificação.');
    const bytes = fs.readFileSync(path.join(workspace, 'backend/storage/midias', fixture));
    const upload = await fetch(`${apiBase}/api/admin/uploads/video`, { method: 'POST',
      headers: { Authorization: `Bearer ${gerarToken(admin)}`, 'Content-Type': 'video/mp4' }, body: bytes });
    assert.equal(upload.status, 201);
    const media = await upload.json();
    const { prepararVideo, reproducaoDoArquivo } = require('../src/utils/prepararVideo');
    await prepararVideo(media.arquivo);
    const optimizedBytes = fs.statSync(reproducaoDoArquivo(media.arquivo)).size;
    assert.ok(optimizedBytes < bytes.length);
    const lesson = (await request('POST', `/api/admin/cursos/${course}/aulas`, admin, {
      titulo: 'Aula com dois vídeos', descricao: 'Continue de onde parou.', tipo: 'video',
      videos: [{ titulo: 'Parte 1', arquivo: media.arquivo }, { titulo: 'Parte 2', arquivo: media.arquivo }] })).aula.id;
    const single = (await request('POST', `/api/admin/cursos/${course}/aulas`, admin, {
      titulo: 'Aula com um vídeo', tipo: 'video', arquivo: media.arquivo })).aula.id;
    await request('PUT', `/api/admin/cursos/${course}/status`, admin, { status: 'publicado' });
    const frontend = express();
    const exported = path.join(output, 'web');
    frontend.get('/lesson/:id', (req, res) => res.sendFile(path.join(exported, 'lesson/[id].html')));
    frontend.get('/course/:id', (req, res) => res.sendFile(path.join(exported, 'course/[id].html')));
    frontend.use(express.static(exported, { extensions: ['html'] }));
    web = await new Promise((resolve) => { const server = frontend.listen(0, '127.0.0.1', () => resolve(server)); });
    const base = `http://127.0.0.1:${web.address().port}`;
    const profile = path.join(temporary, 'edge');
    browser = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0',
      `--user-data-dir=${profile}`, '--autoplay-policy=no-user-gesture-required', 'about:blank',
    ], { windowsHide: true, stdio: 'ignore' });
    const activePort = path.join(profile, 'DevToolsActivePort');
    for (let i = 0; !fs.existsSync(activePort) && i < 100; i++) await pause(200);
    assert.ok(fs.existsSync(activePort), 'Edge não abriu o protocolo de depuração.');
    const port = fs.readFileSync(activePort, 'utf8').split('\n')[0];
    const page = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
    cdp = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { cdp.addEventListener('open', resolve, { once: true }); cdp.addEventListener('error', reject, { once: true }); });
    let sequence = 0, offlineProgress = false;
    const waiting = new Map();
    const errors = [];
    const command = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++sequence;
      waiting.set(id, { resolve, reject });
      cdp.send(JSON.stringify({ id, method, params }));
    });
    cdp.addEventListener('message', async (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const pending = waiting.get(message.id);
        waiting.delete(message.id);
        if (message.error) pending?.reject(new Error(message.error.message));
        else pending?.resolve(message.result);
        return;
      }
      if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
      if (message.method !== 'Fetch.requestPaused') return;
      const { requestId, request } = message.params;
      try {
        const url = new URL(request.url);
        if (offlineProgress && url.pathname.endsWith('/progresso')) {
          await command('Fetch.failRequest', { requestId, errorReason: 'InternetDisconnected' });
          return;
        }
        const headers = { ...request.headers };
        for (const name of Object.keys(headers)) if (/^(host|connection|content-length)$/i.test(name)) delete headers[name];
        const response = await fetch(`${apiBase}${url.pathname}${url.search}`, { method: request.method, headers, body: request.postData });
        const buffer = Buffer.from(await response.arrayBuffer());
        await command('Fetch.fulfillRequest', { requestId, responseCode: response.status,
          responseHeaders: [...response.headers].filter(([name]) => !/^(content-length|content-encoding|transfer-encoding|connection)$/i.test(name))
            .map(([name, value]) => ({ name, value })), body: buffer.toString('base64') });
      } catch { await command('Fetch.failRequest', { requestId, errorReason: 'Failed' }).catch(() => undefined); }
    });
    await command('Runtime.enable');
    await command('Page.enable');
    if (experience) await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await command('Fetch.enable', { patterns: [{ urlPattern: '*://*:3000/*' }] });
    const evaluate = async (expression) => {
      const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    };
    const waitFor = async (expression, description) => {
      for (let i = 0; i < 150; i++) { if (await evaluate(`Boolean(${expression})`)) return; await pause(200); }
      throw new Error(`${description}: ${await evaluate('document.body.innerText')}`);
    };
    const click = (label) => evaluate(`(() => { const item = [...document.querySelectorAll('[role="button"]')].find(node => node.textContent.trim() === ${JSON.stringify(label)}); if (!item) throw new Error('Botão ausente'); item.click(); })()`);
    const go = async (id) => {
      await evaluate(`history.pushState(null, '', '/lesson/${id}'); window.dispatchEvent(new PopStateEvent('popstate'));`);
      await waitFor('document.querySelector("video")?.readyState >= 1', 'Metadados do vídeo');
    };
    const login = async (email) => {
      await command('Page.navigate', { url: `${base}/login` });
      await waitFor(`document.querySelector('input[aria-label="E-mail"]')`, 'Formulário de login');
      await evaluate(`(() => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        for (const [label, value] of [['E-mail', ${JSON.stringify(email)}], ['Senha', ${JSON.stringify(password)}]]) {
          const input = document.querySelector('input[aria-label="'+label+'"]'); set.call(input, value); input.dispatchEvent(new Event('input', {bubbles:true}));
        } })()`);
      await click('Entrar');
      await waitFor('!location.pathname.startsWith("/login")', 'Login autenticado');
    };
    const screenshot = async (name) => {
      const capture = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      fs.writeFileSync(path.join(output, `${name}.png`), Buffer.from(capture.data, 'base64'));
    };

    const goCourse = async (id) => {
      await evaluate(`history.pushState(null, '', '/course/${id}'); window.dispatchEvent(new PopStateEvent('popstate'));`);
      await waitFor('document.body.innerText.includes("Conteúdo do curso")', 'Conteúdo do curso');
    };
    const row = (title) => `([...document.querySelectorAll('[role="button"]')].find(node => node.getAttribute('aria-label')?.startsWith(${JSON.stringify(title + ',')})))`;
    const imageLoaded = (title) => `Boolean(${row(title)}?.querySelector('img')?.naturalWidth)`;

    let quality;

    await login('ana@aulas-web.invalid');
    await go(lesson);
    assert.ok(await evaluate('document.body.innerText.includes("Parte 1") && document.body.innerText.includes("Parte 2")'));
    await evaluate('(() => {const video=document.querySelector("video"); video.currentTime=12; return video.play();})()');
    if (experience) await evaluate('window.initialPlayer = document.querySelector("video"); window.reloads = 0; window.initialPlayer.addEventListener("loadedmetadata", () => window.reloads++);');
    await pause(experience ? 11200 : 1200);
    if (experience) {
      assert.equal(await evaluate('document.querySelector("video") === window.initialPlayer'), true);
      assert.equal(await evaluate('window.reloads'), 0);
      quality = await evaluate('(() => { const q=document.querySelector("video").getVideoPlaybackQuality(); return {totalFrames:q.totalVideoFrames, droppedFrames:q.droppedVideoFrames}; })()');
    }
    await evaluate('document.querySelector("video").pause()');
    await pause(1200);
    let data = await request('GET', `/api/aulas/${lesson}`, ana);
    assert.ok(data.videos[0].posicaoSegundos >= 12);
    assert.equal(data.aula.concluida, false);
    await screenshot('aula-multiplos-videos');
    console.log('Web: pausa e posição persistida no MySQL confirmadas.');

    // Sai e reabre pela navegação do aplicativo; depois reabre uma página inteira e entra novamente.
    await click('Voltar ao curso');
    await go(lesson);
    assert.ok(await evaluate('document.querySelector("video").currentTime >= 12'));
    await login('ana@aulas-web.invalid');
    await go(lesson);
    assert.ok(await evaluate('document.querySelector("video").currentTime >= 12'));
    await click('Recomeçar do início');
    console.log('Web: retomada após reabrir e reinício confirmados.');
    await waitFor('document.querySelector("video")?.currentTime < 4', 'Reinício');
    await evaluate('document.querySelector("video").pause()');

    // Terminar a primeira parte deve avançar automaticamente sem concluir a aula.
    await evaluate('(() => {const video=document.querySelector("video"); video.currentTime=video.duration-0.3; return video.play();})()');
    await waitFor('document.body.innerText.includes("Vídeo 2 de 2")', 'Avanço automático');
    await waitFor('document.querySelector("video")?.readyState >= 1', 'Segundo vídeo');
    data = await request('GET', `/api/aulas/${lesson}`, ana);
    assert.equal(data.aula.concluida, false);
    assert.equal(data.videos[0].concluido, true);
    await evaluate('(() => {const video=document.querySelector("video"); video.currentTime=video.duration-0.3; return video.play();})()');
    await waitFor('document.body.innerText.includes("Aula concluída.")', 'Conclusão da aula inteira');
    assert.equal((await request('GET', `/api/aulas/${lesson}`, ana)).aula.concluida, true);
    await screenshot('aula-concluida');
    console.log('Web: avanço automático e conclusão de todos os vídeos confirmados.');

    await go(single);
    assert.equal(await evaluate(`document.querySelectorAll('[role="button"][aria-label^="Vídeo "]').length`), 0);
    await screenshot('aula-video-unico');
    // Uma falha de gravação deixa a posição local, que é enviada quando a conexão volta.
    offlineProgress = true;
    await evaluate('(() => {const video=document.querySelector("video"); video.currentTime=15; return video.play();})()');
    await pause(500);
    await evaluate('document.querySelector("video").pause()');
    await waitFor(`localStorage.getItem('joanalia.progress.${ana}')?.includes('"seconds"')`, 'Checkpoint local após queda');
    await login('ana@aulas-web.invalid');
    await go(single);
    assert.ok(await evaluate('document.querySelector("video").currentTime >= 15'));
    offlineProgress = false;
    await evaluate('window.dispatchEvent(new Event("online"))');
    await waitFor(`!localStorage.getItem('joanalia.progress.${ana}')`, 'Envio do checkpoint pendente');
    assert.ok((await request('GET', `/api/aulas/${single}`, ana)).videos[0].posicaoSegundos >= 15);
    console.log('Web: vídeo único e recuperação após queda de conexão confirmados.');

    await login('bia@aulas-web.invalid');
    await go(lesson);
    assert.equal(await evaluate('document.querySelector("video").currentTime'), 0);
    assert.equal((await request('GET', `/api/aulas/${lesson}`, bia)).aula.concluida, false);

    if (experience) {
      await request('PUT', `/api/admin/cursos/${course}`, admin, { titulo: 'Curso de validação', descricao: 'Validação automática de reprodução.',
        categoriaId: category, tipoAcesso: 'gratuito', sequencial: true });
      await goCourse(course);
      await waitFor(imageLoaded('Aula com dois vídeos'), 'Thumbnail real da aula');
      const sequenceRow = row('Aula com um vídeo');
      assert.ok(await evaluate(`${sequenceRow}.textContent.includes('Aguardando')`));
      await evaluate(`${sequenceRow}.click()`);
      await waitFor('document.body.innerText.includes("Conclua as aulas anteriores para liberar esta aula.")', 'Mensagem de progressão');
      assert.ok(await evaluate(`location.pathname === '/course/${course}'`));
      await evaluate(`${sequenceRow}.scrollIntoView({block:'center'})`);
      await screenshot('curso-bloqueio-sequencia');

      const paid = (await request('POST', '/api/admin/cursos', admin, { titulo: 'Curso pago de validação', descricao: 'Validação de acesso.',
        categoriaId: category, tipoAcesso: 'pago', precoCentavos: 9900, pixHabilitado: true, prazoAcessoMeses: 12 })).curso.id;
      await request('POST', `/api/admin/cursos/${paid}/aulas`, admin, { titulo: 'Aula protegida por acesso', tipo: 'video', arquivo: media.arquivo });
      await request('PUT', `/api/admin/cursos/${paid}/status`, admin, { status: 'publicado' });
      await goCourse(paid);
      const accessRow = row('Aula protegida por acesso');
      await waitFor(imageLoaded('Aula protegida por acesso'), 'Thumbnail no curso ainda não comprado');
      assert.ok(await evaluate(`${accessRow}.textContent.includes('Sem acesso')`));
      await evaluate(`${accessRow}.click()`);
      await waitFor('document.body.innerText.includes("Esta aula está bloqueada porque você ainda não possui acesso a este curso.")', 'Mensagem de acesso');
      assert.ok(await evaluate(`location.pathname === '/course/${paid}'`));
      await evaluate(`${accessRow}.scrollIntoView({block:'center'})`);
      await screenshot('curso-bloqueio-acesso');

      await login('ana@aulas-web.invalid');
      await goCourse(course);
      await waitFor(`${row('Aula com dois vídeos')}.textContent.includes('Concluída')`, 'Indicação concluída');
      await evaluate(`${row('Aula com dois vídeos')}.scrollIntoView({block:'center'})`);
      await screenshot('curso-aula-concluida');
      console.log('Web: thumbnails, estados e mensagens de acesso/progressão validados em largura de celular.');
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(await snapshot(), before, 'O banco original não pode ser alterado pela validação web.');
    fs.writeFileSync(path.join(output, 'web-result.json'), JSON.stringify({ passed: true, checks: [
      'decodificação de MP4 real', 'lista compacta', 'pausa', 'retomada por navegação e após reabrir', 'reinício',
      'avanço automático', 'conclusão de todos os vídeos', 'interface de vídeo único', 'queda e recuperação de conexão',
      'isolamento entre alunos', 'ausência de exceções JavaScript', 'preservação das tabelas originais',
    ], errors, originalTables: names.length, optimization: { originalBytes: bytes.length, optimizedBytes,
      reductionPercent: Math.round((1 - optimizedBytes / bytes.length) * 100), quality }, experience }, null, 2));
    console.log('Validação web aprovada: reprodução, persistência, retomada, conclusão e isolamento.');
  } finally {
    if (cdp?.readyState === WebSocket.OPEN) {
      cdp.send(JSON.stringify({ id: 999999, method: 'Browser.close' }));
      cdp.close();
    } else if (browser) browser.kill();
    if (api) { api.closeAllConnections(); await new Promise((resolve) => api.close(resolve)); }
    if (web) { web.closeAllConnections(); await new Promise((resolve) => web.close(resolve)); }
    if (pool) await pool.end();
    try { if (created) await connection.query('DROP DATABASE ??', [target]); }
    finally {
      if (connection) await connection.end();
      const resolved = fs.realpathSync(temporary);
      assert.equal(path.dirname(resolved), fs.realpathSync(os.tmpdir()));
      assert.ok(path.basename(resolved).startsWith('joanalia-web-'));
      await pause(500);
      fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  }
}
main().catch((error) => { console.error(error.stack); process.exitCode = 1; });
