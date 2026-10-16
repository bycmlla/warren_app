// Seções fixas da Home. A administradora escolhe em qual delas cada curso aparece
// (ou nenhuma); a seção é independente da categoria do curso.
export const sections = [
  { id: 'para-voce', title: 'Conteúdos para você' },
  { id: 'metodo', title: 'Método' },
  { id: 'praticas', title: 'Práticas' },
  { id: 'modulos', title: 'Módulos especiais' },
] as const;

export type SectionId = (typeof sections)[number]['id'];

export const isSectionId = (value: unknown): value is SectionId =>
  sections.some((section) => section.id === value);

export const sectionTitle = (id: SectionId) => sections.find((section) => section.id === id)!.title;
