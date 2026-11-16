import type { Me } from '@lern/contracts';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Button, Text, TextInput } from 'react-native';
import { createActiveRideStore } from '../../stores/active-ride.store';
import { createDriverModeStore } from '../../stores/driver-mode.store';
import { createRawEventsStore } from '../../stores/raw-events.store';
import { createSessionStore } from '../../stores/session.store';
import DebugContainer from './DebugContainer';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

type Props = React.ComponentProps<typeof DebugContainer>;
function stub() {
  const stores = {
    session: createSessionStore(),
    activeRide: createActiveRideStore(),
    driverMode: createDriverModeStore(),
    rawEvents: createRawEventsStore(),
  };
  const core = {
    stores,
    api: { requestOtp: jest.fn(async () => undefined) },
    signIn: jest.fn(async () => undefined),
    signOut: jest.fn(async () => undefined),
    setOnline: jest.fn(async () => undefined),
  };
  return { core, stores };
}
const render = (core: unknown) => {
  let r!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    r = ReactTestRenderer.create(
      <DebugContainer core={core as Props['core']} />,
    );
  });
  return r;
};
const text = (r: ReactTestRenderer.ReactTestRenderer) =>
  r.root
    .findAllByType(Text)
    .map(t => t.props.children)
    .flat()
    .join(' ');
const press = async (r: ReactTestRenderer.ReactTestRenderer, title: string) =>
  act(async () => {
    r.root.findByProps({ title }).props.onPress();
  });
const type = (
  r: ReactTestRenderer.ReactTestRenderer,
  label: string,
  v: string,
) =>
  act(() => {
    r.root.findByProps({ accessibilityLabel: label }).props.onChangeText(v);
  });

it('shows store changes and raw events live', () => {
  const { core, stores } = stub();
  const r = render(core);
  expect(text(r)).toContain('restoring');
  act(() => {
    stores.session.getState().signedIn({ id: 'u-1' } as unknown as Me);
  });
  expect(text(r)).toContain('signed_in');
  act(() => {
    stores.rawEvents.getState().add('ride:updated', { seq: 7 });
  });
  expect(text(r)).toMatch(/ride:updated\s+\{"seq":7\}/);
});

it('sends the typed phone and code to the core', async () => {
  const { core } = stub();
  const r = render(core);
  expect(r.root.findAllByType(TextInput)).toHaveLength(2);
  expect(r.root.findAllByType(Button).length).toBeGreaterThan(0);
  await type(r, 'Phone', '+85598765432');
  await type(r, 'Code', '123456');
  await press(r, 'Send code');
  await press(r, 'Verify');
  await press(r, 'Go online');
  expect(core.api.requestOtp).toHaveBeenCalledWith('+85598765432');
  expect(core.signIn).toHaveBeenCalledWith('+85598765432', '123456');
  expect(core.setOnline).toHaveBeenCalledWith(true);
});

it('logs a rejected command as an error entry instead of throwing', async () => {
  const { core, stores } = stub();
  core.signIn.mockRejectedValue(new Error('nope'));
  const r = render(core);
  await press(r, 'Verify');
  expect(stores.rawEvents.getState().events[0]).toMatchObject({
    event: 'error',
    payload: 'Error: nope',
  });
});
