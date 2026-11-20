import { useEffect } from 'react';
import { StatusBar, useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useStore } from 'zustand';
import {
  core,
  refreshLocationPermission,
  requestLocationPermission,
  startApp,
} from './app/boot/app-core';
import { LanguageContext } from './app/i18n';
import { SecurityProvider } from './app/boot/SecurityProvider';
import { RootNavigator } from './app/routes/RootNavigator';
import DebugContainer from './app/screens/Debug/DebugContainer';

function App() {
  const isDarkMode = useColorScheme() === 'dark';
  const language = useStore(core.stores.language, s => s.language);
  useEffect(startApp, []);

  return (
    <LanguageContext.Provider value={language}>
      <SafeAreaProvider>
        <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
        <SecurityProvider core={core}>
          {foreground => (
            <RootNavigator
              foreground={foreground}
              core={core}
              requestLocationPermission={requestLocationPermission}
              refreshLocationPermission={refreshLocationPermission}
              debug={__DEV__ ? <DebugContainer core={core} /> : null}
            />
          )}
        </SecurityProvider>
      </SafeAreaProvider>
    </LanguageContext.Provider>
  );
}

export default App;
