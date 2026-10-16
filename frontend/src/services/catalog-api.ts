import type { IconName } from '@/components/brand-icon';
import type { Slide } from '@/constants/banner';
import type { SectionId } from '@/constants/sections';
import type { LessonType } from '@/services/admin-api';
import { request } from '@/services/auth-api';

// Conteúdos publicados: catálogo público, detalhes do curso e aulas do aluno.

export type Category = { id: number; nome: string; descricao: string | null; icone: IconName | null };

export type AccessType = 'gratuito' | 'pago' | 'restrito';

/** Condições comerciais de um curso pago, definidas pela administradora. Valores em centavos. */
export type Commerce = {
  precoCentavos: number;
  /** null = sem vencimento definido. */
  prazoAcessoMeses: number | null;
  pix: { descontoPercentual: number; descontoCentavos: number; totalCentavos: number } | null;
  cartao: { maxParcelas: number; parcelasSemJuros: number } | null;
};

/**
 * Situação do usuário diante do curso, decidida pelo backend:
 * visitante (sem sessão), liberado, comprar (curso pago sem acesso), pendente (compra aguardando
 * pagamento) ou restrito (só a administração libera).
 */
export type Access = {
  estado: 'visitante' | 'liberado' | 'comprar' | 'pendente' | 'restrito';
  /** Por que um acesso anterior não vale mais. */
  motivo: 'vencido' | 'revogado' | 'agendado' | null;
  origem: 'manual' | 'compra' | null;
  inicioEm: string | null;
  expiraEm: string | null;
  diasRestantes: number | null;
  pertoDeVencer: boolean;
  pedidoId: number | null;
};

export type CourseSummary = {
  id: number;
  titulo: string;
  subtitulo: string | null;
  imagemCapa: string | null;
  /** Imagem do topo da página do curso; sem ela, a capa é usada. */
  imagemBanner: string | null;
  categoriaId: number | null;
  categoria: string | null;
  secao: SectionId | null;
  destaque: boolean;
  tipoAcesso: AccessType;
  gratuito: boolean;
  /** Preço e condições; null se o curso não é pago. */
  comercial: Commerce | null;
  totalAulas: number;
  duracaoMinutos: number;
};

export type HomeData = {
  /** Banners do carrossel da Home, na ordem de exibição (nunca vazio). */
  carrossel: Slide[];
  categorias: Category[];
  secoes: { id: SectionId; cursos: CourseSummary[] }[];
};

export type LessonState = 'disponivel' | 'bloqueada' | 'concluida';

export type CourseLesson = {
  id: number;
  titulo: string;
  tipo: LessonType;
  duracaoSegundos: number | null;
  /** Aula de demonstração: abre para qualquer aluno com conta, mesmo sem acesso ao curso. */
  demonstrativa: boolean;
  /** null para visitantes e, em aulas não concluídas, para quem não tem acesso ao curso. */
  estado: LessonState | null;
  bloqueio: 'acesso' | 'sequencia' | 'login' | null;
  totalVideos: number;
  thumbnail: string | null;
};

export type CourseDetail = {
  curso: CourseSummary & {
    descricao: string | null;
    instrutora: string | null;
    sequencial: boolean;
    duracaoSegundos: number | null;
    totalModulos: number;
  };
  modulos: { id: number; titulo: string; descricao: string | null; aulas: CourseLesson[] }[];
  acesso: Access;
  /** O usuário ainda precisa aceitar os Termos de Uso vigentes antes de iniciar ou comprar. */
  termosPendentes: boolean;
  progresso: {
    concluidas: number;
    total: number;
    percentual: number;
    proximaAulaId: number | null;
    concluido: boolean;
  } | null;
};

export type NextLesson = { id: number; titulo: string; estado: LessonState } | null;

/** Um vídeo de uma aula, com o progresso do próprio usuário. */
export type LessonVideo = {
  id: number;
  versaoMidia: string;
  titulo: string | null;
  duracaoSegundos: number | null;
  /** Caminho do vídeo na API; exige o token no cabeçalho. */
  midia: string;
  /** Endereço assinado, restrito a esta mídia, para o player web. */
  midiaWeb: string;
  /** Último ponto assistido, salvo no backend. */
  posicaoSegundos: number;
  concluido: boolean;
};

export type LessonDetail = {
  aula: {
    id: number;
    titulo: string;
    descricao: string | null;
    tipo: LessonType;
    duracaoSegundos: number | null;
    linkExterno: string | null;
    /** Caminho da mídia na API; exige o token no cabeçalho. */
    midia: string | null;
    midiaWeb: string | null;
    posicaoSegundos: number;
    concluida: boolean;
  };
  /** Aulas de vídeo: os vídeos na ordem de reprodução. Vazio nas demais. */
  videos: LessonVideo[];
  /** Vídeo em que a aula deve reabrir (o último assistido ou o próximo pendente). */
  videoAtualId: number | null;
  curso: { id: number; titulo: string };
  posicao: number;
  total: number;
  /** Aula demonstrativa aberta por quem não tem acesso ao curso. */
  demonstracao: boolean;
  proxima: NextLesson;
};

export type ProgressResult = { concluida: boolean; cursoConcluido: boolean; proxima: NextLesson };

/** Resposta ao salvar o progresso de um vídeo: a aula só é concluída com todos os vídeos concluídos. */
export type VideoProgressResult = {
  concluido: boolean;
  videosConcluidos: number;
  totalVideos: number;
  duracaoSegundos: number | null;
  duracaoAulaSegundos: number | null;
  aulaConcluida: boolean;
  cursoConcluido: boolean;
  proxima: NextLesson;
};

export const fetchHome = () => request<HomeData>('/api/home', {});

export async function fetchCategories() {
  return (await request<{ categorias: Category[] }>('/api/categorias', {})).categorias;
}

export type CourseFilters = { search?: string; categoryId?: number; section?: SectionId; page?: number };

export function fetchCourses({ search, categoryId, section, page = 1 }: CourseFilters) {
  const query = [
    search ? `busca=${encodeURIComponent(search)}` : null,
    categoryId !== undefined ? `categoriaId=${categoryId}` : null,
    section ? `secao=${section}` : null,
    `pagina=${page}`,
  ]
    .filter(Boolean)
    .join('&');
  return request<{ cursos: CourseSummary[]; pagina: number; temMais: boolean }>(`/api/cursos?${query}`, {});
}

export const fetchCourse = (id: number, token?: string) =>
  request<CourseDetail>(`/api/cursos/${id}`, { token });

export const fetchLesson = (token: string, id: number) =>
  request<LessonDetail>(`/api/aulas/${id}`, { token });

/** Salva o ponto de reprodução de um vídeo; com `finalizado`, conclui esse vídeo. */
export const saveVideoProgress = (
  token: string,
  lessonId: number,
  videoId: number,
  body: { posicaoSegundos?: number; finalizado?: boolean; duracaoSegundos?: number; versaoMidia?: string }
) =>
  request<VideoProgressResult>(`/api/aulas/${lessonId}/videos/${videoId}/progresso`, {
    method: 'POST',
    token,
    body,
    keepalive: true,
  });

export const saveLessonProgress = (
  token: string,
  id: number,
  body: { posicaoSegundos?: number; finalizada?: boolean }
) => request<ProgressResult>(`/api/aulas/${id}/progresso`, { method: 'POST', token, body, keepalive: true });
