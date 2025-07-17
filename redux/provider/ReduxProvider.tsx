import React, { ReactNode, useEffect } from 'react';
import { Provider } from 'react-redux';
import { PersistGate } from 'redux-persist/integration/react';
import { store, persistor } from '../store';
import { useDispatch } from 'react-redux';
import { setHasHydrated } from '../store/grocerySlice';

interface ReduxProviderProps {
  children: ReactNode;
}

// Component to handle hydration
const HydrationHandler = ({ children }: { children: ReactNode }) => {
  const dispatch = useDispatch();

  useEffect(() => {
    const handleHydration = async () => {
      await persistor.persist();
      dispatch(setHasHydrated(true));
    };
    
    handleHydration();
  }, [dispatch]);

  return <>{children}</>;
};

export const ReduxProvider = ({ children }: ReduxProviderProps) => {
  return (
    <Provider store={store}>
      <PersistGate 
        loading={null} 
        persistor={persistor}
        onBeforeLift={() => {
          // Optional: You can add any pre-hydration logic here
        }}
      >
        <HydrationHandler>
          {children}
        </HydrationHandler>
      </PersistGate>
    </Provider>
  );
};