import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BrandIcon } from '@/components/brand-icon';
import { HeroButtonFace } from '@/components/home-hero';
import { BUTTON_STYLES, BUTTON_STYLE_IDS, type ButtonStyleId } from '@/constants/banner';
import { Brand, Fonts, Radius } from '@/constants/brand';

/** As três cores do botão, cada uma com a prévia real do botão. Uma só fica selecionada. */
export function ButtonStylePicker({ value, onChange }: { value: ButtonStyleId; onChange: (id: ButtonStyleId) => void }) {
  return (
    <View accessibilityRole="radiogroup" style={styles.options}>
      {BUTTON_STYLE_IDS.map((id) => (
        <ButtonOption key={id} id={id} selected={value === id} onPress={() => onChange(id)} />
      ))}
    </View>
  );
}

/** Uma das três opções: nome, prévia real do botão e indicação de uso. */
function ButtonOption({ id, selected, onPress }: { id: ButtonStyleId; selected: boolean; onPress: () => void }) {
  const look = BUTTON_STYLES[id];
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${look.label}. ${look.hint}`}
      onPress={onPress}
      style={({ pressed }) => [styles.option, selected && styles.optionSelected, pressed && styles.pressed]}>
      <View style={styles.optionTop}>
        <View style={styles.optionText}>
          <Text style={styles.optionName}>{look.label}</Text>
          <Text style={styles.hint}>{look.hint}</Text>
        </View>
        <View style={[styles.radio, selected && styles.radioSelected]}>
          {selected && <BrandIcon name="check" size={12} strokeWidth={2.4} color={Brand.white} />}
        </View>
      </View>
      {/* Fundo neutro para a prévia: o botão branco precisa de contraste para ser avaliado. */}
      <View style={[styles.stage, id === 'white' && styles.stageDark]}>
        <HeroButtonFace look={look} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  options: { gap: 10 },
  option: {
    gap: 10,
    padding: 12,
    borderRadius: Radius.card,
    borderWidth: 1.5,
    borderColor: Brand.surface,
    backgroundColor: Brand.card,
  },
  optionSelected: { borderColor: Brand.primary },
  optionTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  optionText: { flex: 1, gap: 1 },
  optionName: { fontFamily: Fonts.sansMedium, fontSize: 14.5, color: Brand.text },
  hint: { fontFamily: Fonts.sans, fontSize: 12, lineHeight: 17, color: Brand.muted },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: Brand.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: { backgroundColor: Brand.primary, borderColor: Brand.primary },
  stage: {
    alignItems: 'flex-start',
    padding: 12,
    borderRadius: Radius.tile,
    backgroundColor: Brand.surfaceSoft,
  },
  stageDark: { backgroundColor: '#5A5C52' },
  pressed: { opacity: 0.85 },
});
