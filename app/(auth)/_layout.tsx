import { Stack, Redirect } from 'expo-router';
import { useSelector } from 'react-redux';
import { RootState } from '@/redux/store';

export default function AuthLayout() {
  const userName = useSelector((state: RootState) => state.user.name);
  
  if (userName) {
    return <Redirect href="/(tabs)/home" />;
  }

  return (
    <Stack>
      <Stack.Screen name="index" options={{ headerShown: false }} />
    </Stack>
  );
}