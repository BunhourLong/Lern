import { useIsFocused, useRoute } from '@react-navigation/native';
import { createContext, useContext, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

export const PrivacyFrameContext = createContext<{
  cycle: number;
  revision: number;
  acknowledge(tag: string, locked: boolean): void;
} | null>(null);

// A marker inside the focused native screen lets the cover wait for that screen's frame.
// Key only the marker so returning to a form keeps its fields and scroll position.
export function PrivacyFrame({ children }: { children: ReactNode }) {
  const handoff = useContext(PrivacyFrameContext);
  const focused = useIsFocused();
  const route = useRoute();
  const tag =
    handoff && focused
      ? `privacy-${handoff.cycle}-${route.key}-${handoff.revision}`
      : undefined;
  return (
    <>
      {children}
      {tag && handoff && (
        <View
          key={tag}
          testID={tag}
          collapsable={false}
          pointerEvents="none"
          style={StyleSheet.absoluteFill}
          onLayout={() => handoff.acknowledge(tag, route.name === 'AppLock')}
        />
      )}
    </>
  );
}
