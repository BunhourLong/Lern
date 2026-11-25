import {
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
  useNavigationContainerRef,
} from '@react-navigation/native';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { useTheme } from '@theme';
import type { Core } from '../boot/core';
import { InteractionContext } from '../hooks/use-interaction';
import { useT } from '../i18n';
import {
  AppPinContainer,
  type PinActions,
} from '../screens/AppPin/AppPinContainer';
import LoginContainer from '../screens/Login/LoginContainer';
import OtpContainer from '../screens/Otp/OtpContainer';
import RouteMessageContainer from '../screens/RouteMessage/RouteMessageContainer';
import RouteMessageScreen from '../screens/RouteMessage/RouteMessageScreen';
import { type RootStackParams, Stack } from './index';
import { rootRoute } from './root-route';
import { PrivacyFrame } from './PrivacyFrame';
import { RoleTabs } from './RoleTabs';

type Props = {
  core: PinActions & {
    stores: Pick<
      Core['stores'],
      'session' | 'appConfig' | 'notification' | 'security'
    >;
    api: Pick<Core['api'], 'requestOtp'>;
    signIn: Core['signIn'];
  };
  debug: ReactNode;
  foreground?: boolean;
};

export function RootNavigator({ core, debug, foreground = true }: Props) {
  const session = useStore(core.stores.session);
  const gate = useStore(core.stores.appConfig, state => state.gate);
  const notifications = core.stores.notification;
  const notification = useStore(notifications);
  const route = rootRoute(session, gate);
  const signedIn = route === 'rider' || route === 'driver';
  const locked = useStore(core.stores.security, state => state.locked);
  const enabled = useStore(core.stores.security, state => state.enabled);
  const protectedRoutes = signedIn && !locked;
  const pendingAction = useRef<(() => void) | undefined>(undefined);
  const navigationRef = useNavigationContainerRef<RootStackParams>();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (
      ready &&
      foreground &&
      signedIn &&
      !locked &&
      notification &&
      notifications.getState() === notification
    ) {
      notifications.setState(null, true);
      navigationRef.navigate('NotificationStatus', notification);
    }
  }, [
    navigationRef,
    notification,
    notifications,
    ready,
    signedIn,
    locked,
    foreground,
  ]);

  useEffect(() => {
    if (!foreground && pendingAction.current) {
      pendingAction.current = undefined;
      if (navigationRef.getCurrentRoute()?.name === 'ConfirmPin')
        navigationRef.goBack();
    }
  }, [foreground, navigationRef]);
  const requireAuth = (action: () => void) => {
    if (!core.stores.security.getState().enabled) return action();
    pendingAction.current = action;
    navigationRef.navigate('ConfirmPin');
  };
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
  const showDebug = __DEV__ && (route === 'login' || protectedRoutes);
  const storeUrl =
    gate?.status === 'update_required' ? gate.storeUrl : undefined;

  return (
    <NavigationContainer
      theme={theme}
      ref={navigationRef}
      onReady={() => setReady(true)}
    >
      <Stack.Navigator screenOptions={screenOptions} screenLayout={routeLayout}>
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
        {signedIn && locked && (
          <Stack.Screen
            name="AppLock"
            options={{ animation: 'none', gestureEnabled: false }}
          >
            {() => (
              <InteractionContext.Provider value={() => foreground}>
                <AppPinContainer mode="unlock" core={core} />
              </InteractionContext.Provider>
            )}
          </Stack.Screen>
        )}
        {protectedRoutes && (
          <Stack.Group navigationKey={`${route}:${session.me?.id}`}>
            <Stack.Screen name={route}>
              {({ navigation }) => (
                <RoleTabs
                  role={route}
                  onEnroll={
                    enabled ? undefined : () => navigation.navigate('EnrollPin')
                  }
                  onDebug={
                    showDebug
                      ? () => requireAuth(() => navigation.navigate('Debug'))
                      : undefined
                  }
                />
              )}
            </Stack.Screen>
            <Stack.Screen name="EnrollPin">
              {({ navigation }) => (
                <AppPinContainer
                  core={core}
                  mode="enroll"
                  onCancel={navigation.goBack}
                  onSuccess={navigation.goBack}
                />
              )}
            </Stack.Screen>
            <Stack.Screen
              name="ConfirmPin"
              listeners={{
                blur: () => {
                  pendingAction.current = undefined;
                  core.interruptPinCheck();
                },
              }}
            >
              {({ navigation }) => (
                <AppPinContainer
                  core={core}
                  mode="confirm"
                  onCancel={navigation.goBack}
                  onSuccess={() => {
                    const action = pendingAction.current;
                    pendingAction.current = undefined;
                    navigation.goBack();
                    action?.();
                  }}
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
            navigationKey={`${route}:${session.me?.id}`}
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

const routeLayout = ({ children }: { children: ReactNode }) => (
  <PrivacyFrame>{children}</PrivacyFrame>
);
