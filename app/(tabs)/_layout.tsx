import { Tabs, useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { StyleSheet, Animated, View } from 'react-native';
import { useRef } from 'react';
import { Colors } from '@/assets/constants/colors';
import { useSelector } from 'react-redux';
import { RootState } from '@/redux/store';

export default function TabLayout() {
  const router = useRouter();
  const homeAnim = useRef(new Animated.Value(1)).current;
  const listAnim = useRef(new Animated.Value(1)).current;
  const userName = useSelector((state: RootState) => state.user.name);

  if (!userName) {
    router.replace('/(auth)');
  }

  const animateTab = (anim: Animated.Value) => {
    anim.setValue(0.92);
    Animated.spring(anim, {
      toValue: 1,
      useNativeDriver: true,
    }).start();
  };

  return (
    <View style={styles.container}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarHideOnKeyboard: true,
          tabBarActiveTintColor: Colors.primary,
          tabBarInactiveTintColor: '#c3c9d1ff',
          tabBarStyle: styles.tabBar,
          tabBarLabelStyle: styles.label,
          tabBarItemStyle: styles.tabItem,
        }}
      >
        <Tabs.Screen
          name="home"
          listeners={{
            tabPress: () => animateTab(homeAnim),
          }}
          options={{
            tabBarLabel: ({ focused, color }) => (
              <Animated.Text
                style={[
                  styles.label,
                  {
                    color,
                    transform: [{ scale: focused ? homeAnim : 1 }],
                    opacity: homeAnim.interpolate({
                      inputRange: [0.92, 1],
                      outputRange: [0.9, 1]
                    })
                  }
                ]}
              >
                Home
              </Animated.Text>
            ),
            tabBarIcon: ({ focused, color }) => (
              <Animated.View style={{
                transform: [{ scale: homeAnim }],
                opacity: homeAnim.interpolate({
                  inputRange: [0.92, 1],
                  outputRange: [0.95, 1]
                })
              }}>
                <MaterialCommunityIcons
                  name={focused ? 'home' : 'home-outline'}
                  size={28}
                  color={color}
                />
              </Animated.View>
            ),
          }}
        />
        <Tabs.Screen
          name="list"
          listeners={{
            tabPress: () => animateTab(listAnim),
          }}
          options={{
            tabBarLabel: ({ focused, color }) => (
              <Animated.Text
                style={[
                  styles.label,
                  {
                    color,
                    transform: [{ scale: focused ? listAnim : 1 }],
                    opacity: listAnim.interpolate({
                      inputRange: [0.92, 1],
                      outputRange: [0.9, 1]
                    })
                  }
                ]}
              >
                List
              </Animated.Text>
            ),
            tabBarIcon: ({ focused, color }) => (
              <Animated.View style={{
                transform: [{ scale: listAnim }],
                opacity: listAnim.interpolate({
                  inputRange: [0.92, 1],
                  outputRange: [0.95, 1]
                })
              }}>
                <MaterialCommunityIcons
                  name={focused ? 'format-list-bulleted' : 'format-list-bulleted'}
                  size={28}
                  color={color}
                />
              </Animated.View>
            ),
          }}
        />
      </Tabs>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    marginHorizontal: 1,
    marginBottom: 12,
    overflow: 'visible',
    backgroundColor: Colors.background
  },
  tabBar: {
    height: 72,
    borderRadius: 24,
    marginTop: 8,
    backgroundColor: '#e7e7e7ff',
    borderTopWidth: 0,
    elevation: 12,
    shadowColor: Colors.primary,
    shadowOpacity: 0.25,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    overflow: 'hidden',
  },
  tabItem: {
    height: 72,
    paddingVertical: 8,
  },
  label: {
    fontSize: 11.5,
    fontWeight: '700',
    letterSpacing: 0.4,
    marginTop: 6,
    marginBottom: 4,
    includeFontPadding: false,
  },
});