import type { ApplyDriver } from '@lern/contracts';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Platform, useColorScheme } from 'react-native';
import { themes, touch } from '@theme';
import { ApiError } from '../../services/api.service';
import DriverApplyContainer from './DriverApplyContainer';

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  default: jest.fn(),
}));

afterEach(() => {
  jest.mocked(useColorScheme).mockReset();
  jest.restoreAllMocks();
});

const button = () => screen.getByRole('button', { name: 'Send application' });
const plate = () => screen.getByLabelText('License plate');
const radio = (name: string) => screen.getByRole('radio', { name });
const plateError = 'Enter a license plate with 2 to 16 characters.';

async function setup() {
  const becomeDriver = jest
    .fn<Promise<void>, [ApplyDriver]>()
    .mockResolvedValue(undefined);
  await render(<DriverApplyContainer becomeDriver={becomeDriver} />);
  return becomeDriver;
}

test('groups the vehicle radios under their label on Android', async () => {
  jest.replaceProperty(Platform, 'OS', 'android');
  await setup();
  const group = screen.getByRole('radiogroup', { name: 'Vehicle type' });
  for (const vehicle of ['Motorbike', 'Remork', 'Bajaj']) {
    expect(group).toContainElement(radio(vehicle));
  }
});

test('shows three unselected vehicles and updates the selection in dark mode', async () => {
  jest.mocked(useColorScheme).mockReturnValue('dark');
  await setup();
  expect(screen.getByRole('header', { name: 'Vehicle type' })).toBeOnTheScreen();
  expect(screen.queryByRole('radiogroup')).toBeNull();
  for (const vehicle of ['Motorbike', 'Remork', 'Bajaj']) {
    expect(radio(vehicle)).not.toBeChecked();
    expect(radio(vehicle)).toHaveStyle({
      minHeight: touch.min,
      backgroundColor: themes.dark.surface,
    });
    expect(radio(vehicle).props.accessibilityHint).toEqual(expect.any(String));
  }
  expect(plate()).toHaveProp('autoCapitalize', 'characters');
  expect(
    screen.getByText(
      'We’ll review your details. You’ll see the result on your driver home.',
    ),
  ).toBeOnTheScreen();
  await fireEvent.press(radio('Remork'));
  expect(radio('Remork')).toBeChecked();
  expect(radio('Remork')).toHaveStyle({ borderColor: themes.dark.primary });
  await fireEvent.press(radio('Bajaj'));
  expect(radio('Bajaj')).toBeChecked();
  expect(radio('Remork')).not.toBeChecked();
});

test('announces a missing vehicle and invalid plates inline before sending', async () => {
  const becomeDriver = await setup();
  await fireEvent.changeText(plate(), ' PP 1 ');
  await fireEvent.press(button());
  expect(screen.getByText('Choose a vehicle type.')).toHaveProp(
    'accessibilityLiveRegion',
    'polite',
  );
  await fireEvent.press(radio('Motorbike'));
  expect(screen.queryByText('Choose a vehicle type.')).toBeNull();

  for (const invalid of [' 1 ', '12345678901234567']) {
    await fireEvent.changeText(plate(), invalid);
    await fireEvent.press(button());
    expect(screen.getByText(plateError)).toHaveProp(
      'accessibilityLiveRegion',
      'polite',
    );
    expect(plate()).toHaveProp('accessibilityHint', plateError);
    expect(plate()).toHaveProp('value', invalid);
  }
  expect(becomeDriver).not.toHaveBeenCalled();
});

test('sends the trimmed input once, including taps before the busy state renders', async () => {
  const becomeDriver = await setup();
  let finish!: () => void;
  becomeDriver.mockReturnValue(
    new Promise(resolve => {
      finish = resolve;
    }),
  );
  await fireEvent.press(radio('Remork'));
  await fireEvent.changeText(plate(), '  PP 123  ');

  await act(async () => {
    await fireEvent.press(button());
    expect(button()).toBeEnabled();
    await fireEvent.press(button());
  });
  expect(button()).toBeBusy();
  expect(button()).toBeDisabled();
  await fireEvent.press(button());
  await fireEvent.press(radio('Bajaj'));
  expect(radio('Remork')).toBeChecked();
  expect(becomeDriver).toHaveBeenCalledTimes(1);
  expect(becomeDriver).toHaveBeenCalledWith({
    vehicleType: 'remork',
    plate: 'PP 123',
  });
  await act(() => finish());
  expect(button()).toBeEnabled();
});

test.each([
  [new ApiError(0, null), 'No connection. Check your internet and try again.'],
  [new ApiError(400, null), plateError],
  [new ApiError(500, null), 'Could not send your application. Try again.'],
  [
    new Error('Unexpected failure'),
    'Could not send your application. Try again.',
  ],
])(
  'shows the inline error for %s and keeps the input for retry',
  async (error, message) => {
    const becomeDriver = await setup();
    becomeDriver.mockRejectedValueOnce(error);
    await fireEvent.press(radio('Bajaj'));
    await fireEvent.changeText(plate(), ' PP 1 ');
    await fireEvent.press(button());

    expect(screen.getByText(message)).toHaveProp(
      'accessibilityLiveRegion',
      'polite',
    );
    if (message === plateError)
      expect(plate()).toHaveProp('accessibilityHint', message);
    expect(radio('Bajaj')).toBeChecked();
    expect(plate()).toHaveProp('value', ' PP 1 ');
    expect(button()).toBeEnabled();

    await fireEvent.press(button());
    expect(becomeDriver).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(message)).toBeNull();
  },
);
