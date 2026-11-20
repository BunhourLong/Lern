import type { DriverVerification } from '@lern/contracts';
import type { Edge } from 'react-native-safe-area-context';
import { useT } from '../../i18n';
import RouteMessageScreen from '../RouteMessage/RouteMessageScreen';

export default function DriverStatusScreen({
  verification,
  onDebug,
  edges,
}: {
  verification: DriverVerification | null;
  onDebug?: () => void;
  edges?: Edge[];
}) {
  const t = useT();
  const debug = onDebug && { label: t('route.debug'), onPress: onDebug };
  return verification === null ? (
    <RouteMessageScreen
      loadingLabel={t('route.loading')}
      secondaryAction={debug}
      edges={edges}
    />
  ) : (
    <RouteMessageScreen
      title={t(`driverStatus.${verification}.title`)}
      body={t(`driverStatus.${verification}.body`)}
      secondaryAction={debug}
      edges={edges}
    />
  );
}
