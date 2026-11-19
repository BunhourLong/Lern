import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useColorScheme } from 'react-native';
import { ApiError } from '../../services/api.service';
import LoginContainer from './LoginContainer';

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  default: jest.fn(),
}));

const send = () => screen.getByRole('button', { name: 'Send code' });
const phoneField = () => screen.getByLabelText('Phone number');

async function setup() {
  const requestOtp = jest
    .fn<Promise<void>, [string]>()
    .mockResolvedValue(undefined);
  const onSent = jest.fn();
  let time = 1000;
  const now = jest.fn(() => time);
  const jump = (ms: number) => {
    time += ms;
  };
  const advance = async (ms: number) => {
    jump(ms);
    await act(() => {
      jest.advanceTimersByTime(ms);
    });
  };
  await render(
    <LoginContainer requestOtp={requestOtp} onSent={onSent} now={now} />,
  );
  return { requestOtp, onSent, now, jump, advance };
}

afterEach(() => {
  jest.useRealTimers();
  jest.mocked(useColorScheme).mockReset();
});

test('shows the Cambodian prefix and rejects invalid input inline', async () => {
  const { requestOtp, onSent } = await setup();
  expect(screen.getByText('+855')).toBeOnTheScreen();
  expect(phoneField()).toHaveProp('keyboardType', 'phone-pad');
  expect(phoneField()).toHaveProp('textContentType', 'telephoneNumber');
  expect(phoneField()).toHaveProp('autoComplete', 'tel');
  await fireEvent.changeText(phoneField(), '01234');
  await fireEvent.press(send());
  expect(screen.getByText('Enter a valid Cambodian phone number.')).toHaveProp(
    'accessibilityLiveRegion',
    'polite',
  );
  expect(requestOtp).not.toHaveBeenCalled();
  expect(onSent).not.toHaveBeenCalled();
});

test('sends the normalized phone once and reports when the request succeeds', async () => {
  const { requestOtp, onSent, jump } = await setup();
  let resolve!: () => void;
  requestOtp.mockReturnValue(
    new Promise(done => {
      resolve = done;
    }),
  );
  await fireEvent.changeText(phoneField(), '012 345 678');

  await act(async () => {
    await fireEvent.press(send());
    expect(send()).toBeEnabled();
    await fireEvent.press(send());
  });
  expect(requestOtp).toHaveBeenCalledTimes(1);
  expect(requestOtp).toHaveBeenCalledWith('+85512345678');
  expect(send()).toBeDisabled();
  expect(send()).toBeBusy();
  expect(onSent).not.toHaveBeenCalled();

  jump(250);
  await act(() => resolve());
  expect(onSent).toHaveBeenCalledWith({ phone: '+85512345678', sentAt: 1250 });
});

test.each([
  [{ retryAfter: 90 }, 90],
  [{ retryAfter: '90' }, 60],
  [{ retryAfter: -1 }, 60],
  [{}, 60],
  [null, 60],
])(
  'uses retryAfter from %j or falls back to %i seconds',
  async (body, seconds) => {
    jest.useFakeTimers();
    const { requestOtp, onSent, now, advance } = await setup();
    requestOtp.mockRejectedValueOnce(new ApiError(429, body));
    await fireEvent.changeText(phoneField(), '12345678');
    await fireEvent.press(send());
    expect(
      screen.getByText(`Too many tries. Try again in ${seconds}s.`),
    ).toHaveProp('accessibilityLiveRegion', 'polite');
    expect(send()).toBeDisabled();
    await fireEvent.press(send());
    expect(requestOtp).toHaveBeenCalledTimes(1);
    expect(onSent).not.toHaveBeenCalled();

    await advance((seconds - 1) * 1000);
    expect(
      screen.getByText('Too many tries. Try again in 1s.'),
    ).toBeOnTheScreen();
    expect(send()).toBeDisabled();
    await advance(1000);
    expect(screen.queryByText(/Too many tries/)).toBeNull();
    expect(send()).toBeEnabled();

    now.mockClear();
    await advance(1000);
    expect(now).not.toHaveBeenCalled();
  },
);

test.each([
  [0, 'No connection. Check your internet and try again.'],
  [500, 'Something went wrong. Try again.'],
])(
  'shows an inline error for status %i and keeps the number',
  async (status, message) => {
    jest.mocked(useColorScheme).mockReturnValue('dark');
    const { requestOtp, onSent } = await setup();
    requestOtp.mockRejectedValueOnce(new ApiError(status, null));
    await fireEvent.changeText(phoneField(), '12345678');
    await fireEvent.press(send());
    expect(screen.getByText(message)).toHaveProp(
      'accessibilityLiveRegion',
      'polite',
    );
    expect(phoneField()).toHaveProp('value', '12345678');
    expect(send()).toBeEnabled();
    expect(onSent).not.toHaveBeenCalled();
  },
);
