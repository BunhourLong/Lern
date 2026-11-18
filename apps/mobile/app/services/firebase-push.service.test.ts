import {
  AuthorizationStatus,
  getMessaging,
  requestPermission,
} from '@react-native-firebase/messaging';
import { PermissionsAndroid, Platform } from 'react-native';
import { firebasePush } from './firebase-push.service';

jest.mock('@react-native-firebase/messaging', () => ({
  AuthorizationStatus: { DENIED: 0, AUTHORIZED: 1, PROVISIONAL: 2 },
  getMessaging: jest.fn(() => ({})),
  requestPermission: jest.fn(),
  getToken: jest.fn(async () => 'token-1'),
  deleteToken: jest.fn(),
  onTokenRefresh: jest.fn(),
  onMessage: jest.fn(),
}));

const on = (os: 'android' | 'ios', version: number) => {
  Object.defineProperty(Platform, 'OS', { get: () => os, configurable: true });
  Object.defineProperty(Platform, 'Version', { get: () => version, configurable: true });
};
const prompt = jest.spyOn(PermissionsAndroid, 'request');
afterEach(() => jest.clearAllMocks());

// Firebase's requestPermission always answers AUTHORIZED on Android, whatever the user chose
it.each([
  ['granted', true],
  ['denied', false],
  ['never_ask_again', false],
] as const)('Android 13+ uses the runtime prompt: %s', async (answer, allowed) => {
  on('android', 33);
  prompt.mockResolvedValue(answer);
  await expect(firebasePush().requestPermission()).resolves.toBe(allowed);
  expect(prompt).toHaveBeenCalledWith(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
  expect(requestPermission).not.toHaveBeenCalled();
});

it('older Android has no such prompt', async () => {
  on('android', 32);
  await expect(firebasePush().requestPermission()).resolves.toBe(true);
  expect(prompt).not.toHaveBeenCalled();
});

it.each([
  [AuthorizationStatus.AUTHORIZED, true],
  [AuthorizationStatus.PROVISIONAL, true],
  [AuthorizationStatus.DENIED, false],
])('iOS asks through Firebase: status %s', async (status, allowed) => {
  on('ios', 18);
  (requestPermission as jest.Mock).mockResolvedValue(status);
  await expect(firebasePush().requestPermission()).resolves.toBe(allowed);
  expect(firebasePush().platform).toBe('ios');
});

// A clone without the Firebase files: getMessaging throws, which must reach createPush's handling, not crash boot
it('only touches Firebase when used, and turns its absence into a rejection', async () => {
  (getMessaging as jest.Mock).mockImplementation(() => {
    throw new Error("No Firebase App '[DEFAULT]'");
  });
  on('ios', 18);
  const native = firebasePush();
  expect(native.platform).toBe('ios');
  await expect(native.requestPermission()).rejects.toThrow(/No Firebase App/);
  await expect(native.getToken()).rejects.toThrow(/No Firebase App/);
  await expect(native.deleteToken()).rejects.toThrow(/No Firebase App/);
  (getMessaging as jest.Mock).mockImplementation(() => ({}));
});
