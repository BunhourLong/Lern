import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { createNativeBottomTabNavigator } from '@react-navigation/bottom-tabs/unstable';
import { isLiquidGlassAvailable } from 'expo-glass-effect';
import type { ImageSourcePropType } from 'react-native';
import type { Edge } from 'react-native-safe-area-context';
import { useT } from '../i18n';
import RouteMessageContainer from '../screens/RouteMessage/RouteMessageContainer';
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
  onDebug,
}: {
  role: Role;
  onDebug?: () => void;
}) {
  const t = useT();
  const names = tabsByRole[role];
  const renderMessage = (name: TabName) => (
    <RouteMessageContainer
      route={name === 'home' ? role : name}
      onDebug={name === 'home' ? onDebug : undefined}
      edges={screenEdges}
    />
  );

  if (tabs.kind === 'native') {
    const { Navigator, Screen } = tabs;
    return (
      <Navigator screenOptions={screenOptions}>
        {names.map(name => (
          <Screen
            key={name}
            name={name}
            options={{
              title: t(`tab.${name}`),
              tabBarIcon: { type: 'image', source: icons[name] },
            }}
          >
            {() => renderMessage(name)}
          </Screen>
        ))}
      </Navigator>
    );
  }

  const { Navigator, Screen } = tabs;
  return (
    <Navigator screenOptions={screenOptions} tabBar={renderTabBar}>
      {names.map(name => (
        <Screen key={name} name={name} options={{ title: t(`tab.${name}`) }}>
          {() => renderMessage(name)}
        </Screen>
      ))}
    </Navigator>
  );
}
