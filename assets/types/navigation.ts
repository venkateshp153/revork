type RootStackParamList = {
  '(tabs)': undefined;
  '(tabs)/home': undefined;
  '(tabs)/workers': undefined;
  '(tabs)/analytics': undefined;
  '(tabs)/notifications': undefined;
  '(tabs)/profile': undefined;
  '(tabs)/list': undefined;
  'worker-details/[id]': { id: string; editMode?: string };
  'profile-modal': undefined;
  splash: undefined;
  '(auth)/login': undefined;
};

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}

export {};
