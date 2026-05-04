import { Stack, Redirect } from 'expo-router';
import { useSelector } from 'react-redux';
import { RootState } from '@/redux/store';

export default function AuthLayout() {
  const user = useSelector((state: RootState) => state.user);
  
  if (user.isAuthenticated && user.profile) {
    return <Redirect href="/(tabs)/home" />;
  }

  if (user.isAuthenticated && user.isNewUser) {
    return <Redirect href="/profile-modal" />;
  }

  return (
    <Stack>
      <Stack.Screen name="login" options={{ headerShown: false }} />
    </Stack>
  );
}
