// shortcut: throwaway debug screen (PLAN.md M5.9), the only screen until the real UI replaces it
import { useEffect } from 'react';
import { StatusBar, useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { core, startApp } from './app/boot/app-core';
import DebugContainer from './app/screens/Debug/DebugContainer';

function App() {
  const isDarkMode = useColorScheme() === 'dark';
  useEffect(startApp, []);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
      <DebugContainer core={core} />
    </SafeAreaProvider>
  );
}

export default App;
