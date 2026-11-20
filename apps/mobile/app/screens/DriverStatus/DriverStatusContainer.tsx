import { useStore } from 'zustand';
import type { Edge } from 'react-native-safe-area-context';
import type { createDriverModeStore } from '../../stores/driver-mode.store';
import DriverStatusScreen from './DriverStatusScreen';

export default function DriverStatusContainer({
  driverMode,
  onDebug,
  edges,
}: {
  driverMode: ReturnType<typeof createDriverModeStore>;
  onDebug?: () => void;
  edges?: Edge[];
}) {
  const verification = useStore(driverMode, state => state.verification);
  return (
    <DriverStatusScreen
      verification={verification}
      onDebug={onDebug}
      edges={edges}
    />
  );
}
