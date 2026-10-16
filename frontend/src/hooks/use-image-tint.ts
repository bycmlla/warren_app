import { Image } from 'expo-image';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

export type Rgb = [number, number, number];

/** Cores e recortes lidos das bordas de uma imagem, para integrá-la ao fundo da tela. */
export type Tint = {
  /** Cor dos cantos superiores (média do esquerdo e do direito): o fundo de onde a imagem surge. */
  top: Rgb;
  /** Cor média da faixa inferior da imagem. */
  bottom: Rgb;
  /** Cor média da imagem inteira: o tom que aquece a transição para o fundo claro. */
  average: Rgb;
  /** Arquivo temporário com a faixa inferior da imagem, usada para continuá-la abaixo da borda. */
  bottomUri: string;
  /** A cor do topo é escura: ícones e textos sobre ela precisam ser claros. */
  dark: boolean;
};

/** Tempo máximo que a tela espera pelas cores antes de abrir sem elas. */
const TIMEOUT = 500;
/** Fração da largura e da altura da imagem que conta como "canto" e como "faixa inferior". */
const CORNER = { width: 0.1, height: 0.08 };
const BOTTOM_STRIP = 0.05;

// Cada imagem é analisada uma única vez por sessão (o endereço de uma imagem enviada nunca muda
// de conteúdo). A promessa fica guardada para que a tela e a pré-análise não repitam o trabalho.
const results = new Map<string, Tint | null>();
const pending = new Map<string, Promise<Tint | null>>();

const BASE83 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~';

/**
 * Um blurhash (https://blurha.sh) de 1×1 componente guarda só a cor média da imagem: os
 * caracteres 2 a 5 são essa cor (24 bits, sRGB) escrita em base 83.
 */
function averageColor(blurhash: string | null): Rgb | null {
  if (!blurhash || blurhash.length < 6) return null;
  let value = 0;
  for (const char of blurhash.slice(2, 6)) {
    const digit = BASE83.indexOf(char);
    if (digit < 0) return null;
    value = value * 83 + digit;
  }
  return [value >> 16, (value >> 8) & 255, value & 255];
}

export const rgb = ([red, green, blue]: Rgb) => `rgb(${red}, ${green}, ${blue})`;

/** Mistura duas cores; `share` é a parte da segunda (0 a 1). */
export const mixRgb = (a: Rgb, b: Rgb, share: number): Rgb => [
  Math.round(a[0] + (b[0] - a[0]) * share),
  Math.round(a[1] + (b[1] - a[1]) * share),
  Math.round(a[2] + (b[2] - a[2]) * share),
];

// O tamanho do blurhash vai como lista [colunas, linhas]: o Android recusa { width, height }.
const colorOf = async (uri: string) => averageColor(await Image.generateBlurhashAsync(uri, [1, 1]));

/**
 * Lê as cores reais das bordas da imagem: recorta os dois cantos superiores e a faixa inferior
 * e tira a cor média de cada recorte. A média da imagem inteira não serve para o topo: um centro
 * brilhante daria um tom que não combina com as bordas, que é onde a imagem encontra o fundo.
 */
async function extract(url: string): Promise<Tint | null> {
  // Recorte e leitura são feitos por código nativo, que não existe na web.
  if (Platform.OS === 'web') return null;
  try {
    const image = await Image.loadAsync(url);
    const { width, height } = image;
    const context = ImageManipulator.manipulate(image);
    // Cada recorte vira um arquivo temporário (PNG, sem perda de cor): a leitura da cor só aceita
    // endereços ou imagens carregadas pelo próprio expo-image.
    const region = async (originX: number, originY: number, regionWidth: number, regionHeight: number) => {
      const rendered = await context
        .reset()
        .crop({ originX, originY, width: regionWidth, height: regionHeight })
        .renderAsync();
      try {
        return (await rendered.saveAsync({ format: SaveFormat.PNG })).uri;
      } finally {
        rendered.release();
      }
    };

    const cornerWidth = Math.max(Math.round(width * CORNER.width), 1);
    const cornerHeight = Math.max(Math.round(height * CORNER.height), 1);
    const stripHeight = Math.max(Math.round(height * BOTTOM_STRIP), 1);
    const bottomUri = await region(0, height - stripHeight, width, stripHeight);
    const [left, right, bottom, average] = [
      await colorOf(await region(0, 0, cornerWidth, cornerHeight)),
      await colorOf(await region(width - cornerWidth, 0, cornerWidth, cornerHeight)),
      await colorOf(bottomUri),
      await colorOf(url),
    ];
    if (!left || !right || !bottom || !average) return null;

    const top = mixRgb(left, right, 0.5);
    return { top, bottom, average, bottomUri, dark: 0.299 * top[0] + 0.587 * top[1] + 0.114 * top[2] < 140 };
  } catch {
    return null;
  }
}

function analyse(url: string) {
  let promise = pending.get(url);
  if (!promise) {
    promise = extract(url).then((tint) => {
      results.set(url, tint);
      return tint;
    });
    pending.set(url, promise);
  }
  return promise;
}

/**
 * Analisa com antecedência, uma por vez, as imagens que o usuário provavelmente vai abrir
 * (por exemplo, os banners dos cursos listados na Home), para a tela do curso já encontrar
 * as cores prontas.
 */
export async function prefetchTints(urls: (string | null)[]) {
  for (const url of new Set(urls)) {
    if (url !== null && !results.has(url)) await analyse(url);
  }
}

/**
 * Cores das bordas da imagem em `url`, lidas no próprio aparelho. `ready` fica falso enquanto
 * a imagem é analisada (só se ela ainda não tiver sido), por no máximo meio segundo, para a tela
 * não aparecer com uma cor e trocar em seguida. Sem imagem, ou se a leitura falhar, `tint` é
 * null e a tela usa o fundo do aplicativo.
 */
export function useImageTint(url: string | null) {
  const [loaded, setLoaded] = useState<{ url: string; tint: Tint | null }>();

  useEffect(() => {
    if (url === null || results.has(url)) return undefined;
    let active = true;
    const timer = setTimeout(() => active && setLoaded({ url, tint: null }), TIMEOUT);
    analyse(url).then((tint) => {
      clearTimeout(timer);
      if (active) setLoaded({ url, tint });
    });
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [url]);

  if (url === null) return { ready: true, tint: null };
  if (results.has(url)) return { ready: true, tint: results.get(url) ?? null };
  return loaded?.url === url ? { ready: true, tint: loaded.tint } : { ready: false, tint: null };
}
