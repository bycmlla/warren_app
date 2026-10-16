import { Image } from 'expo-image';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  BackHandler,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { BrandIcon } from '@/components/brand-icon';
import { CourseLessonRow } from '@/components/course-lesson-row';
import { PrimaryButton } from '@/components/primary-button';
import { ScreenHeader } from '@/components/screen-header';
import { fileUrl } from '@/constants/api';
import { Brand, Fonts, Gutter, Radius, Shadow } from '@/constants/brand';
import { useAuth } from '@/context/auth';
import { usePublicQuery } from '@/hooks/use-authorized-query';
import { mixRgb, rgb, useImageTint, type Rgb } from '@/hooks/use-image-tint';
import { openLogin } from '@/hooks/use-protected-navigation';
import { fetchCourse, type Commerce, type CourseDetail, type CourseLesson } from '@/services/catalog-api';
import { ApiError } from '@/services/auth-api';
import {
  formatAccessTerm,
  formatDate,
  formatDuration,
  formatLessons,
  formatModules,
  formatMoney,
} from '@/utils/format';
import { goHome, pushOnce } from '@/utils/navigation';

const DETAIL_WIDTH = 640;
/** Trecho de rolagem, em pontos, em que o cabeçalho passa de transparente para a cor de fundo. */
const HEADER_FADE = 28;
/** Altura, em pontos, em que a imagem surge do fundo escuro, a partir do topo da tela. */
const TOP_FADE = 124;
/** Altura, em pontos, da continuação da imagem abaixo dela, onde acontece a transição para o fundo. */
const BOTTOM_FADE = 96;
/** Brand.background em números, para misturar com as cores lidas da imagem. */
const PEARL: Rgb = [250, 248, 244];

const openLesson = (id: number) => pushOnce({ pathname: '/lesson/[id]', params: { id: String(id) } });

// Detalhes já vistos nesta sessão, por usuário. Ao reabrir um curso a tela aparece na hora com
// eles e é atualizada em seguida: quem decide o acesso continua sendo o backend, a cada consulta.
const seen = new Map<string, CourseDetail>();

// Página de apresentação do curso: pública, com preço e condições dos cursos pagos.
// Iniciar exige login, aceite dos Termos de Uso e direito de acesso; um curso pago sem acesso
// leva à oferta de compra. Quem decide cada uma dessas situações é o backend.
export default function CourseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const courseId = Number(id);
  const { user } = useAuth();
  const key = `${user?.id ?? 'visitante'}:${courseId}`;
  const load = useCallback(
    async (token?: string) => {
      try {
        const detail = await fetchCourse(courseId, token);
        seen.set(key, detail);
        return { detail, key };
      } catch (error) {
        if (error instanceof ApiError && [401, 403, 404].includes(error.status ?? 0)) seen.delete(key);
        throw error;
      }
    },
    [courseId, key]
  );
  const { data: fresh, error, loading, reload } = usePublicQuery(load);
  const data = fresh?.key === key ? fresh.detail : seen.get(key);

  // Dos detalhes de um curso, o Voltar do Android faz o mesmo que a seta: vai direto à Início.
  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        goHome();
        return true;
      });
      return () => subscription.remove();
    }, [])
  );

  if (data === undefined) {
    return (
      <View style={styles.screen}>
        <ScreenHeader onBack={goHome} />
        <View style={styles.missing}>
          {error !== undefined ? (
            <>
              <Text accessibilityLiveRegion="polite" style={styles.text}>
                {error}
              </Text>
              <PrimaryButton variant="outline" label="Tentar novamente" onPress={reload} />
            </>
          ) : (
            loading && <ActivityIndicator color={Brand.primary} size="large" />
          )}
        </View>
      </View>
    );
  }
  return <Course key={key} data={data} />;
}

function Course({ data }: { data: CourseDetail }) {
  const { curso: course, modulos: modules, acesso: access, progresso: progress, termosPendentes: termsPending } = data;
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});
  const [notice, setNotice] = useState<string>();
  const banner = fileUrl(course.imagemBanner) ?? fileUrl(course.imagemCapa);
  // Com as cores das bordas do banner, a imagem ocupa o topo da tela e surge do fundo escuro,
  // inclusive atrás do botão de voltar. Sem imagem, ou se as cores não puderem ser lidas, o
  // cabeçalho fica no fundo claro do aplicativo, acima da imagem.
  const { ready: tintReady, tint } = useImageTint(banner);
  const immersive = banner !== null && tint !== null;
  const [scrollY] = useState(() => new Animated.Value(0));
  const [heroHeight, setHeroHeight] = useState(0);
  const [headerHeight, setHeaderHeight] = useState(0);
  const [pastHero, setPastHero] = useState(false);
  // Quando a imagem sai de trás do cabeçalho, ele ganha a cor de fundo do aplicativo.
  const heroEnd = Math.max(heroHeight - headerHeight, HEADER_FADE);
  const headerColor = scrollY.interpolate({
    inputRange: [heroEnd - HEADER_FADE, heroEnd],
    outputRange: [immersive ? 'rgba(250, 248, 244, 0)' : Brand.background, Brand.background],
    extrapolate: 'clamp',
  });
  const duration = formatDuration(course.duracaoSegundos);
  const commerce = course.comercial;
  const released = access.estado === 'liberado';
  const info = [
    course.instrutora ? { label: 'Instrutora', value: course.instrutora } : null,
    course.categoria ? { label: 'Categoria', value: course.categoria } : null,
    duration ? { label: 'Duração', value: duration } : null,
    {
      label: 'Conteúdo',
      value:
        modules.length > 1
          ? `${formatModules(modules.length)} · ${formatLessons(course.totalAulas)}`
          : formatLessons(course.totalAulas),
    },
    {
      label: 'Acesso',
      value:
        course.tipoAcesso === 'gratuito'
          ? 'Gratuito, com login'
          : course.tipoAcesso === 'pago'
            ? `Pago, ${commerce ? formatAccessTerm(commerce.prazoAcessoMeses) : 'curso completo'}`
            : 'Restrito a alunos autorizados',
    },
    released && access.origem !== null
      ? { label: 'Seu acesso', value: access.expiraEm ? `até ${formatDate(access.expiraEm)}` : 'sem vencimento' }
      : null,
  ].filter((item) => item !== null);

  // Um acesso que já existiu e não vale mais. O progresso do aluno continua guardado.
  const lost =
    access.motivo === 'vencido'
      ? 'Seu prazo de acesso a este curso terminou.'
      : access.motivo === 'revogado'
        ? 'Seu acesso a este curso foi encerrado.'
        : access.motivo === 'agendado'
          ? `Seu acesso a este curso começa em ${formatDate(access.inicioEm)}.`
          : undefined;
  const noAccess =
    lost ??
    (course.tipoAcesso === 'pago'
      ? 'Esta aula está bloqueada porque você ainda não possui acesso a este curso.'
      : 'Este curso é restrito: o acesso é liberado pela administração.');
  const next = modules.flatMap((module) => module.aulas).find((lesson) => lesson.id === progress?.proximaAulaId);

  // Antes de iniciar ou comprar, o aluno lê e aceita os Termos de Uso; a tela de termos
  // segue depois para a aula ou para a oferta.
  const openTerms = (target: { lessonId?: number; offer?: boolean }) => {
    const params: { courseId: string; lessonId?: string; offer?: string } = { courseId: String(course.id) };
    if (target.lessonId !== undefined) params.lessonId = String(target.lessonId);
    if (target.offer) params.offer = '1';
    pushOnce({ pathname: '/terms', params });
  };
  const startLesson = (lessonId: number) => (termsPending ? openTerms({ lessonId }) : openLesson(lessonId));
  const openOffer = () =>
    termsPending
      ? openTerms({ offer: true })
      : pushOnce({ pathname: '/offer/[id]', params: { id: String(course.id) } });

  const pressLesson = (lesson: CourseLesson) => {
    setNotice(undefined);
    if (lesson.bloqueio === 'acesso') return setNotice(noAccess);
    if (lesson.bloqueio === 'sequencia') return setNotice('Conclua as aulas anteriores para liberar esta aula.');
    if (access.estado === 'visitante') return openLogin();
    // Sem acesso ao curso, só as aulas demonstrativas abrem.
    if (!released) return lesson.demonstrativa ? startLesson(lesson.id) : setNotice(noAccess);
    if (lesson.estado === 'bloqueada') return setNotice('Conclua as aulas anteriores para liberar esta aula.');
    return startLesson(lesson.id);
  };

  const termsHint = 'Antes de continuar, leia e aceite os Termos de Uso.';
  const notForSale = 'Este curso ainda não está disponível para compra.';
  // Botão principal, conforme a situação informada pelo backend: entrar, comprar, acompanhar
  // o pagamento, ou iniciar/continuar o curso.
  const main: { label: string; hint?: string; onPress?: () => void } =
    access.estado === 'visitante'
      ? { label: 'Iniciar curso', hint: 'Entre ou crie sua conta para iniciar.', onPress: () => openLogin() }
      : access.estado === 'pendente'
        ? {
            label: 'Acompanhar pagamento',
            hint: 'Sua compra aguarda a confirmação do pagamento. O curso é liberado assim que ele for aprovado.',
            onPress: () =>
              access.pedidoId !== null &&
              pushOnce({ pathname: '/order/[id]', params: { id: String(access.pedidoId) } }),
          }
        : access.estado === 'comprar'
          ? {
              // Curso pago sem acesso: "Iniciar curso" abre a oferta, nunca as aulas.
              label: 'Iniciar curso',
              hint: termsPending
                ? termsHint
                : commerce === null
                  ? notForSale
                  : lost
                    ? `${lost} Compre novamente para continuar de onde parou.`
                    : 'Veja as condições e as formas de pagamento.',
              onPress: () => (commerce === null && !termsPending ? setNotice(notForSale) : openOffer()),
            }
          : access.estado === 'restrito'
            ? {
                // Curso restrito sem autorização: aceita os termos, se faltar, e vê o aviso. Sem checkout.
                label: 'Iniciar curso',
                hint: termsPending ? termsHint : noAccess,
                onPress: () => (termsPending ? openTerms({}) : setNotice(noAccess)),
              }
            : course.totalAulas === 0
              ? { label: 'Iniciar curso', hint: 'Este curso ainda não tem aulas.' }
              : progress?.concluido
                ? { label: 'Curso concluído', hint: 'Você pode rever as aulas quando quiser.' }
                : {
                    label: progress && progress.concluidas > 0 ? 'Continuar curso' : 'Iniciar curso',
                    hint: termsPending ? termsHint : next ? `Próxima aula: ${next.titulo}` : undefined,
                    onPress: () => progress?.proximaAulaId != null && startLesson(progress.proximaAulaId),
                  };

  // As cores são lidas uma vez por imagem (normalmente já na Home); se ainda não estiverem
  // prontas, a tela espera um instante, para não abrir de um jeito e mudar em seguida.
  if (!tintReady) {
    return (
      <View style={styles.screen}>
        <ScreenHeader onBack={goHome} />
        <View style={styles.missing}>
          <ActivityIndicator color={Brand.primary} size="large" />
        </View>
      </View>
    );
  }

  const header = (
    <Animated.View
      onLayout={(event) => setHeaderHeight(event.nativeEvent.layout.height)}
      style={[immersive && styles.floatingHeader, { backgroundColor: headerColor }]}>
      <ScreenHeader transparent onBack={goHome} />
    </Animated.View>
  );

  return (
    <View style={styles.screen}>
      {/* Sobre o topo escuro da imagem, os ícones da barra de status ficam claros; ao rolar, voltam. */}
      <StatusBar style={immersive && tint.dark && !pastHero ? 'light' : 'dark'} />
      {!immersive && header}
      <Animated.ScrollView
        contentContainerStyle={styles.scrollContent}
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
          useNativeDriver: false,
          listener: (event: { nativeEvent: { contentOffset: { y: number } } }) => {
            const past = event.nativeEvent.contentOffset.y > heroEnd - 40;
            setPastHero((current) => (current === past ? current : past));
          },
        })}>
        {banner !== null && (
          <View onLayout={(event) => setHeroHeight(event.nativeEvent.layout.height)}>
            {immersive ? (
              <>
                {/* Mantém a cor do topo quando a lista é puxada além do início. */}
                <View style={[styles.overscroll, { backgroundColor: rgb(tint.top) }]} />
                {/* Em cima, a imagem começa invisível, na cor dos seus próprios cantos, e vai
                    aparecendo: não há linha marcando onde ela começa. */}
                <View style={{ backgroundColor: rgb(tint.top) }}>
                  <Image source={{ uri: banner }} contentFit="cover" accessibilityLabel={course.titulo} style={styles.banner} />
                  <Fade
                    id="hero-top"
                    style={styles.fadeTop}
                    stops={[
                      [0, rgb(tint.top), 1],
                      [0.28, rgb(tint.top), 0.92],
                      [0.62, rgb(tint.top), 0.45],
                      [1, rgb(tint.top), 0],
                    ]}
                  />
                </View>
                {/* Embaixo, a imagem fica intacta. Sua última faixa continua abaixo dela, espelhada,
                    e é essa continuação que clareia, passando pelo tom da arte, até o fundo da página. */}
                <View style={[styles.extension, { backgroundColor: rgb(tint.bottom) }]}>
                  <Image source={{ uri: tint.bottomUri }} contentFit="fill" blurRadius={3} accessible={false} style={styles.reflection} />
                  <Fade
                    id="hero-bottom"
                    style={styles.overlay}
                    stops={[
                      [0, rgb(tint.bottom), 0],
                      [0.36, rgb(tint.average), 0.5],
                      [0.7, rgb(mixRgb(tint.average, PEARL, 0.72)), 0.9],
                      [1, rgb(PEARL), 1],
                    ]}
                  />
                </View>
              </>
            ) : (
              <Image source={{ uri: banner }} contentFit="cover" accessibilityLabel={course.titulo} style={styles.banner} />
            )}
          </View>
        )}
        <View style={[styles.content, banner !== null && styles.contentAfterHero]}>
          {banner === null && (
            <View style={[styles.cover, styles.noCover]}>
              <BrandIcon name="library" size={36} strokeWidth={1.2} color={Brand.muted} />
            </View>
          )}

          <View style={styles.block}>
            {course.categoria !== null && <Text style={styles.tag}>{course.categoria}</Text>}
            <Text accessibilityRole="header" style={styles.title}>
              {course.titulo}
            </Text>
            {course.subtitulo !== null && <Text style={styles.text}>{course.subtitulo}</Text>}
          </View>

          {progress !== null && progress.total > 0 && (
            <View style={styles.progress}>
              <View style={styles.progressTop}>
                <Text style={styles.progressLabel}>
                  {progress.concluidas} de {formatLessons(progress.total)} concluídas
                </Text>
                <Text style={styles.progressValue}>{progress.percentual}%</Text>
              </View>
              <View
                accessibilityRole="progressbar"
                accessibilityValue={{ min: 0, max: 100, now: progress.percentual }}
                style={styles.track}>
                <View style={[styles.fill, { width: `${progress.percentual}%` }]} />
              </View>
            </View>
          )}

          <View style={styles.infoCard}>
            {info.map((item, index) => (
              <View key={item.label} style={[styles.infoRow, index > 0 && styles.infoDivider]}>
                <Text style={styles.infoLabel}>{item.label}</Text>
                <Text style={styles.infoValue}>{item.value}</Text>
              </View>
            ))}
          </View>

          {released && access.pertoDeVencer && access.expiraEm !== null && (
            <Text accessibilityRole="alert" style={styles.notice}>
              {access.diasRestantes === 0
                ? 'Seu acesso a este curso termina hoje.'
                : `Seu acesso a este curso termina em ${access.diasRestantes} ${access.diasRestantes === 1 ? 'dia' : 'dias'}, em ${formatDate(access.expiraEm)}.`}
            </Text>
          )}

          {commerce !== null && !released && <Investment commerce={commerce} />}

          {course.descricao !== null && (
            <View style={styles.block}>
              <Text accessibilityRole="header" style={styles.heading}>
                Sobre
              </Text>
              <Text style={styles.text}>{course.descricao}</Text>
            </View>
          )}

          <View style={styles.block}>
            <Text accessibilityRole="header" style={styles.heading}>
              Conteúdo do curso
            </Text>
            {course.sequencial && course.totalAulas > 1 && (
              <Text style={styles.text}>Cada aula é liberada ao concluir a anterior.</Text>
            )}
            {course.totalAulas === 0 && <Text style={styles.text}>As aulas deste curso serão adicionadas em breve.</Text>}

            {modules.map((module) => {
              // Um curso simples (um único módulo) mostra só a lista de aulas.
              const single = modules.length === 1;
              const open = single || !collapsed[module.id];
              const done = module.aulas.filter((lesson) => lesson.estado === 'concluida').length;
              return (
                <View key={module.id} style={styles.module}>
                  {!single && (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ expanded: open }}
                      accessibilityLabel={`${module.titulo}, ${formatLessons(module.aulas.length)}`}
                      onPress={() => setCollapsed((current) => ({ ...current, [module.id]: open }))}
                      style={({ pressed }) => [styles.moduleHeader, pressed && styles.pressed]}>
                      <View style={styles.moduleText}>
                        <Text style={styles.moduleTitle}>{module.titulo}</Text>
                        <Text style={styles.lessonMeta}>
                          {formatLessons(module.aulas.length)}
                          {released && module.aulas.length > 0
                            ? ` · ${done} ${done === 1 ? 'concluída' : 'concluídas'}`
                            : ''}
                        </Text>
                      </View>
                      <BrandIcon name={open ? 'up' : 'down'} size={18} color={Brand.muted} />
                    </Pressable>
                  )}
                  {open && !single && module.descricao !== null && (
                    <Text style={[styles.lessonMeta, styles.moduleDescription]}>{module.descricao}</Text>
                  )}
                  {open &&
                    module.aulas.map((lesson, index) => (
                      <CourseLessonRow
                        key={lesson.id}
                        lesson={lesson}
                        divided={!single || index > 0}
                        onPress={() => pressLesson(lesson)}
                      />
                    ))}
                </View>
              );
            })}
          </View>
        </View>
      </Animated.ScrollView>
      {immersive && header}

      <SafeAreaView edges={['bottom', 'left', 'right']} style={styles.footer}>
        <View style={styles.footerContent}>
          {notice !== undefined && (
            <Text accessibilityLiveRegion="polite" style={styles.notice}>
              {notice}
            </Text>
          )}
          <PrimaryButton label={main.label} onPress={main.onPress ?? (() => undefined)} disabled={!main.onPress} />
          {main.hint !== undefined && (
            <Text numberOfLines={2} style={styles.hint}>
              {main.hint}
            </Text>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}

/**
 * Degradê de uma única cor, de cima para baixo, com a opacidade indicada em cada ponto:
 * [posição de 0 a 1, cor, opacidade]. Usado para desfazer as bordas do banner sem véu branco.
 */
function Fade({
  id,
  stops,
  style,
}: {
  id: string;
  stops: [number, string, number][];
  style: StyleProp<ViewStyle>;
}) {
  return (
    <View pointerEvents="none" style={style}>
      <Svg width="100%" height="100%" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            {stops.map(([offset, color, opacity]) => (
              <Stop key={offset} offset={offset} stopColor={color} stopOpacity={opacity} />
            ))}
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}

/** Preço e condições de um curso pago, para consulta antes de iniciar a compra. */
function Investment({ commerce }: { commerce: Commerce }) {
  const { pix, cartao: card } = commerce;
  const rows = [
    { label: 'À vista', value: formatMoney(commerce.precoCentavos) },
    pix
      ? {
          label: 'Pix',
          value: formatMoney(pix.totalCentavos),
          detail:
            pix.descontoCentavos > 0
              ? `${String(pix.descontoPercentual).replace('.', ',')}% de desconto · economia de ${formatMoney(pix.descontoCentavos)}`
              : undefined,
        }
      : null,
    card
      ? {
          label: 'Cartão de crédito',
          value: card.maxParcelas > 1 ? `em até ${card.maxParcelas}x` : 'à vista',
          detail: card.maxParcelas > 1 ? 'O valor de cada parcela aparece na etapa de pagamento.' : undefined,
        }
      : null,
    {
      label: 'Prazo de acesso',
      value: formatAccessTerm(commerce.prazoAcessoMeses),
      detail: commerce.prazoAcessoMeses !== null ? 'Contado a partir da aprovação do pagamento.' : undefined,
    },
  ].filter((row) => row !== null);

  return (
    <View style={styles.block}>
      <Text accessibilityRole="header" style={styles.heading}>
        Investimento
      </Text>
      <View style={styles.infoCard}>
        {rows.map((row, index) => (
          <View key={row.label} style={[styles.priceRow, index > 0 && styles.infoDivider]}>
            <View style={styles.infoRowTop}>
              <Text style={styles.infoLabel}>{row.label}</Text>
              <Text style={[styles.infoValue, index === 0 && styles.price]}>{row.value}</Text>
            </View>
            {row.detail !== undefined && <Text style={styles.priceDetail}>{row.detail}</Text>}
          </View>
        ))}
      </View>
      <Text style={styles.lessonMeta}>
        O valor dá acesso ao curso completo, com todos os módulos e aulas. A compra só começa depois do
        aceite dos Termos de Uso, que trazem as regras de cancelamento e reembolso.
      </Text>
      <Pressable
        accessibilityRole="link"
        hitSlop={6}
        onPress={() => pushOnce('/terms')}
        style={({ pressed }) => pressed && styles.pressed}>
        <Text style={styles.link}>Ler os Termos de Uso</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Brand.background },
  scrollContent: { paddingBottom: 24 },
  content: {
    width: '100%',
    maxWidth: DETAIL_WIDTH,
    alignSelf: 'center',
    paddingHorizontal: Gutter,
    gap: 22,
  },
  missing: { flex: 1, justifyContent: 'center', padding: 28, gap: 14 },
  // Em telas largas a imagem é cortada na altura, em vez de ocupar a tela inteira.
  banner: { width: '100%', aspectRatio: 16 / 10, maxHeight: 440, backgroundColor: Brand.surface },
  floatingHeader: { position: 'absolute', top: 0, left: 0, right: 0 },
  overscroll: { position: 'absolute', left: 0, right: 0, top: -600, height: 600 },
  overlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  // Um ponto além da borda, para não sobrar um fio da imagem por arredondamento de pixels.
  fadeTop: { position: 'absolute', left: 0, right: 0, top: -1, height: TOP_FADE },
  extension: { height: BOTTOM_FADE, marginTop: -1, overflow: 'hidden' },
  // Espelhada, a faixa começa exatamente na última linha da imagem: a emenda não aparece.
  reflection: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, transform: [{ scaleY: -1 }] },
  contentAfterHero: { marginTop: 2 },
  cover: { width: '100%', aspectRatio: 16 / 10, borderRadius: Radius.hero, backgroundColor: Brand.surface },
  noCover: { alignItems: 'center', justifyContent: 'center', backgroundColor: Brand.surfaceSoft },
  block: { gap: 8 },
  tag: {
    fontFamily: Fonts.sansMedium,
    fontSize: 11,
    letterSpacing: 0.9,
    color: Brand.primaryDeep,
    textTransform: 'uppercase',
  },
  title: { fontFamily: Fonts.serifMedium, fontSize: 28, lineHeight: 34, color: Brand.text },
  heading: { fontFamily: Fonts.serifMedium, fontSize: 20, lineHeight: 26, color: Brand.text },
  text: { fontFamily: Fonts.sans, fontSize: 14.5, lineHeight: 22, color: Brand.muted },
  progress: { gap: 8 },
  progressTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 },
  progressLabel: { flex: 1, fontFamily: Fonts.sansMedium, fontSize: 13, color: Brand.text },
  progressValue: { fontFamily: Fonts.sansSemiBold, fontSize: 13, color: Brand.primaryDeep },
  track: { height: 6, borderRadius: 3, backgroundColor: Brand.surface, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3, backgroundColor: Brand.primary },
  infoCard: { borderRadius: Radius.field, backgroundColor: Brand.surfaceSoft, paddingHorizontal: 16 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 16, paddingVertical: 12 },
  infoDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Brand.primarySoft },
  infoLabel: { fontFamily: Fonts.sans, fontSize: 13, color: Brand.muted },
  infoValue: { flex: 1, fontFamily: Fonts.sansMedium, fontSize: 13, color: Brand.text, textAlign: 'right' },
  priceRow: { paddingVertical: 12, gap: 3 },
  infoRowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 16 },
  price: { fontFamily: Fonts.serifMedium, fontVariant: ['lining-nums'], fontSize: 20, lineHeight: 26 },
  priceDetail: { fontFamily: Fonts.sans, fontSize: 12, lineHeight: 17, color: Brand.muted },
  link: { fontFamily: Fonts.sansMedium, fontSize: 13, color: Brand.primaryDeep, textDecorationLine: 'underline' },
  module: {
    marginTop: 4,
    borderRadius: Radius.card,
    backgroundColor: Brand.card,
    boxShadow: Shadow.field,
    overflow: 'hidden',
  },
  moduleHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, padding: 14 },
  moduleText: { flex: 1, gap: 2 },
  moduleTitle: { fontFamily: Fonts.serif, fontSize: 17, lineHeight: 22, color: Brand.text },
  moduleDescription: { paddingHorizontal: 14, paddingBottom: 12 },
  lessonMeta: { fontFamily: Fonts.sans, fontSize: 12, lineHeight: 17, color: Brand.muted },
  footer: {
    backgroundColor: Brand.card,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Brand.hairline,
  },
  footerContent: {
    width: '100%',
    maxWidth: DETAIL_WIDTH,
    alignSelf: 'center',
    paddingHorizontal: Gutter,
    paddingTop: 12,
    paddingBottom: 10,
    gap: 8,
  },
  notice: {
    fontFamily: Fonts.sans,
    fontSize: 13,
    lineHeight: 19,
    color: Brand.text,
    backgroundColor: Brand.surfaceSoft,
    borderRadius: Radius.tile,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  hint: { fontFamily: Fonts.sans, fontSize: 12, lineHeight: 17, color: Brand.muted, textAlign: 'center' },
  pressed: { opacity: 0.75 },
});
