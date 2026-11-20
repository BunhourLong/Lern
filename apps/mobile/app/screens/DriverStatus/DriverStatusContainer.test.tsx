import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { createDriverModeStore } from '../../stores/driver-mode.store';
import DriverStatusContainer from './DriverStatusContainer';

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);

test('shows loading, keeps Debug available and updates when the store receives a status', async () => {
  const driverMode = createDriverModeStore();
  const onDebug = jest.fn();
  await render(
    <DriverStatusContainer driverMode={driverMode} onDebug={onDebug} />,
  );
  expect(screen.getByRole('progressbar', { name: 'Loading' })).toBeBusy();
  await fireEvent.press(screen.getByRole('button', { name: 'Debug' }));
  expect(onDebug).toHaveBeenCalledTimes(1);

  await act(() => driverMode.setState({ verification: 'pending' }));
  expect(screen.queryByRole('progressbar', { name: 'Loading' })).toBeNull();
  expect(
    screen.getByRole('header', { name: 'Application under review' }),
  ).toBeOnTheScreen();
  await act(() => driverMode.setState({ verification: 'verified' }));
  expect(
    screen.getByRole('header', { name: 'You’re verified' }),
  ).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Debug' })).toBeOnTheScreen();
});

test.each([
  [
    'pending',
    'Application under review',
    'We’re checking your details. You can go online once you’re verified. This screen will update when the review is done.',
  ],
  [
    'verified',
    'You’re verified',
    'You’ll be able to go online from this screen in the next update.',
  ],
  [
    'suspended',
    'Driver account suspended',
    'You can’t go online for now. Contact Lern support to find out why and what you can do to fix it.',
  ],
  ['banned', 'Driver account closed', 'You can no longer drive with Lern.'],
] as const)(
  'shows the title and next steps for %s',
  async (verification, title, body) => {
    const driverMode = createDriverModeStore();
    driverMode.setState({ verification });
    await render(<DriverStatusContainer driverMode={driverMode} />);

    expect(screen.getByRole('header', { name: title })).toBeOnTheScreen();
    expect(screen.getByText(body)).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Debug' })).toBeNull();
  },
);
