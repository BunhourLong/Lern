import { useEffect } from 'react';
import { StatusBar, useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useStore } from 'zustand';
import { core, startApp } from './app/boot/app-core';
import { LanguageContext } from './app/i18n';
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
        <RootNavigator
          core={core}
          debug={__DEV__ ? <DebugContainer core={core} /> : null}
        />
      </SafeAreaProvider>
    </LanguageContext.Provider>
  );
}

export default App;
