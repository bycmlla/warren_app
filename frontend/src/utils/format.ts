const two = (value: number) => String(value).padStart(2, '0');

/** Posição ou duração de uma aula: "3:05" ou "1:02:07". */
export function formatClock(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0
    ? `${hours}:${two(minutes)}:${two(seconds % 60)}`
    : `${minutes}:${two(seconds % 60)}`;
}

/** Duração total aproximada: "45 min", "1h 20min". Vazio quando não há duração cadastrada. */
export function formatDuration(totalSeconds: number | null | undefined) {
  if (totalSeconds == null || !Number.isFinite(totalSeconds) || totalSeconds <= 0) return '';
  if (totalSeconds < 60) return 'menos de 1 min';
  const minutes = Math.max(1, Math.round(totalSeconds / 60));
  const hours = Math.floor(minutes / 60);
  if (hours === 0) return `${minutes} min`;
  return minutes % 60 === 0 ? `${hours}h` : `${hours}h ${minutes % 60}min`;
}

export const formatLessons = (count: number) => (count === 1 ? '1 aula' : `${count} aulas`);

/** Lê "mm:ss", "h:mm:ss" ou segundos. Retorna null se vazio e undefined se inválido. */
export function parseClock(text: string): number | null | undefined {
  const value = text.trim();
  if (!value) return null;
  if (!/^\d{1,3}(:[0-5]?\d){0,2}$/.test(value)) return undefined;
  return value.split(':').reduce((total, part) => total * 60 + Number(part), 0);
}

/** Valor em centavos como moeda: 29700 → "R$ 297,00". */
export function formatMoney(cents: number) {
  const [whole, fraction] = (Math.abs(cents) / 100).toFixed(2).split('.');
  return `${cents < 0 ? '-' : ''}R$ ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${fraction}`;
}

/** Lê um valor digitado em reais ("297", "297,00", "1.297,50"). null se vazio, undefined se inválido. */
export function parseMoney(text: string): number | null | undefined {
  const value = text.replace(/R\$|\s/g, '');
  if (!value) return null;
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$/.test(value)) return undefined;
  return Math.round(Number(value.replace(/\./g, '').replace(',', '.')) * 100);
}

/** Centavos no formato de digitação: 29700 → "297,00". */
export const moneyInput = (cents: number | null) => (cents === null ? '' : formatMoney(cents).slice(3));

/** Data vinda da API (ISO) como "15/01/2027". Vazio quando ausente. */
export function formatDate(value: string | null | undefined) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : `${two(date.getDate())}/${two(date.getMonth() + 1)}/${date.getFullYear()}`;
}

/** Data de vigência (só dia, sem fuso): "2026-11-01" → "01/11/2026". */
export function formatDay(value: string) {
  const [year, month, day] = value.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

/** Data e hora locais: "15/01/2027 às 14:32". */
export function formatDateTime(value: string) {
  const date = new Date(value);
  return `${formatDate(value)} às ${two(date.getHours())}:${two(date.getMinutes())}`;
}

/** Lê "dd/mm/aaaa" e devolve "aaaa-mm-dd". null se vazio, undefined se inválido. */
export function parseDate(text: string): string | null | undefined {
  const value = text.trim();
  if (!value) return null;
  const parts = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (!parts) return undefined;
  const [day, month, year] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  const date = new Date(year, month - 1, day);
  return date.getDate() === day && date.getMonth() === month - 1 ? `${year}-${two(month)}-${two(day)}` : undefined;
}

/** Prazo de acesso de um curso: "12 meses" ou "sem vencimento". */
export const formatAccessTerm = (months: number | null) => (months === null ? 'sem vencimento' : `${months} meses`);

export const formatModules = (count: number) => (count === 1 ? '1 módulo' : `${count} módulos`);
