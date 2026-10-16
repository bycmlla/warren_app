import { Image } from 'expo-image';
import { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';

import { BrandIcon, type IconName } from '@/components/brand-icon';
import { fileUrl } from '@/constants/api';
import { Brand, Fonts, Radius } from '@/constants/brand';
import { useAuth } from '@/context/auth';
import { pickFile, uploadFile } from '@/services/upload';

// Campos compartilhados pelos formulários administrativos.

/** Com `error`, o campo fica contornado em vermelho e mostra a mensagem logo abaixo. */
export function TextField({
  label,
  hint,
  error,
  multiline,
  ...props
}: TextInputProps & { label: string; hint?: string; error?: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={error !== undefined ? `${label}. ${error}` : label}
        placeholderTextColor={Brand.muted}
        selectionColor={Brand.primary}
        multiline={multiline}
        textAlignVertical={multiline ? 'top' : 'center'}
        style={[styles.input, multiline && styles.multiline, error !== undefined && styles.inputError]}
        {...props}
      />
      {error !== undefined && (
        <Text accessibilityLiveRegion="polite" style={styles.fieldError}>
          {error}
        </Text>
      )}
      {hint !== undefined && <Text style={styles.hint}>{hint}</Text>}
    </View>
  );
}

export function SwitchRow({
  label,
  description,
  value,
  onValueChange,
  disabled,
}: {
  label: string;
  description?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.switchRow}>
      <View style={styles.switchText}>
        <Text style={styles.switchLabel}>{label}</Text>
        {description !== undefined && <Text style={styles.hint}>{description}</Text>}
      </View>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ false: Brand.surface, true: Brand.primarySoft }}
        thumbColor={value ? Brand.primary : Brand.card}
      />
    </View>
  );
}

type Option<T> = { value: T; label: string; icon?: IconName };

/** Seleção única em cápsulas, no mesmo estilo dos filtros de Explorar. */
export function ChoiceChips<T extends string | number | null>({
  label,
  options,
  value,
  onChange,
}: {
  label?: string;
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.field}>
      {label !== undefined && <Text style={styles.label}>{label}</Text>}
      <View style={styles.chips}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={String(option.value)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={option.label}
              onPress={() => onChange(option.value)}
              style={({ pressed }) => [styles.chip, selected && styles.chipSelected, pressed && styles.pressed]}>
              {option.icon !== undefined && (
                <BrandIcon
                  name={option.icon}
                  size={15}
                  strokeWidth={1.5}
                  color={selected ? Brand.white : Brand.primaryDeep}
                />
              )}
              <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** Capa ou banner: escolhe a imagem no dispositivo, envia ao armazenamento e guarda o endereço. */
export function ImageField({
  label,
  hint,
  value,
  onChange,
  onUploading,
}: {
  label: string;
  hint?: string;
  value: string | null;
  onChange: (value: string | null) => void;
  onUploading?: (uploading: boolean) => void;
}) {
  const { authorized } = useAuth();
  const [progress, setProgress] = useState<number>();
  const [error, setError] = useState<string>();
  const uri = fileUrl(value);

  const choose = async () => {
    setError(undefined);
    try {
      const file = await pickFile('imagem');
      if (!file) return;
      setProgress(0);
      onUploading?.(true);
      const uploaded = await authorized((token) => uploadFile(token, 'imagem', file, setProgress));
      onChange(uploaded.url ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível enviar a imagem.');
    } finally {
      setProgress(undefined);
      onUploading?.(false);
    }
  };

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {uri !== null && (
        <Image source={{ uri }} contentFit="cover" accessibilityLabel={label} style={styles.preview} />
      )}
      <View style={styles.imageActions}>
        <SmallButton
          label={progress !== undefined ? `Enviando… ${Math.round(progress * 100)}%` : uri ? 'Trocar imagem' : 'Escolher imagem'}
          onPress={choose}
          disabled={progress !== undefined}
        />
        {uri !== null && progress === undefined && (
          <SmallButton label="Remover" onPress={() => onChange(null)} />
        )}
      </View>
      {hint !== undefined && <Text style={styles.hint}>{hint}</Text>}
      {error !== undefined && <FormError message={error} />}
    </View>
  );
}

export function SmallButton({
  label,
  onPress,
  icon,
  disabled = false,
  tone = 'default',
}: {
  label: string;
  onPress: () => void;
  icon?: IconName;
  disabled?: boolean;
  tone?: 'default' | 'danger';
}) {
  const color = tone === 'danger' ? Brand.danger : Brand.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.smallButton, disabled && styles.disabled, pressed && styles.pressed]}>
      {icon !== undefined && <BrandIcon name={icon} size={14} strokeWidth={1.5} color={color} />}
      <Text style={[styles.smallButtonText, { color }]}>{label}</Text>
    </Pressable>
  );
}

/** Botão só com ícone (editar, excluir, mover), com área de toque confortável. */
export function IconButton({
  icon,
  label,
  onPress,
  disabled = false,
  tone = 'default',
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: 'default' | 'danger';
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => [styles.iconButton, disabled && styles.iconDisabled, pressed && styles.pressed]}>
      <BrandIcon
        name={icon}
        size={17}
        strokeWidth={1.5}
        color={tone === 'danger' ? Brand.danger : Brand.text}
      />
    </Pressable>
  );
}

export function FormError({ message }: { message: string }) {
  return (
    <Text accessibilityLiveRegion="polite" style={styles.error}>
      {message}
    </Text>
  );
}

const styles = StyleSheet.create({
  field: { gap: 6 },
  label: { fontFamily: Fonts.sansMedium, fontSize: 12.5, color: Brand.text },
  hint: { fontFamily: Fonts.sans, fontSize: 12, lineHeight: 17, color: Brand.muted },
  input: {
    minHeight: 52,
    borderRadius: Radius.field,
    borderWidth: 1,
    borderColor: Brand.surface,
    backgroundColor: Brand.card,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontFamily: Fonts.sans,
    fontSize: 15,
    color: Brand.text,
  },
  multiline: { minHeight: 112 },
  inputError: { borderColor: Brand.danger, borderWidth: 1.5 },
  fieldError: { fontFamily: Fonts.sansMedium, fontSize: 12.5, lineHeight: 18, color: Brand.danger },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 },
  switchText: { flex: 1, gap: 2 },
  switchLabel: { fontFamily: Fonts.sansMedium, fontSize: 14, color: Brand.text },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Brand.primarySoft,
    backgroundColor: Brand.background,
  },
  chipSelected: { backgroundColor: Brand.primary, borderColor: Brand.primary },
  chipText: { fontFamily: Fonts.sansMedium, fontSize: 13, color: Brand.text },
  chipTextSelected: { color: Brand.white },
  preview: { width: '100%', aspectRatio: 16 / 9, borderRadius: Radius.field, backgroundColor: Brand.surface },
  imageActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  smallButton: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Brand.primarySoft,
  },
  smallButtonText: { fontFamily: Fonts.sansMedium, fontSize: 13 },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Brand.surfaceSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconDisabled: { opacity: 0.3 },
  disabled: { opacity: 0.5 },
  error: {
    fontFamily: Fonts.sans,
    fontSize: 13,
    lineHeight: 19,
    color: Brand.danger,
    backgroundColor: Brand.dangerSoft,
    borderRadius: Radius.tile,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  pressed: { opacity: 0.7 },
});
