export const Brand = {
  background: '#FAF8F4',
  card: '#FFFEFB',
  surface: '#F1E8DD',
  surfaceSoft: '#F6EFE7',
  primary: '#B69A61',
  // Champanhe mais profundo para textos e traços finos sobre fundo claro.
  primaryDeep: '#9C7E45',
  primarySoft: 'rgba(182, 154, 97, 0.45)',
  text: '#484B3C',
  muted: '#8F887D',
  white: '#FFFFFF',
  blob: '#E6D9CA',
  halo: '#FBF7F2',
  hairline: 'rgba(72, 75, 60, 0.08)',
  danger: '#9A4B3C',
  dangerSoft: '#F7E9E3',
  warning: '#B18A20',
} as const;

export const Fonts = {
  serif: 'PlayfairDisplay_400Regular',
  serifMedium: 'PlayfairDisplay_500Medium',
  sans: 'Inter_400Regular',
  sansMedium: 'Inter_500Medium',
  sansSemiBold: 'Inter_600SemiBold',
} as const;

export const Serif = Fonts.serif;
export const Shadow = {
  card: '0 6px 18px rgba(72, 75, 60, 0.07)',
  field: '0 2px 10px rgba(72, 75, 60, 0.05)',
} as const;
export const Radius = { hero: 24, cardLarge: 20, card: 18, field: 16, tile: 14, pill: 999 } as const;
export const Gutter = 20;
export const ContentWidth = 900;
