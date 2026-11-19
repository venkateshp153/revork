import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  StatusBar,
  Animated,
  Easing,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useSelector } from 'react-redux';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { RootState, persistor } from '@/redux/store';

// Keep the splash visible long enough for the entrance animation to play.
const MIN_SPLASH_TIME = 1800;
// Safety net: never block the user forever if hydration fails.
const HYDRATION_TIMEOUT = 6000;

export default function SplashScreen() {
  const router = useRouter();
  const user = useSelector((state: RootState) => state.user);

  const [storeHydrated, setStoreHydrated] = useState(
    () => persistor.getState().bootstrapped
  );
  const [minTimePassed, setMinTimePassed] = useState(false);
  const [hydrationTimedOut, setHydrationTimedOut] = useState(false);
  const navigatedRef = useRef(false);

  // Entrance animations
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const logoScale = useRef(new Animated.Value(0.82)).current;
  const textOpacity = useRef(new Animated.Value(0)).current;
  const textTranslate = useRef(new Animated.Value(18)).current;

  // Ambient pulse ring behind the logo
  const ringScale = useRef(new Animated.Value(0.9)).current;
  const ringOpacity = useRef(new Animated.Value(0.45)).current;

  // Loading dots
  const dot1 = useRef(new Animated.Value(0)).current;
  const dot2 = useRef(new Animated.Value(0)).current;
  const dot3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.timing(logoOpacity, {
          toValue: 1,
          duration: 550,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.spring(logoScale, {
          toValue: 1,
          friction: 6,
          tension: 70,
          useNativeDriver: true,
        }),
      ]),
      Animated.parallel([
        Animated.timing(textOpacity, {
          toValue: 1,
          duration: 450,
          useNativeDriver: true,
        }),
        Animated.timing(textTranslate, {
          toValue: 0,
          duration: 450,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
    ]).start();

    const pulseLoop = Animated.loop(
      Animated.parallel([
        Animated.timing(ringScale, {
          toValue: 1.35,
          duration: 1600,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(ringOpacity, {
          toValue: 0,
          duration: 1600,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );
    pulseLoop.start();

    const dotsLoop = Animated.loop(
      Animated.stagger(
        170,
        [dot1, dot2, dot3].map((dot) =>
          Animated.sequence([
            Animated.timing(dot, {
              toValue: 1,
              duration: 320,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }),
            Animated.timing(dot, {
              toValue: 0,
              duration: 320,
              easing: Easing.in(Easing.cubic),
              useNativeDriver: true,
            }),
          ])
        )
      )
    );
    dotsLoop.start();

    return () => {
      pulseLoop.stop();
      dotsLoop.stop();
    };
  }, [
    logoOpacity,
    logoScale,
    textOpacity,
    textTranslate,
    ringScale,
    ringOpacity,
    dot1,
    dot2,
    dot3,
  ]);

  // Wait for redux-persist to finish restoring the saved user from storage.
  // While this is running the splash stays visible with its loading dots.
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    const markHydrated = () => {
      setStoreHydrated(true);
      unsubscribe?.();
    };

    if (persistor.getState().bootstrapped) {
      markHydrated();
    } else {
      unsubscribe = persistor.subscribe(() => {
        if (persistor.getState().bootstrapped) {
          markHydrated();
        }
      });
    }

    const minTimer = setTimeout(() => setMinTimePassed(true), MIN_SPLASH_TIME);
    const timeoutTimer = setTimeout(
      () => setHydrationTimedOut(true),
      HYDRATION_TIMEOUT
    );

    return () => {
      unsubscribe?.();
      clearTimeout(minTimer);
      clearTimeout(timeoutTimer);
    };
  }, []);

  // Only once the store is ready (or timed out) do we decide where to go.
  useEffect(() => {
    const storeReady = storeHydrated || hydrationTimedOut;
    if (!storeReady || !minTimePassed || navigatedRef.current) return;

    navigatedRef.current = true;

    if (!user.isAuthenticated) {
      router.replace('/(auth)/login');
    } else if (user.profile || user.workerProfile) {
      router.replace('/(tabs)/home');
    } else if (user.isNewUser) {
      router.replace('/profile-modal');
    } else {
      router.replace('/(auth)/login');
    }
  }, [
    storeHydrated,
    hydrationTimedOut,
    minTimePassed,
    user.isAuthenticated,
    user.profile,
    user.workerProfile,
    user.isNewUser,
    router,
  ]);

  const renderDot = (dot: Animated.Value) => (
    <Animated.View
      style={[
        styles.dot,
        {
          opacity: dot.interpolate({
            inputRange: [0, 1],
            outputRange: [0.25, 1],
          }),
          transform: [
            {
              translateY: dot.interpolate({
                inputRange: [0, 1],
                outputRange: [0, -5],
              }),
            },
          ],
        },
      ]}
    />
  );

  const storeReady = storeHydrated || hydrationTimedOut;
  const statusMessage = storeReady
    ? 'Loading your workspace…'
    : 'Restoring your session…';

  return (
    <>
      <StatusBar hidden={true} />
      <View style={styles.container}>
        {/* Soft background accents */}
        <View style={styles.blobTop} />
        <View style={styles.blobBottom} />

        <SafeAreaView style={styles.safeArea}>
          <View style={styles.center}>
            <Animated.View
              style={[
                styles.logoWrap,
                { opacity: logoOpacity, transform: [{ scale: logoScale }] },
              ]}
            >
              <Animated.View
                style={[
                  styles.pulseRing,
                  { opacity: ringOpacity, transform: [{ scale: ringScale }] },
                ]}
              />
              <View style={styles.logoCard}>
                <Image
                  source={require('@/assets/images/icon.png')}
                  style={styles.logo}
                  resizeMode="contain"
                />
              </View>
            </Animated.View>

            <Animated.View
              style={[
                styles.textBlock,
                {
                  opacity: textOpacity,
                  transform: [{ translateY: textTranslate }],
                },
              ]}
            >
              <Text style={styles.title}>Revork</Text>
              <Text style={styles.subtitle}>Your workforce, simplified.</Text>
            </Animated.View>
          </View>

          <Animated.View style={[styles.footer, { opacity: textOpacity }]}>
            <Text style={styles.statusText}>{statusMessage}</Text>
            <View style={styles.dotsRow}>
              {renderDot(dot1)}
              {renderDot(dot2)}
              {renderDot(dot3)}
            </View>
            <View style={styles.secureRow}>
              <MaterialCommunityIcons name="shield-check-outline" size={13} color="#8A9A93" />
              <Text style={styles.secureText}>Secure workspace by Revork</Text>
            </View>
          </Animated.View>
        </SafeAreaView>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
  },
  safeArea: {
    flex: 1,
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 32,
  },
  blobTop: {
    position: 'absolute',
    top: -140,
    right: -110,
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: '#00AF5B',
    opacity: 0.08,
  },
  blobBottom: {
    position: 'absolute',
    bottom: -170,
    left: -130,
    width: 360,
    height: 360,
    borderRadius: 180,
    backgroundColor: '#00AF5B',
    opacity: 0.06,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoWrap: {
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 34,
  },
  pulseRing: {
    position: 'absolute',
    width: 168,
    height: 168,
    borderRadius: 84,
    borderWidth: 2,
    borderColor: '#00AF5B',
  },
  logoCard: {
    width: 148,
    height: 148,
    borderRadius: 42,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 14,
    shadowColor: '#0B3D28',
    shadowOpacity: 0.14,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 10,
    borderWidth: 1,
    borderColor: '#EAF7F0',
    overflow: 'hidden',
  },
  logo: {
    width: '100%',
    height: '100%',
  },
  textBlock: {
    alignItems: 'center',
  },
  title: {
    fontSize: 36,
    fontWeight: '800',
    color: '#0E1F17',
    letterSpacing: 0.6,
  },
  subtitle: {
    marginTop: 8,
    fontSize: 15,
    color: '#6B7C74',
    letterSpacing: 0.3,
  },
  footer: {
    alignItems: 'center',
    marginBottom: 12,
  },
  statusText: {
    fontSize: 13,
    color: '#4B5F55',
    letterSpacing: 0.3,
    marginBottom: 18,
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 14,
    marginBottom: 22,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#00AF5B',
    marginHorizontal: 4,
  },
  secureRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  secureText: {
    marginLeft: 6,
    fontSize: 12,
    color: '#8A9A93',
    letterSpacing: 0.3,
  },
});
