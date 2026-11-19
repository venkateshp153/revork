import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Platform, View, Text } from 'react-native';
import { ReduxProvider } from '@/redux/provider/ReduxProvider';
import { ErrorBoundary } from 'react-error-boundary';
import SyncManager from '@/components/SyncManager';
import ProofWatermarkHost from '@/components/ProofWatermarkHost';

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
        <SyncManager />
        <ProofWatermarkHost />
        <Stack>
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="splash" options={{ headerShown: false }} />
          <Stack.Screen name="(auth)" options={{ headerShown: false }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="worker-details/[id]" options={{ headerShown: false }} />
          <Stack.Screen name="clock-history" options={{ headerShown: false }} />
          <Stack.Screen name="team-status" options={{ headerShown: false }} />
          <Stack.Screen name="profile-modal" options={{ headerShown: false }} />
          <Stack.Screen name="admin-dashboard" options={{ headerShown: false }} />
          <Stack.Screen name="admin-summary" options={{ headerShown: false }} />
          <Stack.Screen name="assign-schedule" options={{ headerShown: false }} />
          <Stack.Screen name="delivery-proofs" options={{ headerShown: false }} />
          <Stack.Screen name="delivery-settings" options={{ headerShown: false }} />
          <Stack.Screen name="delivery-locations" options={{ headerShown: false }} />
          <Stack.Screen name="delivery-team" options={{ headerShown: false }} />
        </Stack>
      </ErrorBoundary>
    </ReduxProvider>
  );
}
