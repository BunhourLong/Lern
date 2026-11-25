import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { createNativeBottomTabNavigator } from '@react-navigation/bottom-tabs/unstable';
import { isLiquidGlassAvailable } from 'expo-glass-effect';
import type { ImageSourcePropType } from 'react-native';
import type { Edge } from 'react-native-safe-area-context';
import { useInteraction } from '../hooks/use-interaction';
import { useT } from '../i18n';
import DriverStatusContainer from '../screens/DriverStatus/DriverStatusContainer';
import type { DriverStatusActions } from '../screens/DriverStatus/DriverStatusContainer';
import RouteMessageContainer from '../screens/RouteMessage/RouteMessageContainer';
import RouteMessageScreen from '../screens/RouteMessage/RouteMessageScreen';
import { TabBar } from './TabBar';

type Role = 'rider' | 'driver';
type TabName = 'home' | 'activity' | 'earnings' | 'account';
type TabParams = Record<TabName, undefined>;

const tabsByRole: Record<Role, readonly TabName[]> = {
  rider: ['home', 'activity', 'account'],
  driver: ['home', 'earnings', 'account'],
};
const icons: Record<TabName, ImageSourcePropType> = {
  home: require('../assets/icons/home.png'),
  activity: require('../assets/icons/activity.png'),
  earnings: require('../assets/icons/earnings.png'),
  account: require('../assets/icons/account.png'),
};
const screenOptions = { headerShown: false };
const screenEdges: Edge[] = ['top', 'left', 'right'];
const renderTabBar = (props: BottomTabBarProps) => (
  <TabBar {...props} icons={icons} />
);

const tabs = isLiquidGlassAvailable()
  ? { kind: 'native' as const, ...createNativeBottomTabNavigator<TabParams>() }
  : { kind: 'custom' as const, ...createBottomTabNavigator<TabParams>() };

export function RoleTabs({
  role,
  driverStatus,
  onApply,
  onDebug,
  onEnroll,
}: {
  role: Role;
  driverStatus: DriverStatusActions;
  onApply: () => void;
  onDebug?: () => void;
  onEnroll?: () => void;
}) {
  const t = useT();
  const names = tabsByRole[role];
  const interact = useInteraction();
  const listeners = { tabPress: interact };
  const renderTab = (name: TabName) => {
    if (name === 'account')
      return (
        <RouteMessageScreen
          edges={screenEdges}
          title={t('tab.account')}
          body={onEnroll ? undefined : t('pin.enabled')}
          primaryAction={
            role === 'rider'
              ? { label: t('driverApply.title'), onPress: onApply }
              : undefined
          }
          secondaryAction={
            onEnroll && { label: t('pin.title.enroll'), onPress: onEnroll }
          }
        />
      );
    if (name === 'home' && role === 'driver')
      return (
        <DriverStatusContainer
          {...driverStatus}
          onDebug={onDebug}
          edges={screenEdges}
        />
      );
    return (
      <RouteMessageContainer
        route={name === 'home' ? 'rider' : name}
        onDebug={name === 'home' ? onDebug : undefined}
        edges={screenEdges}
      />
    );
  };

  if (tabs.kind === 'native') {
    const { Navigator, Screen } = tabs;
    return (
      <Navigator screenListeners={listeners} screenOptions={screenOptions}>
        {names.map(name => (
          <Screen
            key={name}
            name={name}
            options={{
              title: t(`tab.${name}`),
              tabBarIcon: { type: 'image', source: icons[name] },
            }}
          >
            {() => renderTab(name)}
          </Screen>
        ))}
      </Navigator>
    );
  }

  const { Navigator, Screen } = tabs;
  return (
    <Navigator
      screenListeners={{
        tabPress: e => {
          if (!interact()) e.preventDefault();
        },
      }}
      screenOptions={screenOptions}
      tabBar={renderTabBar}
    >
      {names.map(name => (
        <Screen key={name} name={name} options={{ title: t(`tab.${name}`) }}>
          {() => renderTab(name)}
        </Screen>
      ))}
    </Navigator>
  );
}
