import { requireNativeModule } from 'expo';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState, View } from 'react-native';
import { PrivacyFrameContext } from '../routes/PrivacyFrame';
import { makeStyles } from '@theme';
import { InteractionContext } from '../hooks/use-interaction';
import type { Core } from './core';
import { followIdleLock } from './idle-lock';

const privacy = requireNativeModule<{
  elapsed(): number;
  invalidate(): number;
  cycle(): Promise<number>;
  reveal(
    cycle: number,
    tag: string,
    locked: boolean,
    deadline: number,
    revision: number,
  ): Promise<void>;
}>('LernPrivacy');

export function SecurityProvider({
  core,
  children,
}: {
  core: Core;
  children(foreground: boolean): ReactNode;
}) {
  const [cycle, setCycle] = useState<number | null>(null);
  const latest = useRef(0);
  const [revision, setRevision] = useState(0);
  const idle = useRef<ReturnType<typeof followIdleLock> | null>(null);
  const interact = useCallback(() => idle.current?.interact() ?? false, []);
  const s = useStyles();
  useEffect(() => {
    let event = 0;
    const tracker = followIdleLock(core, () => privacy.elapsed(), false);
    idle.current = tracker;
    // Invalidate even a frame already submitted to the compositor in this foreground cycle.
    const invalidate = () => {
      latest.current = privacy.invalidate();
      setRevision(latest.current);
    };
    const unwatchSecurity = core.stores.security.subscribe((next, prior) => {
      if (next.locked !== prior.locked) invalidate();
    });
    const unwatchSession = core.stores.session.subscribe((next, prior) => {
      if (next.status !== prior.status || next.me?.id !== prior.me?.id)
        invalidate();
    });
    const unwatchGate = core.stores.appConfig.subscribe((next, prior) => {
      if (next.gate?.status !== prior.gate?.status) invalidate();
    });
    invalidate();
    const change = (state: string | null) => {
      const current = ++event;
      const active = state === 'active';
      tracker.foreground(active);
      if (active) core.refreshAvailability();
      setCycle(null);
      if (active)
        privacy.cycle().then(generation => {
          if (current === event) setCycle(generation);
        });
    };
    const subscription = AppState.addEventListener('change', change);
    change(AppState.currentState ?? null);
    return () => {
      event++;
      unwatchSecurity();
      unwatchSession();
      unwatchGate();
      tracker.stop();
      idle.current = null;
      subscription.remove();
    };
  }, [core]);
  return (
    <InteractionContext.Provider value={interact}>
      <View style={s.root} onTouchStart={interact}>
        <PrivacyFrameContext.Provider
          value={
            cycle === null
              ? null
              : {
                  cycle,
                  revision,
                  acknowledge(tag, locked) {
                    const { stores } = core;
                    const lockVisible =
                      stores.security.getState().locked &&
                      stores.session.getState().status === 'signed_in' &&
                      stores.appConfig.getState().gate?.status === 'ok';
                    if (revision === latest.current && locked === lockVisible)
                      privacy.reveal(
                        cycle,
                        tag,
                        locked,
                        idle.current?.deadline() ?? 0,
                        revision,
                      );
                  },
                }
          }
        >
          {children(cycle !== null)}
        </PrivacyFrameContext.Provider>
      </View>
    </InteractionContext.Provider>
  );
}
const useStyles = makeStyles(() => ({ root: { flex: 1 } }));
