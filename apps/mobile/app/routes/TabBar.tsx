import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { CommonActions } from '@react-navigation/native';
import { Image, Pressable, StyleSheet } from 'react-native';
import type { ImageSourcePropType } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { iconSize, makeStyles, opacity, spacing, touch } from '@theme';
import { Text } from '../components/Text';

type Props = Pick<BottomTabBarProps, 'state' | 'descriptors' | 'navigation'> & {
  icons: Readonly<Record<string, ImageSourcePropType>>;
};

export function TabBar({ state, descriptors, navigation, icons }: Props) {
  const styles = useStyles();

  return (
    <SafeAreaView
      accessibilityRole="tablist"
      edges={['bottom', 'left', 'right']}
      style={styles.bar}
    >
      {state.routes.map((route, index) => {
        const selected = state.index === index;
        const label = descriptors[route.key].options.title ?? route.name;

        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityLabel={label}
            accessibilityState={{ selected }}
            onPress={() => {
              const event = navigation.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
              });
              if (!selected && !event.defaultPrevented) {
                navigation.dispatch({
                  ...CommonActions.navigate(route.name, route.params),
                  target: state.key,
                });
              }
            }}
            onLongPress={() => {
              navigation.emit({ type: 'tabLongPress', target: route.key });
            }}
            style={({ pressed }) => [styles.tab, pressed && styles.pressed]}
          >
            <Image
              accessible={false}
              source={icons[route.name]}
              style={[
                styles.icon,
                selected ? styles.selected : styles.unselected,
              ]}
            />
            <Text role="caption" tone={selected ? 'primary' : 'muted'} centered>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </SafeAreaView>
  );
}

const useStyles = makeStyles(t => ({
  bar: {
    flexDirection: 'row',
    backgroundColor: t.colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: t.colors.border,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: touch.min,
    minWidth: touch.min,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.sm,
    gap: spacing.xs,
  },
  icon: { width: iconSize, height: iconSize },
  selected: { tintColor: t.colors.primary },
  unselected: { tintColor: t.colors.textMuted },
  pressed: { opacity: opacity.pressed },
}));
