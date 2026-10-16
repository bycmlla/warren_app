import Svg, { Circle, Path } from 'react-native-svg';

import { Brand } from '@/constants/brand';

export type IconName =
  | 'home'
  | 'search'
  | 'download'
  | 'community'
  | 'profile'
  | 'identity'
  | 'arrow'
  | 'back'
  | 'lock'
  | 'eye'
  | 'eye-off'
  | 'play'
  | 'music'
  | 'document'
  | 'dashboard'
  | 'plus'
  | 'library'
  | 'phone'
  | 'star'
  | 'check'
  | 'chevron'
  | 'lotus'
  | 'heart'
  | 'sun'
  | 'moon'
  | 'leaf'
  | 'sparkle'
  | 'edit'
  | 'trash'
  | 'up'
  | 'down'
  | 'video'
  | 'headphones'
  | 'pause'
  | 'tag'
  | 'close'
  | 'card'
  | 'pix'
  | 'clock'
  | 'receipt'
  | 'camera'
  | 'compass';

// Ícones de traço simples (um único caminho, sem preenchimento).
const PATHS: Partial<Record<IconName, string>> = {
  lotus:
    'M12 4c2.2 2.4 3.3 5 3.3 7.6 0 2.6-1.1 5-3.3 6.9-2.2-1.9-3.3-4.3-3.3-6.9C8.7 9 9.8 6.4 12 4ZM9.2 8.3C7.6 7.6 6 7.3 4.5 7.5c-.3 3 .5 5.6 2.2 7.6 1.4 1.7 3.2 2.8 5.3 3.4M14.8 8.3c1.6-.7 3.2-1 4.7-.8.3 3-.5 5.6-2.2 7.6-1.4 1.7-3.2 2.8-5.3 3.4M4.9 12.2c-1.2.2-2.3.6-3.4 1.3 1.3 2.6 3.3 4.2 6 4.8 1.5.3 3 .4 4.5.2M19.1 12.2c1.2.2 2.3.6 3.4 1.3-1.3 2.6-3.3 4.2-6 4.8-1.5.3-3 .4-4.5.2',
  heart:
    'M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41',
  moon: 'M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z',
  leaf: 'M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10ZM2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12',
  sparkle: 'M11 3l1.9 5.1L18 10l-5.1 1.9L11 17l-1.9-5.1L4 10l5.1-1.9L11 3ZM19 15v4M17 17h4',
  edit: 'M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5Z',
  trash: 'M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6',
  up: 'm18 15-6-6-6 6',
  down: 'm6 9 6 6 6-6',
  video: 'M4 6h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2ZM16 10.5l6-3.5v10l-6-3.5',
  headphones:
    'M3 14v-2a9 9 0 0 1 18 0v2M3 14h3a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2v-4ZM21 14h-3a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h1a2 2 0 0 0 2-2v-4Z',
  pause: 'M8 5v14M16 5v14',
  tag: 'M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8ZM7.5 7.5h.01',
  close: 'M18 6 6 18M6 6l12 12',
  card: 'M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2ZM2 10h20M6 15h4',
  pix: 'M12 3l4.5 4.5L12 12 7.5 7.5 12 3ZM12 12l4.5 4.5L12 21l-4.5-4.5L12 12ZM7.5 7.5 3 12l4.5 4.5M16.5 7.5 21 12l-4.5 4.5',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 7v5l3 2',
  compass:
    'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20ZM16.24 7.76l-2.12 6.36-6.36 2.12 2.12-6.36 6.36-2.12Z',
  camera:
    'M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3ZM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
  receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2V3ZM9 8h6M9 12h6',
};

type Props = {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
  filled?: boolean;
};

export function BrandIcon({
  name,
  size = 24,
  color = Brand.primaryDeep,
  strokeWidth = 1.5,
  filled = false,
}: Props) {
  const fill = filled ? color : 'none';
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      accessible={false}>
      {name === 'home' && (
        <>
          <Path
            d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"
            fill={fill}
          />
          {filled ? (
            <Path
              key="door-filled"
              d="M14.5 21v-6.5a1 1 0 0 0-1-1h-3a1 1 0 0 0-1 1V21z"
              fill={Brand.card}
              stroke={Brand.card}
            />
          ) : (
            <Path key="door" d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" fill="none" />
          )}
        </>
      )}
      {name === 'search' && (
        <>
          <Circle cx="11" cy="11" r="7.5" />
          <Path d="m20.5 20.5-4.2-4.2" />
        </>
      )}
      {name === 'profile' && (
        <>
          <Circle cx="12" cy="12" r="10" />
          <Circle cx="12" cy="10" r="3" />
          <Path d="M7 20.662V19a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.662" />
        </>
      )}
      {name === 'identity' && (
        <>
          <Circle cx="12" cy="7.5" r="4" />
          <Path d="M4.5 21v-1.5a5.5 5.5 0 0 1 5.5-5.5h4a5.5 5.5 0 0 1 5.5 5.5V21Z" />
        </>
      )}
      {name === 'arrow' && <Path d="M4 12h16m-6-6 6 6-6 6" />}
      {name === 'back' && <Path d="m15 18-6-6 6-6" />}
      {name === 'download' && (
        <Path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
      )}
      {name === 'community' && (
        <>
          <Circle cx="9" cy="7" r="4" />
          <Path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
        </>
      )}
      {name === 'lock' && (
        <Path d="M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2ZM7 11V7a5 5 0 0 1 10 0v4" />
      )}
      {(name === 'eye' || name === 'eye-off') && (
        <>
          <Path d="M1.5 12s3.8-7 10.5-7 10.5 7 10.5 7-3.8 7-10.5 7S1.5 12 1.5 12Z" />
          <Circle cx="12" cy="12" r="3" />
          {name === 'eye-off' && <Path d="M4 3l16 18" />}
        </>
      )}
      {name === 'play' && <Path d="M7 4.5v15l12-7.5-12-7.5Z" fill={fill} />}
      {name === 'music' && (
        <>
          <Path d="M9 18V5l12-2v13" />
          <Circle cx="6" cy="18" r="3" />
          <Circle cx="18" cy="16" r="3" />
        </>
      )}
      {PATHS[name] !== undefined && <Path d={PATHS[name]} />}
      {name === 'dashboard' && (
        <Path d="M4 3h5a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1ZM15 3h5a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1ZM15 12h5a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1ZM4 16h5a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1Z" />
      )}
      {name === 'plus' && <Path d="M12 5v14M5 12h14" />}
      {name === 'library' && <Path d="m16 6 4 14M12 6v14M8 8v12M4 4v16" />}
      {name === 'phone' && (
        <Path d="M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2ZM11 18h2" />
      )}
      {name === 'star' && (
        <Path
          d="m12 2.5 2.9 5.9 6.6 1-4.8 4.6 1.1 6.5-5.8-3.1-5.8 3.1 1.1-6.5-4.8-4.6 6.6-1L12 2.5Z"
          fill={fill}
        />
      )}
      {name === 'check' && <Path d="M20 6 9 17l-5-5" />}
      {name === 'chevron' && <Path d="m9 18 6-6-6-6" />}
      {name === 'document' && (
        <Path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7l-5-5ZM14 2v5h5M9 13h6M9 17h6" />
      )}
    </Svg>
  );
}

export function BrandMark({ size = 30, color = Brand.text }: { size?: number; color?: string }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.1}
      strokeLinejoin="round"
      accessible={false}>
      <Path d="M12 1.5 22.5 12 12 22.5 1.5 12Z" />
    </Svg>
  );
}
