import { Image } from 'expo-image';
import { useIsFocused } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, AppState, PanResponder, StyleSheet, View } from 'react-native';

import { HomeHero, heroHeight } from '@/components/home-hero';
import { fileUrl } from '@/constants/api';
import { DEFAULT_SLIDE, type Slide } from '@/constants/banner';
import { Brand } from '@/constants/brand';
import { useStableEvent } from '@/hooks/use-stable-event';

/** Tempo de cada banner na tela e duração da troca (fusão entre dois banners). */
const INTERVAL = 5000;
const FADE = 500;
/** Deslocamento (ou velocidade) mínimo para o gesto contar como "passar o banner". */
const SWIPE_DISTANCE = 40;
const SWIPE_VELOCITY = 0.4;

type Props = {
  width: number;
  slides?: Slide[];
  onExplore: () => void;
};

/** Gesto horizontal do carrossel: esquerda = próximo, direita = anterior. */
function createSwipe(onSwipe: (direction: 1 | -1) => void) {
  return PanResponder.create({
    onMoveShouldSetPanResponderCapture: (_event, { dx, dy }) => Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.5,
    // Enquanto o gesto é horizontal, a rolagem vertical da Home não deve disputá-lo.
    onPanResponderTerminationRequest: () => false,
    onPanResponderRelease: (_event, { dx, vx }) => {
      if (dx < -SWIPE_DISTANCE || vx < -SWIPE_VELOCITY) onSwipe(1);
      else if (dx > SWIPE_DISTANCE || vx > SWIPE_VELOCITY) onSwipe(-1);
    },
  });
}

/**
 * Carrossel da Home. Mostra o primeiro banner na hora e troca por fusão: só duas camadas existem ao
 * mesmo tempo (a atual e a que está entrando), então nada é recriado a cada troca. Com um único banner
 * não há animação, indicadores nem temporizador. Pausa fora da Home, com o app em segundo plano e
 * quando o aparelho pede "reduzir movimento" (aí a troca é só manual, sem animar).
 */
export function HeroCarousel({ width, slides, onExplore }: Props) {
  const list = slides !== undefined && slides.length > 0 ? slides : [DEFAULT_SLIDE];
  const count = list.length;
  const height = heroHeight(width);

  const [position, setPosition] = useState(0);
  const [incoming, setIncoming] = useState<number | null>(null);
  // Se a lista encolher (um banner foi removido), a posição é ajustada sem esperar outro efeito.
  const current = Math.min(position, count - 1);
  const [bump, setBump] = useState(0);

  const focused = useIsFocused();
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setForeground(state === 'active'));
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => alive && setReduceMotion(enabled));
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      alive = false;
      subscription.remove();
    };
  }, []);

  // Baixa as imagens dos outros banners com antecedência: a troca nunca espera a rede.
  const imageKey = list.map((slide) => slide.imagem ?? '').join('|');
  useEffect(() => {
    const uris = imageKey.split('|').flatMap((path) => fileUrl(path || null) ?? []);
    if (uris.length > 1) Image.prefetch(uris, 'memory-disk').catch(() => undefined);
  }, [imageKey]);

  const transitioning = incoming !== null;
  const go = (target: number) => {
    if (transitioning || count < 2 || target === current) return;
    if (reduceMotion) {
      setPosition(target);
      return;
    }
    setIncoming(target);
  };
  // A camada que entra avisa quando termina a fusão: ela passa a ser a atual e a anterior sai.
  const finish = useStableEvent(() => {
    if (incoming === null) return;
    setPosition(incoming);
    setIncoming(null);
  });
  // O temporizador e o gesto chamam sempre a versão mais recente, sem recriar o PanResponder.
  const advance = useStableEvent((target: number) => go(target));
  const onSwipe = useStableEvent((direction: 1 | -1) => {
    setBump((value) => value + 1);
    go((current + direction + count) % count);
  });
  const [swipe] = useState(() => createSwipe(onSwipe));

  const running = count > 1 && focused && foreground && !reduceMotion;
  useEffect(() => {
    if (!running || transitioning) return;
    // `bump` reinicia a contagem de 5 s depois de uma interação manual.
    const timer = setTimeout(() => advance((current + 1) % count), INTERVAL);
    return () => clearTimeout(timer);
  }, [running, transitioning, current, count, bump, advance]);

  const layers = incoming === null ? [current] : [current, incoming];

  return (
    <View>
      <View style={{ height }} {...(count > 1 ? swipe.panHandlers : {})}>
        {layers.map((index) => {
          const entering = index === incoming;
          return (
            <FadeLayer
              key={`${list[index].id ?? 'padrao'}-${index}`}
              entering={entering}
              onDone={finish}
              interactive={entering || incoming === null}>
              <HomeHero width={width} height={height} banner={list[index]} onExplore={onExplore} />
            </FadeLayer>
          );
        })}
      </View>
      {count > 1 && (
        <View
          accessible
          accessibilityLabel={`Banner ${current + 1} de ${count}`}
          style={styles.dots}>
          {list.map((slide, index) => (
            <View
              key={`${slide.id ?? 'padrao'}-${index}`}
              style={[styles.dot, index === (incoming ?? current) && styles.dotActive]}
            />
          ))}
        </View>
      )}
    </View>
  );
}

/**
 * Uma camada do carrossel, com a própria opacidade: a que entra sobe de 0 a 1 e avisa ao terminar; a que
 * já estava na tela fica em 1. Cada camada tem o seu valor animado, então nada precisa ser zerado depois.
 */
function FadeLayer({
  entering,
  onDone,
  interactive,
  children,
}: {
  entering: boolean;
  onDone: () => void;
  interactive: boolean;
  children: ReactNode;
}) {
  const [opacity] = useState(() => new Animated.Value(entering ? 0 : 1));
  useEffect(() => {
    if (!entering) return;
    const animation = Animated.timing(opacity, { toValue: 1, duration: FADE, useNativeDriver: true });
    animation.start(({ finished }) => {
      if (finished) onDone();
    });
    return () => animation.stop();
  }, [entering, opacity, onDone]);
  return (
    <Animated.View style={[StyleSheet.absoluteFill, { opacity }]} pointerEvents={interactive ? 'auto' : 'none'}>
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  dots: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, paddingTop: 10, height: 20 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Brand.primarySoft },
  dotActive: { width: 18, backgroundColor: Brand.primary },
});
