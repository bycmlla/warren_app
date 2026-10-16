import { StyleSheet, Text, View } from 'react-native';

import { Brand, Fonts, Radius } from '@/constants/brand';
import type { LegalDocument } from '@/services/commerce-api';
import { formatDay } from '@/utils/format';

/** Versão e data de vigência de um documento legal. */
export function LegalMeta({ document }: { document: LegalDocument }) {
  return (
    <Text style={styles.meta}>
      Versão {document.versao} · vigente desde {formatDay(document.vigenteDesde)}
    </Text>
  );
}

type Block =
  | { kind: 'title' | 'heading' | 'note' | 'paragraph'; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'rule' };

const BULLET = /^[-*•]\s+/;

/**
 * Separa o documento em blocos (parágrafos separados por linha em branco) e reconhece a
 * formatação básica de Markdown: títulos (#, ##), listas (-), citações (>) e linhas (---).
 * Em um texto simples, sem nenhum título marcado, uma linha curta e sozinha, sem pontuação
 * final, é tratada como título de seção.
 */
function parse(text: string): Block[] {
  const marked = /^#{1,6}\s/m.test(text);
  return text
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block): Block => {
      const lines = block.split('\n').map((line) => line.trim());
      if (/^-{3,}$/.test(block)) return { kind: 'rule' };
      if (lines.every((line) => BULLET.test(line))) {
        return { kind: 'list', items: lines.map((line) => line.replace(BULLET, '')) };
      }
      if (lines.every((line) => line.startsWith('>'))) {
        return { kind: 'note', text: lines.map((line) => line.replace(/^>\s?/, '')).join(' ') };
      }
      const heading = lines.length === 1 ? /^(#{1,6})\s+(.+)$/.exec(block) : null;
      if (heading) return { kind: heading[1].length === 1 ? 'title' : 'heading', text: heading[2] };
      if (!marked && lines.length === 1 && block.length <= 90 && !/[.;:,]$/.test(block)) {
        return { kind: 'heading', text: block };
      }
      return { kind: 'paragraph', text: block };
    });
}

/** Texto com os trechos entre ** em destaque. */
function Inline({ text }: { text: string }) {
  return text.split(/(\*\*[^*]+\*\*)/).map((part, index) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4 ? (
      <Text key={index} style={styles.strong}>
        {part.slice(2, -2)}
      </Text>
    ) : (
      part
    )
  );
}

/**
 * Texto integral de um documento legal (Termos de Uso, Política de Privacidade), exatamente
 * como publicado no backend. O conteúdo nunca é alterado aqui: só a apresentação.
 */
export function LegalText({ text }: { text: string }) {
  return (
    <View style={styles.text}>
      {parse(text).map((block, index) => {
        if (block.kind === 'rule') return <View key={index} style={styles.rule} />;
        if (block.kind === 'list') {
          return (
            <View key={index} style={styles.list}>
              {block.items.map((item, position) => (
                <View key={position} style={styles.item}>
                  <Text style={styles.bullet}>•</Text>
                  <Text selectable style={[styles.paragraph, styles.itemText]}>
                    <Inline text={item} />
                  </Text>
                </View>
              ))}
            </View>
          );
        }
        const heading = block.kind === 'title' || block.kind === 'heading';
        return (
          <Text
            key={index}
            selectable
            accessibilityRole={heading ? 'header' : undefined}
            style={
              block.kind === 'title'
                ? styles.title
                : block.kind === 'heading'
                  ? styles.heading
                  : block.kind === 'note'
                    ? styles.note
                    : styles.paragraph
            }>
            <Inline text={block.text} />
          </Text>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  meta: { fontFamily: Fonts.sansMedium, fontSize: 12.5, lineHeight: 18, color: Brand.primaryDeep },
  text: { gap: 12 },
  title: { fontFamily: Fonts.sansSemiBold, fontSize: 15.5, lineHeight: 22, letterSpacing: 0.3, color: Brand.text },
  heading: { fontFamily: Fonts.sansSemiBold, fontSize: 14.5, lineHeight: 21, color: Brand.text, marginTop: 6 },
  paragraph: { fontFamily: Fonts.sans, fontSize: 14, lineHeight: 22, color: Brand.text },
  strong: { fontFamily: Fonts.sansSemiBold },
  note: {
    fontFamily: Fonts.sans,
    fontSize: 13,
    lineHeight: 20,
    color: Brand.text,
    backgroundColor: Brand.surfaceSoft,
    borderRadius: Radius.tile,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  list: { gap: 6 },
  item: { flexDirection: 'row', gap: 8, paddingLeft: 4 },
  bullet: { fontFamily: Fonts.sans, fontSize: 14, lineHeight: 22, color: Brand.primaryDeep },
  itemText: { flex: 1 },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: Brand.primarySoft, marginVertical: 4 },
});
