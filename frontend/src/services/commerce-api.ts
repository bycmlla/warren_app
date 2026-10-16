import { request } from '@/services/auth-api';
import type { Commerce } from '@/services/catalog-api';
import { formatMoney } from '@/utils/format';

// Termos de Uso, oferta e compra de cursos pagos, e os cursos do aluno.
// Preços, descontos e parcelas vêm sempre do backend; o aplicativo só os exibe.

export type LegalDocument = {
  id: number;
  versao: string;
  /** Data de vigência, "aaaa-mm-dd…". */
  vigenteDesde: string;
  texto: string;
  hash: string;
};

export type TermsStatus = {
  /** null enquanto nenhuma versão dos Termos de Uso tiver sido publicada. */
  termos: LegalDocument | null;
  /** Aceite válido do usuário da sessão, se houver. */
  aceite: { versao: string; aceitoEm: string } | null;
  privacidadePublicada: boolean;
};

export type PaymentMethod = 'pix' | 'cartao';

export type OrderStatus =
  | 'pendente'
  | 'em_processamento'
  | 'aprovado'
  | 'recusado'
  | 'cancelado'
  | 'expirado'
  | 'reembolsado'
  | 'contestado';

export type Installment = {
  parcelas: number;
  valorParcelaCentavos: number;
  totalCentavos: number;
  jurosCentavos: number;
};

export type PaymentOption =
  | { forma: 'pix'; totalCentavos: number; descontoCentavos: number }
  /** `opcoes` é null enquanto o provedor de pagamentos não informar as parcelas reais. */
  | { forma: 'cartao'; maxParcelas: number; opcoes: Installment[] | null };

export type Offer = {
  curso: {
    id: number;
    titulo: string;
    subtitulo: string | null;
    descricao: string | null;
    instrutora: string | null;
    imagemCapa: string | null;
    totalModulos: number;
    totalAulas: number;
    duracaoMinutos: number;
  };
  comercial: Commerce;
  /** `disponivel` é falso enquanto não houver provedor de pagamentos ativo no backend. */
  pagamentos: { disponivel: boolean; metodos: PaymentOption[] };
  pedidoPendenteId: number | null;
};

export type Order = {
  id: number;
  cursoId: number;
  cursoTitulo: string;
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
  /** Validade da cobrança, enquanto ela está em aberto. */
  expiraEm: string | null;
  pix: { copiaECola: string; qrBase64: string | null } | null;
  /** Página segura do provedor para concluir o pagamento (cartão). */
  checkoutUrl: string | null;
  reciboUrl: string | null;
};

export type AccessStatus = 'ativo' | 'vencido' | 'revogado' | 'agendado' | 'gratuito';

export type MyCourse = {
  id: number;
  titulo: string;
  subtitulo: string | null;
  imagemCapa: string | null;
  totalAulas: number;
  aulasConcluidas: number;
  percentual: number;
  situacao: AccessStatus;
  origem: 'manual' | 'compra' | null;
  inicioEm: string | null;
  expiraEm: string | null;
  diasRestantes: number | null;
  pertoDeVencer: boolean;
};

export const orderStatusLabels: Record<OrderStatus, string> = {
  pendente: 'Aguardando pagamento',
  em_processamento: 'Em análise',
  aprovado: 'Aprovada',
  recusado: 'Recusada',
  cancelado: 'Cancelada',
  expirado: 'Expirada',
  reembolsado: 'Reembolsada',
  contestado: 'Contestada',
};

export const paymentMethodLabels: Record<PaymentMethod, string> = { pix: 'Pix', cartao: 'Cartão de crédito' };

export const accessStatusLabels: Record<AccessStatus, string> = {
  ativo: 'Acesso ativo',
  vencido: 'Acesso vencido',
  revogado: 'Acesso encerrado',
  agendado: 'Acesso agendado',
  gratuito: 'Gratuito',
};

export const isOpenOrder = (status: OrderStatus) => status === 'pendente' || status === 'em_processamento';

/** "6x de R$ 55,44" ou "à vista", conforme as parcelas de uma compra. */
export const installmentsLabel = (count: number, installmentCents: number) =>
  count > 1 ? `${count}x de ${formatMoney(installmentCents)}` : 'à vista';

export const fetchTerms = (token?: string) => request<TermsStatus>('/api/termos', { token });

export async function fetchPrivacy() {
  return (await request<{ documento: LegalDocument | null }>('/api/privacidade', {})).documento;
}

/** Registra o aceite do documento exibido. O backend recusa se os termos mudaram nesse meio-tempo. */
export const acceptTerms = (token: string, document: LegalDocument) =>
  request<{ aceite: { versao: string; aceitoEm: string } }>('/api/termos/aceite', {
    method: 'POST',
    token,
    body: { documentoId: document.id, hash: document.hash, aceito: true },
  });

/** Recusada pelo backend (428) enquanto os Termos de Uso vigentes não forem aceitos. */
export const fetchOffer = (token: string, courseId: number) =>
  request<Offer>(`/api/cursos/${courseId}/oferta`, { token });

/** Só curso, forma e parcelas são enviados: o backend calcula todos os valores. */
export async function createOrder(token: string, body: { cursoId: number; formaPagamento: PaymentMethod; parcelas: number }) {
  return (await request<{ pedido: Order }>('/api/pedidos', { method: 'POST', token, body })).pedido;
}

export async function fetchOrders(token: string) {
  return (await request<{ pedidos: Order[] }>('/api/pedidos', { token })).pedidos;
}

export async function fetchOrder(token: string, id: number) {
  return (await request<{ pedido: Order }>(`/api/pedidos/${id}`, { token })).pedido;
}

export async function cancelOrder(token: string, id: number) {
  return (await request<{ pedido: Order }>(`/api/pedidos/${id}/cancelar`, { method: 'POST', token })).pedido;
}

export async function fetchMyCourses(token: string) {
  return (await request<{ cursos: MyCourse[] }>('/api/meus-cursos', { token })).cursos;
}
