import { fireEvent, render, screen } from '@testing-library/react-native';
import { Platform, useColorScheme } from 'react-native';
import { mapPinBorderWidth, themes, touch } from '@theme';
import { InteractionContext } from '../../../hooks/use-interaction';
import { RiderRideCard, RideProgressBar } from './RiderRideCard';

jest.mock('expo-glass-effect', () => ({ isLiquidGlassAvailable: () => false }));
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  default: jest.fn(),
}));

beforeEach(() => {
  jest.replaceProperty(Platform, 'OS', 'ios');
  jest.mocked(useColorScheme).mockReturnValue('light');
});
afterEach(() => jest.restoreAllMocks());

const steps = [
  { key: 'searching', label: 'កំពុងស្វែងរក' },
  { key: 'driver_assigned', label: 'បានរកឃើញ' },
  { key: 'driver_arrived', label: 'បានមកដល់' },
  { key: 'in_progress', label: 'កំពុងធ្វើដំណើរ' },
  { key: 'completed', label: 'បានបញ្ចប់' },
] as const;
const summary = {
  statusTitle: 'Driver arrived',
  pickupLabel: 'Pickup',
  pickupSummary: 'Independence Monument',
  dropoffLabel: 'Dropoff',
  dropoffSummary: 'Central Market',
  fare: '5,000 ៛',
  approxUsd: '≈ $1.25',
  vehicle: 'Vehicle type: Moto',
};
const cancel = {
  open: true,
  openLabel: 'Cancel ride',
  prompt: 'Choose a reason to cancel',
  reasons: [{ value: 'other' as const, label: 'Other' }],
  selected: 'other' as const,
  confirmLabel: 'Confirm cancellation',
  keepLabel: 'Keep ride',
  disabled: false,
  loading: false,
  error: 'Try again',
  onOpen: jest.fn(),
  onSelect: jest.fn(),
  onConfirm: jest.fn(),
  onKeep: jest.fn(),
};
const map = {
  center: { lat: 11, lng: 104 },
  delta: 0.01,
  pins: [],
  label: 'Open live ride map',
  unavailableLabel: 'Map unavailable',
  hintLabel: 'Tap map to view full screen',
  onOpen: jest.fn(),
};
const button = (name: string) => screen.getByRole('button', { name });

test('shows five themed progress segments and non-color completion marks in Khmer', async () => {
  jest.mocked(useColorScheme).mockReturnValue('dark');
  const { rerender } = await render(
    <RideProgressBar
      steps={steps}
      currentIndex={2}
      accessibilityLabel="ជំហានទី 3"
    />,
  );
  const progress = screen.getByRole('progressbar', { name: 'ជំហានទី 3' });
  expect(progress).toHaveProp('accessibilityValue', {
    min: 1,
    max: 5,
    now: 3,
    text: 'ជំហានទី 3',
  });
  expect(progress.children).toHaveLength(5);
  for (const [index, segment] of progress.children.entries()) {
    expect(segment).toHaveStyle({
      height: 6,
      backgroundColor: index <= 2 ? themes.dark.primary : themes.dark.border,
    });
  }
  const visual = { includeHiddenElements: true };
  const stages = screen.getByText('✓ កំពុងស្វែងរក', visual).parent;
  expect(stages).toHaveProp('accessible', false);
  expect(stages).toHaveProp('accessibilityElementsHidden', true);
  expect(stages).toHaveProp('importantForAccessibility', 'no-hide-descendants');
  expect(screen.queryByText('✓ កំពុងស្វែងរក')).toBeNull();
  expect(screen.getByText('បានមកដល់', visual)).toHaveStyle({
    color: themes.dark.primary,
  });
  expect(screen.getByText('បានបញ្ចប់', visual)).toHaveStyle({
    color: themes.dark.textMuted,
  });
  await rerender(
    <RideProgressBar
      steps={steps}
      currentIndex={4}
      completed
      accessibilityLabel="បានបញ្ចប់"
    />,
  );
  expect(screen.getByText('✓ បានបញ្ចប់', visual)).toBeOnTheScreen();
});

test('opens the preview by button and shows a stale notice and route summary', async () => {
  await render(
    <RiderRideCard
      {...summary}
      variant="active"
      map={map}
      staleNotice="Stale position"
    />,
  );
  expect(screen.getByText('Stale position')).toBeOnTheScreen();
  expect(screen.getByTestId('map-view')).toHaveProp('scrollEnabled', false);
  expect(button(map.label)).toHaveStyle({
    minWidth: touch.min,
    minHeight: touch.min,
  });
  expect(button(map.label)).toHaveProp('accessibilityHint', map.hintLabel);
  await fireEvent.press(button(map.label));
  expect(map.onOpen).toHaveBeenCalledTimes(1);
  for (const value of Object.values(summary))
    expect(screen.getByText(value, { exact: false })).toBeOnTheScreen();
});

test('shows the no-driver explanation and dismisses the ended summary', async () => {
  const onPress = jest.fn();
  await render(
    <RiderRideCard
      {...summary}
      variant="ended"
      note="No driver was available nearby."
      dismiss={{ label: 'Book another ride', onPress }}
    />,
  );
  expect(screen.getByText('No driver was available nearby.')).toBeOnTheScreen();
  expect(screen.queryByRole('progressbar')).toBeNull();
  expect(screen.queryByTestId('map-view')).toBeNull();
  await fireEvent.press(button('Book another ride'));
  expect(onPress).toHaveBeenCalledTimes(1);
});

test('uses an accessible selected radio, inline error and guarded controls', async () => {
  jest.replaceProperty(Platform, 'OS', 'android');
  const { rerender } = await render(
    <RiderRideCard
      {...summary}
      variant="active"
      map={map}
      cancel={{ ...cancel, open: false }}
    />,
  );
  await fireEvent.press(button(cancel.openLabel));
  expect(cancel.onOpen).toHaveBeenCalledTimes(1);
  await rerender(
    <RiderRideCard {...summary} variant="active" map={map} cancel={cancel} />,
  );
  const radio = screen.getByRole('radio', { name: 'Other' });
  expect(screen.getByRole('radiogroup', { name: cancel.prompt })).toHaveProp(
    'accessible',
    true,
  );
  expect(radio).toBeChecked();
  expect(radio).toHaveStyle({
    minHeight: touch.min,
    minWidth: touch.min,
    borderWidth: mapPinBorderWidth,
  });
  expect(screen.getByText('✓')).toHaveProp('accessible', false);
  expect(screen.getByText('Try again')).toHaveProp(
    'accessibilityLiveRegion',
    'polite',
  );
  await fireEvent.press(radio);
  expect(cancel.onSelect).toHaveBeenCalledWith('other');
  await fireEvent.press(button(cancel.confirmLabel));
  await fireEvent.press(button(cancel.keepLabel));
  expect(cancel.onConfirm).toHaveBeenCalledTimes(1);
  expect(cancel.onKeep).toHaveBeenCalledTimes(1);

  await rerender(
    <RiderRideCard
      {...summary}
      variant="active"
      map={map}
      cancel={{ ...cancel, loading: true }}
    />,
  );
  expect(button(cancel.confirmLabel)).toBeBusy();
  expect(button(cancel.keepLabel)).toBeDisabled();
  expect(screen.getByRole('radio', { name: 'Other' })).toBeDisabled();

  map.onOpen.mockClear();
  cancel.onSelect.mockClear();
  await rerender(
    <InteractionContext.Provider value={() => false}>
      <RiderRideCard {...summary} variant="active" map={map} cancel={cancel} />
    </InteractionContext.Provider>,
  );
  await fireEvent.press(button(map.label));
  await fireEvent.press(screen.getByRole('radio', { name: 'Other' }));
  expect(map.onOpen).not.toHaveBeenCalled();
  expect(cancel.onSelect).not.toHaveBeenCalled();
});
