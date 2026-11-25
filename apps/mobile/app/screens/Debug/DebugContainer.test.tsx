import type { Me } from '@lern/contracts';
import {
  fireEvent,
  render as renderScreen,
  screen,
} from '@testing-library/react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Button, Text, TextInput } from 'react-native';
import { createActiveRideStore } from '../../stores/active-ride.store';
import { createDriverModeStore } from '../../stores/driver-mode.store';
import { createLanguageStore } from '../../stores/language.store';
import { createRawEventsStore } from '../../stores/raw-events.store';
import { createSessionStore } from '../../stores/session.store';
import { InteractionContext } from '../../hooks/use-interaction';
import DebugContainer from './DebugContainer';

jest.mock('expo-glass-effect', () => ({
  GlassView: 'GlassView',
  isGlassEffectAPIAvailable: () => false,
  isLiquidGlassAvailable: () => false,
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

type Props = React.ComponentProps<typeof DebugContainer>;
function stub() {
  const stores = {
    session: createSessionStore(),
    activeRide: createActiveRideStore(),
    driverMode: createDriverModeStore(),
    language: createLanguageStore(
      { get: () => undefined, set: jest.fn(), remove: jest.fn() },
      () => 'en-US',
    ),
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

it('shows Khmer in the type samples', () => {
  const { core } = stub();
  const r = render(core);
  expect(text(r)).toContain('Book a tuk-tuk · កក់តុកតុក');
  expect(text(r)).toContain('Fare 12,000 ៛ · តម្លៃ ១២,០០០ ៛');
});

it('sets the language override when the Khmer button is pressed', async () => {
  const { core, stores } = stub();
  await renderScreen(
    <DebugContainer core={core as unknown as Props['core']} />,
  );
  await fireEvent.press(screen.getByRole('button', { name: 'ខ្មែរ' }));
  expect(stores.language.getState().override).toBe('km');
});

it('marks the current language choice as selected', async () => {
  const { core } = stub();
  await renderScreen(
    <DebugContainer core={core as unknown as Props['core']} />,
  );
  expect(screen.getByRole('button', { name: 'Phone' })).toBeSelected();
  await fireEvent.press(screen.getByRole('button', { name: 'ខ្មែរ' }));
  expect(screen.getByRole('button', { name: 'ខ្មែរ' })).toBeSelected();
  expect(screen.getByRole('button', { name: 'Phone' })).not.toBeSelected();
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
  expect(
    r.root
      .findAllByType(TextInput)
      .map(input => input.props.accessibilityLabel),
  ).toEqual(expect.arrayContaining(['Phone', 'Code']));
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

it('ignores an expired accessible action or keyboard edit in Debug', async () => {
  const { core } = stub();
  await renderScreen(
    <InteractionContext.Provider value={() => false}>
      <DebugContainer core={core as unknown as Props['core']} />
    </InteractionContext.Provider>,
  );
  await fireEvent.changeText(screen.getByLabelText('Phone'), '+85598765432');
  expect(screen.getByLabelText('Phone').props.value).toBe('+85512345678');
  await fireEvent.press(screen.getByRole('button', { name: 'Go online' }));
  expect(core.setOnline).not.toHaveBeenCalled();
});
