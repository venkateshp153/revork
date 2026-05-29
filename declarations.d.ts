declare module 'react-native-safe-area-context' {
  import { ComponentType, ReactNode } from 'react';
  import { ViewProps, ViewStyle } from 'react-native';

  export interface EdgeInsets {
    top: number;
    right: number;
    bottom: number;
    left: number;
  }

  export interface SafeAreaProviderProps {
    initialMetrics?: EdgeInsets | null;
    children?: ReactNode;
    style?: ViewStyle;
  }

  export const SafeAreaProvider: ComponentType<SafeAreaProviderProps>;
  export const SafeAreaConsumer: ComponentType<{
    children: (insets: EdgeInsets) => ReactNode;
  }>;
  export const SafeAreaView: ComponentType<ViewProps>;
  export function useSafeAreaInsets(): EdgeInsets;
  export function useSafeAreaFrame(): { x: number; y: number; width: number; height: number };
}
