import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Platform, View, Text } from 'react-native';
import { ReduxProvider } from '@/redux/provider/ReduxProvider';
import { ErrorBoundary } from 'react-error-boundary';

function ErrorFallback({ error }: { error: any }) {
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
      <Text style={{ fontSize: 18, fontWeight: 'bold', color: 'red' }}>Something went wrong</Text>
      <Text style={{ textAlign: 'center', marginTop: 10 }}>{error?.message || 'An unexpected error occurred'}</Text>
    </View>
  );
}

export default function RootLayout() {
  return (
    <ReduxProvider>
      <ErrorBoundary FallbackComponent={ErrorFallback}>
        <StatusBar style={Platform.OS === 'ios' ? 'dark' : 'light'} hidden={true} />
        <Stack>
          <Stack.Screen name="(auth)" options={{ headerShown: false }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        </Stack>
      </ErrorBoundary>
    </ReduxProvider>
  );
}
