process.env.JWT_SECRET = 'segredo-usado-apenas-nos-testes-automatizados';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const database = require('../src/config/database');
const { assinaturaValida, tipoDaMidia, URL_DE_IMAGEM } = require('../src/config/storage');
const { estadosDasAulas, linkSpotifyValido } = require('../src/utils/cursos');
const { ErroRequisicao, texto, booleano, listaDeIds, idDaRota } = require('../src/utils/http');

test.after(() => database.end());

test('estadosDasAulas', async (t) => {
  const aulas = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
  const estados = (concluidas, sequencial) => estadosDasAulas(aulas, new Set(concluidas), sequencial);

  await t.test('sequencial: só a primeira aula não concluída fica disponível', () => {
    assert.deepEqual(estados([], true), ['disponivel', 'bloqueada', 'bloqueada', 'bloqueada']);
    assert.deepEqual(estados([1], true), ['concluida', 'disponivel', 'bloqueada', 'bloqueada']);
    assert.deepEqual(estados([1, 2, 3], true), ['concluida', 'concluida', 'concluida', 'disponivel']);
    assert.deepEqual(estados([1, 2, 3, 4], true), ['concluida', 'concluida', 'concluida', 'concluida']);
  });

  await t.test('sequencial: uma aula concluída fora de ordem não libera as seguintes', () => {
    assert.deepEqual(estados([3], true), ['disponivel', 'bloqueada', 'concluida', 'bloqueada']);
    assert.deepEqual(estados([1, 3], true), ['concluida', 'disponivel', 'concluida', 'bloqueada']);
  });

  await t.test('sem sequência: todas as aulas ficam disponíveis', () => {
    assert.deepEqual(estados([], false), ['disponivel', 'disponivel', 'disponivel', 'disponivel']);
    assert.deepEqual(estados([2], false), ['disponivel', 'concluida', 'disponivel', 'disponivel']);
  });

  await t.test('curso sem aulas', () => {
    assert.deepEqual(estadosDasAulas([], new Set(), true), []);
  });
});

test('linkSpotifyValido aceita apenas endereços https do Spotify', () => {
  for (const link of ['https://open.spotify.com/playlist/abc123', 'https://spotify.link/abc', 'HTTPS://OPEN.SPOTIFY.COM/track/1']) {
    assert.equal(linkSpotifyValido(link), true, link);
  }
  for (const link of [
    'http://open.spotify.com/playlist/abc',
    'https://open.spotify.com.evil.com/x',
    'https://evil.com/?u=https://open.spotify.com/x',
    'https://open.spotify.com/',
    'https://open.spotify.com/a b',
    'spotify:playlist:abc',
    'javascript:alert(1)',
    `https://open.spotify.com/${'x'.repeat(500)}`,
    '',
    null,
    undefined,
    42,
  ]) {
    assert.equal(linkSpotifyValido(link), false, String(link));
  }
});

test('armazenamento', async (t) => {
  const bytes = (...partes) => Buffer.concat(partes.map((parte) => (typeof parte === 'string' ? Buffer.from(parte, 'latin1') : Buffer.from(parte))));
  const preenchimento = Buffer.alloc(12);

  await t.test('assinaturaValida confere os primeiros bytes de cada formato', () => {
    const validos = {
      jpg: bytes([0xff, 0xd8, 0xff, 0xe0], preenchimento),
      png: bytes([0x89], 'PNG\r\n\x1a\n', preenchimento),
      webp: bytes('RIFF', [0, 0, 0, 0], 'WEBP'),
      mp4: bytes([0, 0, 0, 0x18], 'ftypmp42'),
      m4a: bytes([0, 0, 0, 0x18], 'ftypM4A '),
      mov: bytes([0, 0, 0, 8], 'wide', preenchimento),
      webm: bytes([0x1a, 0x45, 0xdf, 0xa3], preenchimento),
      mp3: bytes('ID3', preenchimento),
      aac: bytes([0xff, 0xf1], preenchimento),
      wav: bytes('RIFF', [0, 0, 0, 0], 'WAVE'),
      ogg: bytes('OggS', preenchimento),
    };
    for (const [extensao, inicio] of Object.entries(validos)) {
      assert.equal(assinaturaValida(extensao, inicio), true, extensao);
    }
    assert.equal(assinaturaValida('mp3', bytes([0xff, 0xfb], preenchimento)), true);

    assert.equal(assinaturaValida('mp4', validos.wav), false);
    assert.equal(assinaturaValida('wav', validos.webp), false);
    assert.equal(assinaturaValida('jpg', validos.png), false);
    assert.equal(assinaturaValida('mp4', bytes('<html><body>', preenchimento)), false);
    assert.equal(assinaturaValida('mp4', Buffer.from('ftyp')), false);
    assert.equal(assinaturaValida('exe', validos.mp4), false);
  });

  await t.test('tipoDaMidia só reconhece nomes gerados pelo upload', () => {
    const nome = 'a'.repeat(32);
    assert.equal(tipoDaMidia(`${nome}.mp4`), 'video');
    assert.equal(tipoDaMidia(`${nome}.webm`), 'video');
    assert.equal(tipoDaMidia(`${nome}.mp3`), 'audio');
    assert.equal(tipoDaMidia(`${nome}.wav`), 'audio');
    for (const invalido in { [`${nome}.png`]: 1, [`../${nome}.mp4`]: 1, [`${nome}.mp4/..`]: 1, 'video.mp4': 1, '': 1 }) {
      assert.equal(tipoDaMidia(invalido), null, invalido);
    }
    assert.equal(tipoDaMidia(null), null);
    assert.equal(tipoDaMidia(undefined), null);
  });

  await t.test('URL_DE_IMAGEM só aceita imagens do próprio armazenamento', () => {
    const nome = 'b'.repeat(32);
    assert.equal(URL_DE_IMAGEM.test(`/arquivos/imagens/${nome}.jpg`), true);
    assert.equal(URL_DE_IMAGEM.test(`/arquivos/imagens/${nome}.webp`), true);
    assert.equal(URL_DE_IMAGEM.test(`/arquivos/imagens/../midias/${nome}.mp4`), false);
    assert.equal(URL_DE_IMAGEM.test(`/arquivos/midias/${nome}.jpg`), false);
    assert.equal(URL_DE_IMAGEM.test(`/arquivos/imagens/${nome}.mp4`), false);
  });
});

test('validação de entrada', () => {
  const recusa = (acao, status) => assert.throws(acao, (error) => error instanceof ErroRequisicao && error.status === status);

  assert.equal(texto('  Olá  ', 'o título', { max: 10 }), 'Olá');
  assert.equal(texto('', 'descrição', { max: 10 }), null);
  assert.equal(texto('   ', 'descrição', { max: 10 }), null);
  assert.equal(texto(undefined, 'descrição', { max: 10 }), null);
  assert.equal(texto('é'.repeat(10), 'descrição', { max: 10 }), 'é'.repeat(10));
  recusa(() => texto('x'.repeat(11), 'descrição', { max: 10 }), 400);
  recusa(() => texto(123, 'descrição', { max: 10 }), 400);
  recusa(() => texto(' ', 'o título', { max: 10, obrigatorio: true }), 400);
  recusa(() => texto(undefined, 'o título', { max: 10, obrigatorio: true }), 400);

  assert.equal(booleano(true, 'x'), 1);
  assert.equal(booleano(false, 'x'), 0);
  for (const valor of ['true', 1, null, undefined]) recusa(() => booleano(valor, 'x'), 400);

  assert.deepEqual(listaDeIds([3, 1, 2]), [3, 1, 2]);
  for (const valor of [[], [1, 1], [1, '2'], [0], [-1], [1.5], 'x', null, undefined]) recusa(() => listaDeIds(valor), 400);

  assert.equal(idDaRota('12'), 12);
  for (const valor of ['abc', '0', '-1', '1.5', '']) recusa(() => idDaRota(valor), 404);
});

test('condições comerciais', async (t) => {
  const { valoresPix, condicoesComerciais, camposComerciais, pendenciasComerciais } = require('../src/utils/comercial');
  const curso = {
    tipo_acesso: 'pago',
    preco_centavos: 29700,
    pix_habilitado: 1,
    pix_desconto_percentual: '5.00',
    cartao_habilitado: 1,
    cartao_max_parcelas: 12,
    cartao_parcelas_sem_juros: 3,
    prazo_acesso_meses: 12,
  };

  await t.test('valoresPix aplica o desconto em centavos, sem frações', () => {
    assert.deepEqual(valoresPix(29700, 0), { descontoCentavos: 0, totalCentavos: 29700 });
    assert.deepEqual(valoresPix(29700, '5.00'), { descontoCentavos: 1485, totalCentavos: 28215 });
    assert.deepEqual(valoresPix(9999, 7.5), { descontoCentavos: 750, totalCentavos: 9249 });
    assert.deepEqual(valoresPix(1, 50), { descontoCentavos: 1, totalCentavos: 0 });
  });

  await t.test('condicoesComerciais só existe para curso pago com preço e nunca inventa parcelas', () => {
    assert.deepEqual(condicoesComerciais(curso), {
      precoCentavos: 29700,
      prazoAcessoMeses: 12,
      pix: { descontoPercentual: 5, descontoCentavos: 1485, totalCentavos: 28215 },
      cartao: { maxParcelas: 12, parcelasSemJuros: 3 },
    });
    assert.deepEqual(condicoesComerciais({ ...curso, pix_habilitado: 0, cartao_habilitado: 0, prazo_acesso_meses: null }), {
      precoCentavos: 29700,
      prazoAcessoMeses: null,
      pix: null,
      cartao: null,
    });
    assert.equal(condicoesComerciais({ ...curso, tipo_acesso: 'gratuito' }), null);
    assert.equal(condicoesComerciais({ ...curso, tipo_acesso: 'restrito' }), null);
    assert.equal(condicoesComerciais({ ...curso, preco_centavos: null }), null);
  });

  await t.test('camposComerciais valida o que o formulário envia', () => {
    assert.deepEqual(
      camposComerciais({
        tipoAcesso: 'pago',
        precoCentavos: 29700,
        pixHabilitado: true,
        pixDescontoPercentual: 5.555,
        cartaoHabilitado: true,
        cartaoMaxParcelas: 12,
        cartaoParcelasSemJuros: 3,
        prazoAcessoMeses: 24,
      }),
      {
        tipo_acesso: 'pago',
        gratuito: 0,
        preco_centavos: 29700,
        pix_habilitado: 1,
        pix_desconto_percentual: 5.56,
        cartao_habilitado: 1,
        cartao_max_parcelas: 12,
        cartao_parcelas_sem_juros: 3,
        prazo_acesso_meses: 24,
      },
    );
    // Versões anteriores do aplicativo enviavam só `gratuito`.
    assert.equal(camposComerciais({ gratuito: true }).tipo_acesso, 'gratuito');
    assert.equal(camposComerciais({ gratuito: true }).gratuito, 1);
    assert.equal(camposComerciais({}).tipo_acesso, 'restrito');

    for (const invalido of [
      { tipoAcesso: 'vip' },
      { tipoAcesso: 'pago', precoCentavos: 0 },
      { tipoAcesso: 'pago', precoCentavos: -100 },
      { tipoAcesso: 'pago', precoCentavos: 297.5 },
      { tipoAcesso: 'pago', precoCentavos: '29700' },
      { tipoAcesso: 'pago', precoCentavos: 10000001 },
      { tipoAcesso: 'pago', pixDescontoPercentual: -1 },
      { tipoAcesso: 'pago', pixDescontoPercentual: 91 },
      { tipoAcesso: 'pago', pixDescontoPercentual: '5' },
      { tipoAcesso: 'pago', cartaoMaxParcelas: 0 },
      { tipoAcesso: 'pago', cartaoMaxParcelas: 13 },
      { tipoAcesso: 'pago', cartaoMaxParcelas: 6, cartaoParcelasSemJuros: 7 },
      { tipoAcesso: 'pago', prazoAcessoMeses: 6 },
      { tipoAcesso: 'pago', pixHabilitado: 'sim' },
    ]) {
      assert.throws(() => camposComerciais(invalido), ErroRequisicao, JSON.stringify(invalido));
    }
  });

  await t.test('pendenciasComerciais: curso pago precisa de preço e de uma forma de pagamento', () => {
    assert.deepEqual(pendenciasComerciais(curso), []);
    assert.deepEqual(pendenciasComerciais({ ...curso, cartao_habilitado: 0 }), []);
    assert.equal(pendenciasComerciais({ ...curso, preco_centavos: null }).length, 1);
    assert.equal(pendenciasComerciais({ ...curso, pix_habilitado: 0, cartao_habilitado: 0 }).length, 1);
    assert.equal(pendenciasComerciais({ tipo_acesso: 'pago', preco_centavos: null, pix_habilitado: 0, cartao_habilitado: 0 }).length, 2);
    assert.deepEqual(pendenciasComerciais({ tipo_acesso: 'restrito', preco_centavos: null }), []);
  });
});
