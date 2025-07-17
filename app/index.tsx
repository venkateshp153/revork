import { Redirect } from 'expo-router';
import { useSelector } from 'react-redux';
import { RootState } from '@/redux/store';

export default function Index() {
  const userName = useSelector((state: RootState) => state.user.name);
  
 
  if (userName) {
    return <Redirect href="/(tabs)/home" />;
  }
  
  
  return <Redirect href="/(tabs)/home" />;
}