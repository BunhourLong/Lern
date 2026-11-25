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
import { AndroidMapsContext } from './app/components/AppMap';
import { SyncStatusToastContainer } from './app/components/SyncStatusToastContainer';
import { LanguageContext } from './app/i18n';
import { SecurityProvider } from './app/boot/SecurityProvider';
import { RootNavigator } from './app/routes/RootNavigator';
import DebugContainer from './app/screens/Debug/DebugContainer';

function App({
  androidMapsConfigured = false,
}: { androidMapsConfigured?: boolean } = {}) {
  const isDarkMode = useColorScheme() === 'dark';
  const language = useStore(core.stores.language, s => s.language);
  useEffect(startApp, []);

  return (
    <LanguageContext.Provider value={language}>
      <AndroidMapsContext.Provider value={androidMapsConfigured}>
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
          <SyncStatusToastContainer
            connection={core.stores.connection}
            session={core.stores.session}
          />
        </SafeAreaProvider>
      </AndroidMapsContext.Provider>
    </LanguageContext.Provider>
  );
}

export default App;
