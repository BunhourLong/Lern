import {
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
} from '@react-navigation/native';
import type { ReactNode } from 'react';
import { useStore } from 'zustand';
import { useTheme } from '@theme';
import type { Core } from '../boot/core';
import { useT } from '../i18n';
import RouteMessageContainer from '../screens/RouteMessage/RouteMessageContainer';
import { Stack } from './index';
import { rootRoute } from './root-route';

type Props = {
  core: { stores: Pick<Core['stores'], 'session' | 'appConfig'> };
  debug: ReactNode;
};

export function RootNavigator({ core, debug }: Props) {
  const session = useStore(core.stores.session);
  const gate = useStore(core.stores.appConfig, state => state.gate);
  const route = rootRoute(session, gate);
  const { colors, dark } = useTheme();
  const t = useT();
  const base = dark ? DarkTheme : DefaultTheme;
  const theme = {
    ...base,
    colors: {
      primary: colors.primary,
      background: colors.background,
      card: colors.surface,
      text: colors.text,
      border: colors.border,
      notification: colors.danger,
    },
  };
  const showDebug =
    __DEV__ && (route === 'login' || route === 'rider' || route === 'driver');
  const storeUrl =
    gate?.status === 'update_required' ? gate.storeUrl : undefined;

  return (
    <NavigationContainer theme={theme}>
      <Stack.Navigator screenOptions={screenOptions}>
        <Stack.Screen name={route}>
          {({ navigation }) => (
            <RouteMessageContainer
              route={route}
              storeUrl={storeUrl}
              onDebug={
                showDebug ? () => navigation.navigate('Debug') : undefined
              }
            />
          )}
        </Stack.Screen>
        {showDebug && (
          <Stack.Screen
            name="Debug"
            navigationKey={route}
            options={{
              headerShown: true,
              title: t('route.debug'),
              headerBackTitle: t('route.back'),
            }}
          >
            {() => debug}
          </Stack.Screen>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const screenOptions = { headerShown: false };
