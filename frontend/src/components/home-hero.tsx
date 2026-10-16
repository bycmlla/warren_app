import { Image } from 'expo-image';
import { useState } from 'react';
import { Dimensions, PixelRatio, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, {
  ClipPath,
  Defs,
  Ellipse,
  Image as SvgImage,
  LinearGradient,
  Path,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';

import { BrandIcon } from '@/components/brand-icon';
import { fileUrl } from '@/constants/api';
import {
  BUTTON_STYLES,
  DEFAULT_BANNER,
  DEFAULT_BANNER_TEXTS,
  type BannerConfig,
  type ButtonStyle,
} from '@/constants/banner';
import { Brand, Fonts, Radius } from '@/constants/brand';

// A arte é desenhada em uma prancheta de 366 x 242 e ancorada à direita do banner.

// Temporary measurements only; removed after Android inspection.
function measureBannerLayout(element: string, metadata: Record<string, unknown> = {}) {
  return (event: LayoutChangeEvent) => console.info('[JOANALIA_BANNER_MEASURE]', JSON.stringify({
    element, ...metadata, layout: event.nativeEvent.layout,
    density: PixelRatio.get(), window: Dimensions.get('window'),
  }));
}

const ART_WIDTH = 366;
const ART_HEIGHT = 242;
const PORTRAIT =
  'M288 27C331 25 373 58 372 108C371 158 342 198 303 200C278 202 261 186 250 160C240 136 218 116 218 89C218 55 249 29 288 27Z';
const BLOB =
  'M272 17C320 12 368 46 368 100C368 156 332 198 288 198C250 198 222 172 210 138C200 110 200 80 216 55C230 33 248 20 272 17Z';

type Props = {
  width: number;
  onExplore: () => void;
  /** Configuração publicada; sem ela, vale o banner original. */
  banner?: BannerConfig;
  /** Imagem local (prévia administrativa): substitui a imagem publicada. */
  imageUri?: string | null;
  /** Altura fixa: as camadas do carrossel precisam ter exatamente o mesmo tamanho. */
  height?: number;
};

const heroScale = (width: number) => Math.min(1.5, Math.max(0.86, width / ART_WIDTH));

/** Altura do banner: a mesma para o padrão e para os personalizados, para o carrossel não "pular". */
export const heroHeight = (width: number) =>
  Math.round(Math.max(Math.min(340, Math.max(228, width * 0.66)), 246 * heroScale(width)));

/** Aparência do botão "Explorar experiências": serve ao banner e às prévias da tela administrativa. */
export function HeroButtonFace({ look, scale = 1 }: { look: ButtonStyle; scale?: number }) {
  return (
    <View
      onLayout={measureBannerLayout('button-face', { scale, look: look.label })}
      style={[
        styles.button,
        { backgroundColor: look.background, paddingHorizontal: Math.round(20 * scale) },
        look.border !== null && { borderWidth: 1, borderColor: look.border },
      ]}>
      <Text numberOfLines={1} maxFontSizeMultiplier={1.1} style={[styles.buttonText, { color: look.text }]}>
        EXPLORAR EXPERIÊNCIAS
      </Text>
      <View style={styles.arrow}>
        <BrandIcon name="arrow" size={15} color={look.arrow} />
      </View>
    </View>
  );
}

export function HomeHero({ width, onExplore, banner = DEFAULT_BANNER, imageUri, height: fixedHeight }: Props) {
  const scale = heroScale(width);
  const titleSize = Math.round(30 * scale);
  const look = BUTTON_STYLES[banner.botao];
  const uri = imageUri ?? fileUrl(banner.imagem);
  // Imagem que não carrega (sem rede, arquivo removido): o banner volta à composição original.
  const [failedUri, setFailedUri] = useState<string>();
  const custom = banner.modo === 'personalizado' && uri !== null && failedUri !== uri;
  // Sobre uma fotografia, os textos acompanham o estilo do botão: o branco é para fotos escuras.
  const textColor = banner.botao === 'white' ? Brand.white : Brand.text;

  const height = fixedHeight ?? Math.min(340, Math.max(228, width * 0.66));

  if (custom) {
    return (
      <View onLayout={measureBannerLayout('hero', { mode: 'custom', widthProp: width, fixedHeight, scale, textVisible: banner.titulo.visivel, eyebrowVisible: banner.textoSuperior.visivel })} style={[styles.hero, styles.customHero, { height }]}>
        <Image
          source={{ uri }}
          contentFit="cover"
          contentPosition={{ left: `${banner.enquadramento.x}%`, top: `${banner.enquadramento.y}%` }}
          cachePolicy="memory-disk"
          onError={() => setFailedUri(uri ?? undefined)}
          accessible={false}
          onLayout={measureBannerLayout('background-image', { position: banner.enquadramento })}
          style={StyleSheet.absoluteFill}
        />
        <View onLayout={measureBannerLayout('content', { mode: custom ? 'custom' : 'default' })} style={[styles.content, { paddingLeft: Math.round(20 * scale) }]}>
          {banner.textoSuperior.visivel && (
            <Text
              maxFontSizeMultiplier={1.1}
              style={[styles.eyebrow, { color: textColor, fontSize: 7.8 * scale, letterSpacing: 0.7 * scale }]}>
              {banner.textoSuperior.texto}
            </Text>
          )}
          {banner.titulo.visivel && (
            <Text
              accessibilityRole="header"
              adjustsFontSizeToFit
              numberOfLines={3}
              minimumFontScale={0.8}
              maxFontSizeMultiplier={1.1}
              style={[
                styles.title,
                { color: textColor, width: width * 0.7, fontSize: titleSize, lineHeight: Math.round(titleSize * 1.16) },
              ]}>
              {banner.titulo.texto}
            </Text>
          )}
          <ExploreButton look={look} scale={scale} onPress={onExplore} />
        </View>
      </View>
    );
  }

  return (
    <View onLayout={measureBannerLayout('hero', { mode: 'default', widthProp: width, fixedHeight, scale })} style={[styles.hero, fixedHeight !== undefined ? { height } : { minHeight: height }]}>
      <Svg style={StyleSheet.absoluteFill} preserveAspectRatio="none" viewBox="0 0 100 100">
        <Defs>
          <LinearGradient id="heroBackground" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#F9F4EE" />
            <Stop offset="1" stopColor={Brand.surface} />
          </LinearGradient>
        </Defs>
        <Rect width="100" height="100" fill="url(#heroBackground)" />
      </Svg>
      <HeroArt />
      <View onLayout={measureBannerLayout('content', { mode: custom ? 'custom' : 'default' })} style={[styles.content, { paddingLeft: Math.round(20 * scale) }]}>
        <Text
          maxFontSizeMultiplier={1.1}
          style={[styles.eyebrow, { fontSize: 7.8 * scale, letterSpacing: 0.7 * scale }]}>
          {DEFAULT_BANNER_TEXTS.textoSuperior}
        </Text>
        <Text
          accessibilityRole="header"
          adjustsFontSizeToFit
          numberOfLines={3}
          minimumFontScale={0.8}
          maxFontSizeMultiplier={1.1}
          style={[
            styles.title,
            { width: width * 0.6, fontSize: titleSize, lineHeight: Math.round(titleSize * 1.16) },
          ]}>
          {'Abra espaço\npara a vida\nque você deseja'}
        </Text>
        <ExploreButton look={look} scale={scale} onPress={onExplore} />
      </View>
    </View>
  );
}

/** O botão é sempre um componente interativo próprio, independente da imagem do banner. */
function ExploreButton({ look, scale, onPress }: { look: ButtonStyle; scale: number; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Explorar experiências"
      onPress={onPress}
      android_ripple={{ color: 'rgba(128, 128, 128, 0.25)' }}
      style={({ pressed }) => [styles.buttonWrap, pressed && styles.pressed]}>
      <HeroButtonFace look={look} scale={scale} />
    </Pressable>
  );
}

function HeroArt() {
  return (
    <Svg
      style={StyleSheet.absoluteFill}
      viewBox={`0 0 ${ART_WIDTH} ${ART_HEIGHT}`}
      preserveAspectRatio="xMaxYMid meet"
      accessible
      accessibilityRole="image"
      accessibilityLabel="Joanalia Warren">
      <Defs>
        <ClipPath id="heroPortrait">
          <Path d={PORTRAIT} />
        </ClipPath>
        <LinearGradient id="heroBlob" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#EBE0D2" />
          <Stop offset="1" stopColor="#E2D4C3" />
        </LinearGradient>
        <RadialGradient id="heroFade" cx="296" cy="112" r="98" gradientUnits="userSpaceOnUse">
          <Stop offset="0.62" stopColor={Brand.blob} stopOpacity={0} />
          <Stop offset="1" stopColor={Brand.blob} stopOpacity={0.7} />
        </RadialGradient>
      </Defs>
      <Path d={BLOB} fill="url(#heroBlob)" />
      <Ellipse cx="311" cy="127" rx="77" ry="85" fill={Brand.halo} />
      <Path
        d="M300 10C340 14 368 44 376 88"
        stroke={Brand.primary}
        strokeWidth={0.8}
        strokeOpacity={0.65}
        strokeLinecap="round"
        fill="none"
      />
      <Path
        d="M228 150C240 192 282 220 336 214"
        stroke={Brand.primary}
        strokeWidth={0.7}
        strokeOpacity={0.7}
        strokeLinecap="round"
        fill="none"
      />
      <Path
        d="M380 162C344 198 296 226 214 248"
        stroke={Brand.primary}
        strokeWidth={0.9}
        strokeLinecap="round"
        fill="none"
      />
      <SvgImage
        href={require('@/assets/img1.webp')}
        x={147}
        y={-48}
        width={259.5}
        height={389.25}
        preserveAspectRatio="xMidYMid slice"
        clipPath="url(#heroPortrait)"
      />
      <Path d={PORTRAIT} fill="url(#heroFade)" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  hero: {
    borderRadius: Radius.hero,
    backgroundColor: Brand.surfaceSoft,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  content: { paddingTop: 34, paddingBottom: 24, paddingRight: 16, gap: 12 },
  eyebrow: { fontFamily: Fonts.sansMedium, color: Brand.text, opacity: 0.85 },
  title: { fontFamily: Fonts.serifMedium, color: Brand.text, letterSpacing: -0.3 },
  customHero: { justifyContent: 'flex-end' },
  // O recorte arredondado (e do toque) fica só aqui; a face do botão não recorta o próprio texto.
  buttonWrap: { alignSelf: 'flex-start', marginTop: 4, borderRadius: Radius.pill, overflow: 'hidden' },
  button: {
    minHeight: 44,
    borderRadius: Radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  arrow: { flexShrink: 0 },
  buttonText: {
    flexShrink: 1,
    fontFamily: Fonts.sansMedium,
    fontSize: 12,
    letterSpacing: 0.4,
  },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
});
