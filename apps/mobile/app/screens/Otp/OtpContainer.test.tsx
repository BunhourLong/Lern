import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { ApiError } from '../../services/api.service';
import OtpContainer from './OtpContainer';

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);

const phone = '+85512345678';
const field = () => screen.getByLabelText('Code');
const verify = () => screen.getByRole('button', { name: 'Verify' });
const resend = (name = 'Resend code') => screen.getByRole('button', { name });
const changeCode = (value: string) => fireEvent.changeText(field(), value);

async function setup(sinceSent = 0, sentAt = 1_000_000) {
  const signIn = jest
    .fn<Promise<void>, [string, string]>()
    .mockResolvedValue(undefined);
  const requestOtp = jest
    .fn<Promise<void>, [string]>()
    .mockResolvedValue(undefined);
  let time = sentAt + sinceSent;
  const now = () => time;
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
    <OtpContainer
      phone={phone}
      sentAt={sentAt}
      now={now}
      signIn={signIn}
      requestOtp={requestOtp}
    />,
  );
  return { signIn, requestOtp, jump, advance };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test('uses one numeric autofill field and verifies only a complete numeric code', async () => {
  const { signIn } = await setup();
  expect(
    screen.getByText(`Enter the code sent to ${phone}.`),
  ).toBeOnTheScreen();
  expect(field()).toHaveProp('keyboardType', 'number-pad');
  expect(field()).toHaveProp('textContentType', 'oneTimeCode');
  expect(field()).toHaveProp('autoComplete', 'sms-otp');
  expect(field()).toHaveProp('maxLength', 6);
  expect(verify()).toBeDisabled();

  await changeCode('12345');
  expect(verify()).toBeDisabled();
  await changeCode('12345a');
  expect(verify()).toBeDisabled();
  await fireEvent.press(verify());
  expect(signIn).not.toHaveBeenCalled();

  await changeCode('123456');
  expect(signIn).toHaveBeenCalledWith(phone, '123456');
});

test('verifies only once when the last digit fires twice before the busy state renders', async () => {
  const { signIn } = await setup();
  let resolve!: () => void;
  signIn.mockReturnValue(
    new Promise(done => {
      resolve = done;
    }),
  );
  await changeCode('12345');
  await act(async () => {
    await changeCode('123456');
    expect(field()).toBeEnabled();
    await changeCode('123456');
  });
  expect(signIn).toHaveBeenCalledTimes(1);
  expect(verify()).toBeBusy();
  expect(verify()).toBeDisabled();

  await act(() => resolve());
});

test('ignores repeated autofill after the code has been accepted', async () => {
  const { signIn } = await setup();
  await changeCode('123456');
  expect(signIn).toHaveBeenCalledTimes(1);
  await changeCode('123456');
  expect(signIn).toHaveBeenCalledTimes(1);
});

test('shows a wrong code inline, allows a button retry, and clears the error on edit', async () => {
  const { signIn } = await setup();
  signIn.mockRejectedValueOnce(new ApiError(401, null));
  signIn.mockRejectedValueOnce(new ApiError(401, null));
  await changeCode('123456');
  expect(screen.getByText('Wrong code')).toHaveProp(
    'accessibilityLiveRegion',
    'polite',
  );
  expect(verify()).toBeEnabled();
  await fireEvent.press(verify());
  expect(signIn).toHaveBeenCalledTimes(2);
  expect(screen.getByText('Wrong code')).toBeOnTheScreen();
  await changeCode('12345');
  expect(screen.queryByText('Wrong code')).toBeNull();
  expect(verify()).toBeDisabled();
  await changeCode('123457');
  expect(signIn).toHaveBeenLastCalledWith(phone, '123457');
});

test.each([
  [0, 'No connection. Check your internet and try again.'],
  [500, 'Something went wrong. Try again.'],
])(
  'shows a recoverable verify error for status %i',
  async (status, message) => {
    const { signIn } = await setup();
    signIn.mockRejectedValueOnce(new ApiError(status, null));
    await changeCode('123456');
    expect(screen.getByText(message)).toHaveProp(
      'accessibilityLiveRegion',
      'polite',
    );
    expect(field()).toHaveProp('value', '123456');
    expect(verify()).toBeEnabled();
  },
);

test('blocks both automatic and manual verification until the server wait expires', async () => {
  const { signIn, advance } = await setup();
  signIn.mockRejectedValueOnce(new ApiError(429, { retryAfter: 90 }));
  await changeCode('123456');
  expect(screen.getByText('Too many tries. Try again in 90s.')).toHaveProp(
    'accessibilityLiveRegion',
    'polite',
  );
  expect(verify()).toBeDisabled();
  await fireEvent.press(verify());
  await changeCode('123457');
  expect(signIn).toHaveBeenCalledTimes(1);

  await advance(89_000);
  expect(
    screen.getByText('Too many tries. Try again in 1s.'),
  ).toBeOnTheScreen();
  expect(verify()).toBeDisabled();
  await advance(1000);
  expect(screen.queryByText(/Too many tries/)).toBeNull();
  expect(verify()).toBeEnabled();
  await fireEvent.press(verify());
  expect(signIn).toHaveBeenLastCalledWith(phone, '123457');
});

test('blocks a second complete code after a 429 even before the wait renders', async () => {
  const { signIn } = await setup();
  let reject!: (error: ApiError) => void;
  const request = new Promise<void>((_, fail) => {
    reject = fail;
  });
  signIn.mockReturnValueOnce(request);
  const onChangeText: (value: string) => void = field().props.onChangeText;
  const waitMessage = 'Too many tries. Try again in 90s.';

  await act(async () => {
    onChangeText('123456');
    reject(new ApiError(429, { retryAfter: 90 }));
    await request.catch(() => undefined);
    expect(screen.queryByText(waitMessage)).toBeNull();
    onChangeText('123457');
  });

  expect(signIn).toHaveBeenCalledTimes(1);
  expect(screen.getByText(waitMessage)).toBeOnTheScreen();
});

test('uses the elapsed time since sending, even when timers paused in the background', async () => {
  const { requestOtp, advance, jump } = await setup();
  expect(resend('Resend in 60s')).toBeDisabled();
  await fireEvent.press(resend('Resend in 60s'));
  expect(requestOtp).not.toHaveBeenCalled();

  jump(45_000);
  await advance(1000);
  expect(resend('Resend in 14s')).toBeDisabled();
  await advance(13_000);
  expect(resend('Resend in 1s')).toBeDisabled();
  await advance(1000);
  expect(resend()).toBeEnabled();
});

test('resends only once per tap and restarts the countdown from the new send time', async () => {
  const { requestOtp, advance } = await setup(60_000);
  let resolve!: () => void;
  requestOtp.mockReturnValue(
    new Promise(done => {
      resolve = done;
    }),
  );
  await act(async () => {
    await fireEvent.press(resend());
    expect(resend()).toBeEnabled();
    await fireEvent.press(resend());
  });
  expect(requestOtp).toHaveBeenCalledTimes(1);
  expect(requestOtp).toHaveBeenCalledWith(phone);
  expect(resend()).toBeBusy();
  expect(resend()).toBeDisabled();

  await advance(5000);
  await act(() => resolve());
  expect(resend('Resend in 60s')).toBeDisabled();
  await advance(60_000);
  expect(resend()).toBeEnabled();
});

test('uses the resend wait from a 429 and enables resend when it ends', async () => {
  const { requestOtp, advance } = await setup(60_000);
  requestOtp.mockRejectedValueOnce(new ApiError(429, { retryAfter: 75 }));
  await fireEvent.press(resend());
  expect(screen.getByText('Too many tries. Try again in 75s.')).toHaveProp(
    'accessibilityLiveRegion',
    'polite',
  );
  expect(resend('Resend in 75s')).toBeDisabled();
  await advance(75_000);
  expect(screen.queryByText(/Too many tries/)).toBeNull();
  expect(resend()).toBeEnabled();
});

test('keeps the code editable after a resend fails offline', async () => {
  const { requestOtp, signIn } = await setup(60_000);
  requestOtp.mockRejectedValueOnce(new ApiError(0, null));
  await changeCode('12345');
  await fireEvent.press(resend());
  expect(
    screen.getByText('No connection. Check your internet and try again.'),
  ).toHaveProp('accessibilityLiveRegion', 'polite');
  expect(resend()).toBeEnabled();
  expect(field()).toHaveProp('value', '12345');
  await changeCode('123456');
  expect(signIn).toHaveBeenCalledWith(phone, '123456');
});
