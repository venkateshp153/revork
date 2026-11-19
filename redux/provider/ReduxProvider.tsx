import React, { ReactNode, useEffect } from 'react';
import { Provider, useDispatch } from 'react-redux';
import { store, persistor } from '../store';
import { setHasHydrated } from '../store/grocerySlice';

interface ReduxProviderProps {
  children: ReactNode;
}

// Marks the persisted state as hydrated once redux-persist has finished
// restoring the store from AsyncStorage.
const HydrationHandler = ({ children }: { children: ReactNode }) => {
  const dispatch = useDispatch();

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    const markHydrated = () => {
      dispatch(setHasHydrated(true));
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

    return () => unsubscribe?.();
  }, [dispatch]);

  return <>{children}</>;
};

export const ReduxProvider = ({ children }: ReduxProviderProps) => {
  return (
    <Provider store={store}>
      <HydrationHandler>{children}</HydrationHandler>
    </Provider>
  );
};
