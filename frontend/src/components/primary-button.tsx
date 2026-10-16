import { ActivityIndicator, Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';

import { Brand, Fonts, Radius } from '@/constants/brand';

type Props = {
  label: string;
  onPress: () => void;
  variant?: 'solid' | 'outline';
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function PrimaryButton({
  label,
  onPress,
  variant = 'solid',
  disabled = false,
  loading = false,
  style,
}: Props) {
  const outline = variant === 'outline';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      disabled={disabled || loading}
      onPress={onPress}
      android_ripple={{ color: outline ? Brand.surface : 'rgba(255, 255, 255, 0.28)' }}
      style={({ pressed }) => [
        styles.button,
        outline && styles.outline,
        disabled && styles.disabled,
        pressed && styles.pressed,
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={outline ? Brand.primaryDeep : Brand.white} />
      ) : (
        <Text
          style={[styles.label, outline && styles.outlineLabel, disabled && styles.disabledLabel]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 50,
    borderRadius: Radius.pill,
    backgroundColor: Brand.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  outline: { backgroundColor: 'transparent', borderWidth: 1, borderColor: Brand.primarySoft },
  disabled: { backgroundColor: Brand.surface },
  label: {
    fontFamily: Fonts.sansMedium,
    fontSize: 14,
    letterSpacing: 0.3,
    color: Brand.white,
    textAlign: 'center',
  },
  outlineLabel: { color: Brand.text },
  disabledLabel: { color: Brand.muted },
  pressed: { opacity: 0.85 },
});
