import { useRef, useState } from 'react';
import { Linking } from 'react-native';
import type { Edge } from 'react-native-safe-area-context';
import { useT } from '../../i18n';
import type { StringKey } from '../../i18n';
import type { RootRoute } from '../../routes/root-route';
import RouteMessageScreen from './RouteMessageScreen';

type MessageRoute =
  | Exclude<RootRoute, 'login'>
  | 'activity'
  | 'earnings'
  | 'account';

type Props = {
  route: MessageRoute;
  storeUrl?: string;
  onDebug?: () => void;
  edges?: Edge[];
};

const messages = {
  maintenance: {
    title: 'route.maintenance.title',
    body: 'route.maintenance.body',
  },
  update: { title: 'route.update.title', body: 'route.update.body' },
  driver: { title: 'route.driver.title' },
  rider: { title: 'route.rider.title' },
  activity: { title: 'tab.activity', body: 'tab.comingSoon' },
  earnings: { title: 'tab.earnings', body: 'tab.comingSoon' },
  account: { title: 'tab.account', body: 'tab.comingSoon' },
} satisfies Record<
  Exclude<MessageRoute, 'loading'>,
  { title: StringKey; body?: StringKey }
>;

export default function RouteMessageContainer({
  route,
  storeUrl,
  onDebug,
  edges,
}: Props) {
  const t = useT();
  const opening = useRef(false);
  const [updateState, setUpdateState] = useState<'idle' | 'opening' | 'failed'>(
    'idle',
  );

  if (route === 'loading')
    return (
      <RouteMessageScreen loadingLabel={t('route.loading')} edges={edges} />
    );

  const message = messages[route];
  const openStore = async () => {
    if (!storeUrl || opening.current) return;
    opening.current = true;
    setUpdateState('opening');
    try {
      await Linking.openURL(storeUrl);
      setUpdateState('idle');
    } catch {
      setUpdateState('failed');
    } finally {
      opening.current = false;
    }
  };
  const updateAction =
    route === 'update'
      ? {
          label: t('route.update.openStore'),
          onPress: () => {
            openStore();
          },
          loading: updateState === 'opening',
          error: updateState === 'failed' ? t('route.update.error') : undefined,
        }
      : undefined;

  return (
    <RouteMessageScreen
      edges={edges}
      title={t(message.title)}
      body={'body' in message ? t(message.body) : undefined}
      updateAction={updateAction}
      secondaryAction={
        onDebug ? { label: t('route.debug'), onPress: onDebug } : undefined
      }
    />
  );
}
