import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { PlayfairDisplay_400Regular } from '@expo-google-fonts/playfair-display/400Regular';
import { PlayfairDisplay_500Medium } from '@expo-google-fonts/playfair-display/500Medium';
import { useFonts } from 'expo-font';
import { DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { Brand, Fonts } from '@/constants/brand';
import { AuthProvider, useAuth } from '@/context/auth';

SplashScreen.preventAutoHideAsync();

const theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: Brand.background,
    card: Brand.card,
    text: Brand.text,
    primary: Brand.primary,
  },
};

export default function RootLayout() {
  const [loaded, error] = useFonts({
    [Fonts.serif]: PlayfairDisplay_400Regular,
    [Fonts.serifMedium]: PlayfairDisplay_500Medium,
    [Fonts.sans]: Inter_400Regular,
    [Fonts.sansMedium]: Inter_500Medium,
    [Fonts.sansSemiBold]: Inter_600SemiBold,
  });

  return (
    <ThemeProvider value={theme}>
      <AuthProvider>
        <RootNavigator fontsReady={loaded || error !== null} />
      </AuthProvider>
    </ThemeProvider>
  );
}

// A tela de abertura permanece até as fontes carregarem e a sessão salva ser recuperada.
function RootNavigator({ fontsReady }: { fontsReady: boolean }) {
  const { ready } = useAuth();
  const appReady = fontsReady && ready;

  useEffect(() => {
    if (appReady) SplashScreen.hide();
  }, [appReady]);

  if (!appReady) return null;

  return (
    <>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{ headerShown: false, contentStyle: { backgroundColor: Brand.background } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="login" options={{ animation: 'slide_from_bottom' }} />
      </Stack>
    </>
  );
}
