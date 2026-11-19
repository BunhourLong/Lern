import {
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
  useNavigationContainerRef,
} from '@react-navigation/native';
import { type ReactNode, useEffect, useState } from 'react';
import { useStore } from 'zustand';
import { useTheme } from '@theme';
import type { Core } from '../boot/core';
import { useT } from '../i18n';
import LoginContainer from '../screens/Login/LoginContainer';
import OtpContainer from '../screens/Otp/OtpContainer';
import RouteMessageContainer from '../screens/RouteMessage/RouteMessageContainer';
import RouteMessageScreen from '../screens/RouteMessage/RouteMessageScreen';
import { type RootStackParams, Stack } from './index';
import { rootRoute } from './root-route';
import { RoleTabs } from './RoleTabs';

type Props = {
  core: {
    stores: Pick<Core['stores'], 'session' | 'appConfig' | 'notification'>;
    api: Pick<Core['api'], 'requestOtp'>;
    signIn: Core['signIn'];
  };
  debug: ReactNode;
};

export function RootNavigator({ core, debug }: Props) {
  const session = useStore(core.stores.session);
  const gate = useStore(core.stores.appConfig, state => state.gate);
  const notifications = core.stores.notification;
  const notification = useStore(notifications);
  const route = rootRoute(session, gate);
  const signedIn = route === 'rider' || route === 'driver';
  const navigationRef = useNavigationContainerRef<RootStackParams>();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (
      ready &&
      signedIn &&
      notification &&
      notifications.getState() === notification
    ) {
      notifications.setState(null, true);
      navigationRef.navigate('NotificationStatus', notification);
    }
  }, [navigationRef, notification, notifications, ready, signedIn]);

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
    <NavigationContainer
      theme={theme}
      ref={navigationRef}
      onReady={() => setReady(true)}
    >
      <Stack.Navigator screenOptions={screenOptions}>
        {route === 'login' && (
          <Stack.Group>
            <Stack.Screen
              name="login"
              options={{ headerShown: true, title: t('route.login.title') }}
            >
              {({ navigation }) => (
                <LoginContainer
                  requestOtp={core.api.requestOtp}
                  onSent={params => navigation.navigate('Otp', params)}
                  onDebug={
                    showDebug ? () => navigation.navigate('Debug') : undefined
                  }
                />
              )}
            </Stack.Screen>
            <Stack.Screen
              name="Otp"
              options={{
                headerShown: true,
                title: t('otp.title'),
                headerBackTitle: t('route.back'),
              }}
            >
              {({ route: { params } }) => (
                <OtpContainer
                  {...params}
                  requestOtp={core.api.requestOtp}
                  signIn={core.signIn}
                />
              )}
            </Stack.Screen>
          </Stack.Group>
        )}
        {signedIn && (
          <Stack.Group navigationKey={`${route}:${session.me?.id}`}>
            <Stack.Screen name={route}>
              {({ navigation }) => (
                <RoleTabs
                  role={route}
                  onDebug={
                    showDebug ? () => navigation.navigate('Debug') : undefined
                  }
                />
              )}
            </Stack.Screen>
            <Stack.Screen
              name="NotificationStatus"
              options={({ route: { params } }) => ({
                headerShown: true,
                title: t(`notification.${params.type}`),
                headerBackTitle: t('route.back'),
              })}
            >
              {({ route: { params } }) => (
                <RouteMessageScreen
                  edges={['left', 'right', 'bottom']}
                  title={t(
                    params.type === 'offer'
                      ? 'notification.offer.pending'
                      : `notification.ride.${params.status}`,
                  )}
                />
              )}
            </Stack.Screen>
          </Stack.Group>
        )}
        {(route === 'loading' ||
          route === 'maintenance' ||
          route === 'update') && (
          <Stack.Group>
            <Stack.Screen name={route}>
              {() => (
                <RouteMessageContainer route={route} storeUrl={storeUrl} />
              )}
            </Stack.Screen>
          </Stack.Group>
        )}
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
