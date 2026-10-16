import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BrandIcon, BrandMark } from '@/components/brand-icon';
import { PrimaryButton } from '@/components/primary-button';
import { ScreenHeader } from '@/components/screen-header';
import { Brand, Fonts, Gutter, Radius } from '@/constants/brand';
import { useAuth } from '@/context/auth';
import { isProtectedArea, protectedRoutes } from '@/hooks/use-protected-navigation';
import type { User } from '@/services/auth-api';

type Mode = 'login' | 'register';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function LoginScreen() {
  const { redirect } = useLocalSearchParams<{ redirect?: string }>();
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<Mode>('login');
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [telefone, setTelefone] = useState('');
  const [senha, setSenha] = useState('');
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const registering = mode === 'register';

  const validate = () => {
    if (registering && !nome.trim()) return 'Informe seu nome.';
    if (!EMAIL.test(email.trim())) return 'Informe um e-mail válido.';
    if (!senha.trim()) return 'Informe sua senha.';
    if (registering && [...senha].length < 8) return 'A senha deve ter pelo menos 8 caracteres.';
    return undefined;
  };

  // Fecha o login e segue conforme o perfil informado pelo backend: a administradora abre o
  // Painel; alunos voltam à tela de origem ou seguem para a área restrita pedida.
  const finish = (user: User) => {
    const admin = user.role === 'ADMIN';
    const target = isProtectedArea(redirect) ? protectedRoutes[redirect] : undefined;
    if (!router.canGoBack()) return router.replace(admin ? '/panel' : (target ?? '/'));
    router.back();
    if (admin) router.navigate('/panel');
    else if (target) router.navigate(target);
  };

  const submit = async () => {
    if (loading) return;
    const invalid = validate();
    setError(invalid);
    if (invalid) return;

    setLoading(true);
    try {
      const user = registering
        ? await signUp({
            nome: nome.trim(),
            email: email.trim(),
            telefone: telefone.trim() || undefined,
            senha,
          })
        : await signIn(email.trim(), senha);
      finish(user);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível concluir. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(undefined);
  };

  return (
    <View style={styles.screen}>
      <ScreenHeader />
      <KeyboardAvoidingView behavior="padding" style={styles.body}>
        <SafeAreaView edges={['bottom', 'left', 'right']} style={styles.body}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
            <View style={styles.intro}>
              <BrandMark size={34} />
              <Text accessibilityRole="header" style={styles.title}>
                {registering ? 'Crie sua conta' : 'Boas-vindas de volta'}
              </Text>
              <Text style={styles.subtitle}>
                {registering
                  ? 'Cadastre-se para acessar os conteúdos e áreas exclusivas.'
                  : 'Entre para acessar os conteúdos e áreas exclusivas.'}
              </Text>
            </View>

            <View accessibilityRole="tablist" style={styles.modes}>
              {(['login', 'register'] as const).map((item) => (
                <Pressable
                  key={item}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: item === mode }}
                  onPress={() => switchMode(item)}
                  style={[styles.mode, item === mode && styles.selectedMode]}>
                  <Text style={[styles.modeText, item === mode && styles.selectedModeText]}>
                    {item === 'login' ? 'Entrar' : 'Criar conta'}
                  </Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.form}>
              {registering && (
                <Field
                  label="Nome"
                  value={nome}
                  onChangeText={setNome}
                  autoCapitalize="words"
                  autoComplete="name"
                  maxLength={150}
                />
              )}
              <Field
                label="E-mail"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                maxLength={150}
              />
              {registering && (
                <Field
                  label="Telefone (opcional)"
                  value={telefone}
                  onChangeText={setTelefone}
                  autoComplete="tel"
                  keyboardType="phone-pad"
                  maxLength={30}
                />
              )}
              <Field
                label="Senha"
                value={senha}
                onChangeText={setSenha}
                password
                autoCapitalize="none"
                autoComplete={registering ? 'new-password' : 'current-password'}
                returnKeyType="done"
                onSubmitEditing={submit}
              />
            </View>

            {error !== undefined && (
              <Text accessibilityLiveRegion="polite" style={styles.error}>
                {error}
              </Text>
            )}

            <PrimaryButton
              label={registering ? 'Criar conta' : 'Entrar'}
              onPress={submit}
              loading={loading}
            />
            <Pressable
              accessibilityRole="button"
              onPress={() => router.dismissTo('/')}
              style={({ pressed }) => [styles.home, pressed && styles.pressed]}>
              <Text style={styles.homeText}>Voltar ao início</Text>
            </Pressable>
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </View>
  );
}

function Field({ label, password = false, ...props }: TextInputProps & { label: string; password?: boolean }) {
  const [visible, setVisible] = useState(false);
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View>
        <TextInput
          accessibilityLabel={label}
          placeholderTextColor={Brand.muted}
          selectionColor={Brand.primary}
          secureTextEntry={password && !visible}
          style={[styles.input, password && styles.passwordInput]}
          {...props}
        />
        {password && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={visible ? 'Ocultar senha' : 'Mostrar senha'}
            hitSlop={6}
            onPress={() => setVisible(!visible)}
            style={({ pressed }) => [styles.reveal, pressed && styles.pressed]}>
            <BrandIcon name={visible ? 'eye-off' : 'eye'} size={20} color={Brand.muted} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Brand.background },
  body: { flex: 1 },
  content: {
    flexGrow: 1,
    width: '100%',
    maxWidth: 460,
    alignSelf: 'center',
    paddingHorizontal: Gutter,
    paddingTop: 8,
    paddingBottom: 28,
    gap: 18,
  },
  intro: { alignItems: 'center', gap: 10, paddingBottom: 4 },
  title: {
    alignSelf: 'stretch',
    fontFamily: Fonts.serifMedium,
    fontSize: 27,
    lineHeight: 33,
    color: Brand.text,
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: Fonts.sans,
    fontSize: 14,
    lineHeight: 21,
    color: Brand.muted,
    textAlign: 'center',
    maxWidth: 300,
  },
  modes: {
    flexDirection: 'row',
    padding: 4,
    borderRadius: Radius.pill,
    backgroundColor: Brand.surfaceSoft,
  },
  mode: {
    flex: 1,
    minHeight: 40,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectedMode: { backgroundColor: Brand.primary },
  modeText: { fontFamily: Fonts.sansMedium, fontSize: 13, color: Brand.text },
  selectedModeText: { color: Brand.white },
  form: { gap: 14 },
  field: { gap: 6 },
  label: { fontFamily: Fonts.sansMedium, fontSize: 12.5, color: Brand.text },
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
  passwordInput: { paddingRight: 52 },
  reveal: {
    position: 'absolute',
    right: 6,
    top: 0,
    bottom: 0,
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  home: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  homeText: { fontFamily: Fonts.sansMedium, fontSize: 13, color: Brand.primaryDeep },
  pressed: { opacity: 0.65 },
});
