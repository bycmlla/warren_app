import type { IconName } from '@/components/brand-icon';
import type { AdminBanner, BannerText, ButtonStyleId, DefaultBannerSetting } from '@/constants/banner';
import type { SectionId } from '@/constants/sections';
import { request } from '@/services/auth-api';
import type { AccessType } from '@/services/catalog-api';
import type { AccessStatus, OrderStatus, PaymentMethod } from '@/services/commerce-api';

// Rotas exclusivas de ADMIN: o backend recusa os demais perfis com 403.

export type CourseStatus = 'rascunho' | 'publicado' | 'arquivado';
export type LessonType = 'video' | 'audio' | 'spotify';

export const statusLabels: Record<CourseStatus, string> = {
  rascunho: 'Rascunho',
  publicado: 'Publicado',
  arquivado: 'Arquivado',
};

export const lessonTypeLabels: Record<LessonType, string> = {
  video: 'Vídeo',
  audio: 'Áudio',
  spotify: 'Spotify',
};

export type CourseStats = {
  total: number;
  publicados: number;
  rascunhos: number;
  arquivados: number;
  destaques: number;
};

export type AdminCategory = {
  id: number;
  nome: string;
  descricao: string | null;
  icone: IconName | null;
  mostrarHome: boolean;
  totalCursos: number;
  cursosPublicados: number;
};

export type CategoryInput = {
  nome?: string;
  descricao?: string | null;
  icone?: IconName | null;
  mostrarHome?: boolean;
};

export type AdminCourse = {
  id: number;
  titulo: string;
  subtitulo: string | null;
  descricao: string | null;
  instrutora: string | null;
  imagemCapa: string | null;
  imagemBanner: string | null;
  categoriaId: number | null;
  categoria: string | null;
  secao: SectionId | null;
  destaque: boolean;
  tipoAcesso: AccessType;
  gratuito: boolean;
  precoCentavos: number | null;
  pixHabilitado: boolean;
  pixDescontoPercentual: number;
  cartaoHabilitado: boolean;
  cartaoMaxParcelas: number;
  cartaoParcelasSemJuros: number;
  /** 12, 24 ou null (sem vencimento definido). */
  prazoAcessoMeses: number | null;
  sequencial: boolean;
  status: CourseStatus;
  totalAulas: number;
  duracaoMinutos: number;
  atualizadoEm: string | null;
};

export type AccessGrantInput = { usuarioId: number; inicioEm?: string; prazoMeses?: number | null };
export type AccessChanges = { conceder: AccessGrantInput[]; revogar: number[] };

export type CourseInput = Pick<
  AdminCourse,
  | 'titulo'
  | 'subtitulo'
  | 'descricao'
  | 'instrutora'
  | 'imagemCapa'
  | 'imagemBanner'
  | 'categoriaId'
  | 'secao'
  | 'destaque'
  | 'tipoAcesso'
  | 'precoCentavos'
  | 'pixHabilitado'
  | 'pixDescontoPercentual'
  | 'cartaoHabilitado'
  | 'cartaoMaxParcelas'
  | 'cartaoParcelasSemJuros'
  | 'prazoAcessoMeses'
  | 'sequencial'
> & { acessos?: AccessChanges };

export type AdminLesson = {
  id: number;
  titulo: string;
  descricao: string | null;
  imagemCapa: string | null;
  tipo: LessonType;
  arquivo: string | null;
  linkExterno: string | null;
  /** Aula de vídeo: soma das durações dos vídeos. Lida dos arquivos; null enquanto desconhecida. */
  duracaoSegundos: number | null;
  demonstrativa: boolean;
  /** Vídeos da aula, na ordem de reprodução. Vazio nas aulas de áudio e do Spotify. */
  videos: AdminVideo[];
};

export type AdminVideo = { id: number; titulo: string | null; arquivo: string; duracaoSegundos: number | null };

/**
 * Dados enviados ao salvar uma aula. Em aulas de vídeo vão os vídeos na ordem desejada: com `id`
 * os que já existem (o progresso dos alunos é preservado), sem `id` os novos. As durações são
 * definidas pelo backend a partir dos arquivos; a enviada aqui só vale quando ele não consegue lê-la.
 */
export type LessonInput = {
  titulo: string;
  descricao: string | null;
  imagemCapa?: string | null;
  tipo: LessonType;
  arquivo: string | null;
  linkExterno: string | null;
  duracaoSegundos: number | null;
  demonstrativa: boolean;
  videos?: { id?: number; titulo: string | null; arquivo: string; duracaoSegundos: number | null }[];
  moduloId?: number;
};

export type AdminModule = {
  id: number;
  titulo: string;
  descricao: string | null;
  aulas: AdminLesson[];
};

export type AdminCourseDetail = { curso: AdminCourse; modulos: AdminModule[] };

const admin = '/api/admin';

export async function fetchCourseStats(token: string) {
  return (await request<{ indicadores: CourseStats }>(`${admin}/cursos/indicadores`, { token }))
    .indicadores;
}

// Categorias

export async function fetchAdminCategories(token: string) {
  return (await request<{ categorias: AdminCategory[] }>(`${admin}/categorias`, { token })).categorias;
}

export const createCategory = (token: string, body: CategoryInput) =>
  request(`${admin}/categorias`, { method: 'POST', token, body });

export const updateCategory = (token: string, id: number, body: CategoryInput) =>
  request(`${admin}/categorias/${id}`, { method: 'PUT', token, body });

export const reorderCategories = (token: string, ids: number[]) =>
  request(`${admin}/categorias/ordem`, { method: 'PUT', token, body: { ids } });

/** Com `unlink`, os cursos da categoria ficam sem categoria; sem ele, o backend recusa (409). */
export const deleteCategory = (token: string, id: number, unlink = false) =>
  request(`${admin}/categorias/${id}${unlink ? '?desvincular=true' : ''}`, { method: 'DELETE', token });

// Cursos

export async function fetchAdminCourses(token: string) {
  return (await request<{ cursos: AdminCourse[] }>(`${admin}/cursos`, { token })).cursos;
}

export const fetchAdminCourse = (token: string, id: number) =>
  request<AdminCourseDetail>(`${admin}/cursos/${id}`, { token });

export async function createCourse(token: string, body: CourseInput) {
  return (await request<{ curso: AdminCourse }>(`${admin}/cursos`, { method: 'POST', token, body })).curso;
}

export async function updateCourse(token: string, id: number, body: CourseInput) {
  return (await request<{ curso: AdminCourse }>(`${admin}/cursos/${id}`, { method: 'PUT', token, body }))
    .curso;
}

/** Publicar pode ser recusado (422) com a lista `pendencias` em ApiError.data. */
export const setCourseStatus = (token: string, id: number, status: CourseStatus) =>
  request(`${admin}/cursos/${id}/status`, { method: 'PUT', token, body: { status } });

export const deleteCourse = (token: string, id: number) =>
  request(`${admin}/cursos/${id}`, { method: 'DELETE', token });

// Módulos e aulas

export const createModule = (token: string, courseId: number, body: { titulo: string; descricao: string | null }) =>
  request(`${admin}/cursos/${courseId}/modulos`, { method: 'POST', token, body });

export const updateModule = (token: string, id: number, body: { titulo: string; descricao: string | null }) =>
  request(`${admin}/modulos/${id}`, { method: 'PUT', token, body });

export const deleteModule = (token: string, id: number) =>
  request(`${admin}/modulos/${id}`, { method: 'DELETE', token });

export const reorderModules = (token: string, courseId: number, ids: number[]) =>
  request(`${admin}/cursos/${courseId}/modulos/ordem`, { method: 'PUT', token, body: { ids } });

export const createLesson = (token: string, courseId: number, body: LessonInput) =>
  request<{ aula: { id: number; moduloId: number } }>(`${admin}/cursos/${courseId}/aulas`, {
    method: 'POST',
    token,
    body,
  });

export const updateLesson = (token: string, id: number, body: LessonInput) =>
  request(`${admin}/aulas/${id}`, { method: 'PUT', token, body });

export const deleteLesson = (token: string, id: number) =>
  request(`${admin}/aulas/${id}`, { method: 'DELETE', token });

export const reorderLessons = (token: string, moduleId: number, ids: number[]) =>
  request(`${admin}/modulos/${moduleId}/aulas/ordem`, { method: 'PUT', token, body: { ids } });

// Vendas e direitos de acesso

export type SalesSummary = {
  pedidos: { aprovados: number; pendentes: number; cancelados: number; reembolsados: number; recebidoCentavos: number };
  acessos: { ativos: number; vencidos: number; revogados: number };
  /** null enquanto nenhum provedor de pagamentos estiver ativo. */
  pagamentos: { provedor: string | null };
  termos: { versao: string; vigenteDesde: string } | null;
  /** Cursos pagos publicados sem preço válido ou sem forma de pagamento. */
  cursosComPendencias: { id: number; titulo: string; pendencias: string[] }[];
};

export type Student = { id: number; nome: string; email: string };

export type AdminOrder = {
  id: number;
  cursoId: number;
  cursoTitulo: string;
  aluno: Student;
  status: OrderStatus;
  formaPagamento: PaymentMethod;
  parcelas: number;
  precoCentavos: number;
  descontoCentavos: number;
  jurosCentavos: number;
  totalCentavos: number;
  valorParcelaCentavos: number;
  prazoAcessoMeses: number | null;
  criadoEm: string;
  aprovadoEm: string | null;
};

export type AdminAccess = {
  aluno: Student;
  cursoId: number;
  cursoTitulo: string;
  origem: 'manual' | 'compra';
  pedidoId: number | null;
  situacao: Exclude<AccessStatus, 'gratuito'>;
  inicioEm: string | null;
  expiraEm: string | null;
  diasRestantes: number | null;
  revogadoEm: string | null;
  motivoRevogacao: string | null;
};

const withQuery = (path: string, params: Record<string, string | undefined>) => {
  const query = Object.entries(params)
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}=${encodeURIComponent(value as string)}`)
    .join('&');
  return query ? `${path}?${query}` : path;
};

export const fetchSalesSummary = (token: string) => request<SalesSummary>(`${admin}/comercial/resumo`, { token });

export async function fetchAdminOrders(token: string, filters: { status?: string; busca?: string }) {
  return (await request<{ pedidos: AdminOrder[] }>(withQuery(`${admin}/pedidos`, filters), { token })).pedidos;
}

export type AccessFilters = { situacao?: string; busca?: string; cursoId?: string; usuarioId?: string; pagina?: string };

export async function fetchAdminAccesses(token: string, filters: AccessFilters) {
  return (await request<{ acessos: AdminAccess[] }>(withQuery(`${admin}/acessos`, filters), { token })).acessos;
}

/** Consulta todas as páginas para não omitir alunos ou cursos já autorizados. */
export async function fetchAllAdminAccesses(token: string, filters: AccessFilters) {
  const accesses: AdminAccess[] = [];
  let pagina = 1;
  let temMais: boolean;
  do {
    const result = await request<{ acessos: AdminAccess[]; temMais: boolean }>(
      withQuery(`${admin}/acessos`, { ...filters, pagina: String(pagina) }), { token }
    );
    accesses.push(...result.acessos);
    temMais = result.temMais;
    pagina += 1;
  } while (temMais);
  return accesses;
}

export async function searchStudents(token: string, busca: string) {
  return (await request<{ alunos: Student[] }>(withQuery(`${admin}/alunos`, { busca }), { token })).alunos;
}

/** Sem `prazoMeses`, vale o prazo do curso; sem `inicioEm` (aaaa-mm-dd), o acesso começa agora. */
export const grantAccess = (
  token: string,
  body: { usuarioId: number; cursoId: number; inicioEm?: string; prazoMeses?: number | null }
) => request(`${admin}/acessos`, { method: 'POST', token, body });

export const revokeAccess = (token: string, body: { usuarioId: number; cursoId: number; motivo?: string }) =>
  request(`${admin}/acessos/revogar`, { method: 'POST', token, body });

// Personalização: carrossel de banners da página inicial

export type BannerInput = {
  nome: string;
  imagem: string;
  enquadramento: { x: number; y: number };
  textoSuperior: BannerText;
  titulo: BannerText;
  botao: ButtonStyleId;
  ativo?: boolean;
};

export type BannerPanel = { padrao: DefaultBannerSetting; banners: AdminBanner[] };

const bannersPath = `${admin}/personalizacao/banners`;

export const fetchBanners = (token: string) => request<BannerPanel>(bannersPath, { token });

export async function createBanner(token: string, body: BannerInput) {
  return (await request<{ banner: AdminBanner }>(bannersPath, { method: 'POST', token, body })).banner;
}

export async function updateBanner(token: string, id: number, body: BannerInput) {
  return (await request<{ banner: AdminBanner }>(`${bannersPath}/${id}`, { method: 'PUT', token, body })).banner;
}

export async function setBannerActive(token: string, id: number, ativo: boolean) {
  return (await request<{ banner: AdminBanner }>(`${bannersPath}/${id}/status`, { method: 'PUT', token, body: { ativo } })).banner;
}

export const reorderBanners = (token: string, ids: number[]) =>
  request<BannerPanel>(`${bannersPath}/ordem`, { method: 'PUT', token, body: { ids } });

export const deleteBanner = (token: string, id: number) =>
  request<{ message: string }>(`${bannersPath}/${id}`, { method: 'DELETE', token });

/** O banner padrão não se exclui: só se ajusta se aparece no carrossel e a cor do botão. */
export const saveDefaultBanner = (token: string, body: DefaultBannerSetting) =>
  request<BannerPanel>(`${bannersPath}/padrao`, { method: 'PUT', token, body });
