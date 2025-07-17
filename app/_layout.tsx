import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Platform } from 'react-native';
import { ReduxProvider } from '@/redux/provider/ReduxProvider';

export default function RootLayout() {
  return (
    <ReduxProvider>
      <StatusBar style={Platform.OS === 'ios' ? 'dark' : 'light'} hidden={true} />
      <Stack>
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      </Stack>
    </ReduxProvider>
  );
}