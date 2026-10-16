// Banner da página inicial: configuração publicada pela administradora e estilos do botão.

export type ButtonStyleId = 'champagne' | 'white' | 'dark';

export type ButtonStyle = {
  label: string;
  hint: string;
  background: string;
  text: string;
  arrow: string;
  border: string | null;
};

/** As três opções de cor do botão "Explorar experiências"; não há seletor livre de cores. */
export const BUTTON_STYLES: Record<ButtonStyleId, ButtonStyle> = {
  champagne: {
    label: 'Champanhe',
    hint: 'Para fundos claros e neutros',
    background: '#B79A60',
    text: '#22251F',
    arrow: '#22251F',
    border: null,
  },
  white: {
    label: 'Branco',
    hint: 'Para fotografias escuras',
    background: '#FFFFFF',
    text: '#34362F',
    arrow: '#34362F',
    border: '#DDD5C9',
  },
  dark: {
    label: 'Escuro',
    hint: 'Para fotografias claras',
    background: '#34362F',
    text: '#FFFFFF',
    arrow: '#FFFFFF',
    border: null,
  },
};

export const BUTTON_STYLE_IDS: ButtonStyleId[] = ['champagne', 'white', 'dark'];

export type BannerText = { texto: string; visivel: boolean };

export type BannerConfig = {
  /** padrao = composição original; personalizado = imagem enviada pela administradora. */
  modo: 'padrao' | 'personalizado';
  /** Caminho da imagem personalizada no servidor. */
  imagem: string | null;
  /** Ponto da imagem que fica no centro do banner, em % (0 = esquerda/topo, 100 = direita/base). */
  enquadramento: { x: number; y: number };
  textoSuperior: BannerText;
  titulo: BannerText;
  botao: ButtonStyleId;
  atualizadoEm: string | null;
};

export const DEFAULT_BANNER_TEXTS = {
  textoSuperior: 'IDENTIDADE • ENERGIA • CONSCIÊNCIA',
  titulo: 'Abra espaço para a vida que você deseja',
};

/** Banner original, usado enquanto nada foi publicado (e se a Home ainda não carregou). */
export const DEFAULT_BANNER: BannerConfig = {
  modo: 'padrao',
  imagem: null,
  enquadramento: { x: 50, y: 50 },
  textoSuperior: { texto: DEFAULT_BANNER_TEXTS.textoSuperior, visivel: true },
  titulo: { texto: DEFAULT_BANNER_TEXTS.titulo, visivel: true },
  botao: 'champagne',
  atualizadoEm: null,
};

/** Banner do carrossel como a Home o recebe: `id` nulo é o banner padrão (que não é uma linha do banco). */
export type Slide = BannerConfig & { id: number | null };

export const DEFAULT_SLIDE: Slide = { ...DEFAULT_BANNER, id: null };

/** Banner personalizado como a administração o vê. */
export type AdminBanner = Slide & {
  id: number;
  nome: string;
  ativo: boolean;
  ordem: number;
  criadoEm: string | null;
};

/** Ajuste do banner padrão: se participa do carrossel e a cor do botão. */
export type DefaultBannerSetting = { exibir: boolean; botao: ButtonStyleId };
