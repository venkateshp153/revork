// types/navigation.d.ts
type RootStackParamList = {
  '(tabs)': undefined;
  '(tabs)/home': undefined;
  '(tabs)/list': undefined;
};

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}