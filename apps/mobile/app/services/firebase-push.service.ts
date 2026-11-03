import {
  AuthorizationStatus,
  deleteToken,
  getMessaging,
  getToken,
  onMessage,
  onTokenRefresh,
  requestPermission,
} from '@react-native-firebase/messaging';
import { PermissionsAndroid, Platform } from 'react-native';
import type { PushNative } from './push.service';

// First Android version that asks the user before showing notifications
const ANDROID_PROMPT_API = 33;

async function askUser(): Promise<boolean> {
  if (Platform.OS === 'android') {
    // Not Firebase's requestPermission: on Android it answers AUTHORIZED whatever the user chose
    if (Number(Platform.Version) < ANDROID_PROMPT_API) return true;
    const answer = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
    );
    return answer === PermissionsAndroid.RESULTS.GRANTED;
  }
  const status = await requestPermission(getMessaging());
  return (
    status === AuthorizationStatus.AUTHORIZED ||
    status === AuthorizationStatus.PROVISIONAL
  );
}

// Importing React Native Firebase loads its native module, absent in Jest: everything else takes PushNative.
// getMessaging() throws without the (gitignored) Firebase config, so it runs per call, inside createPush's handling.
export function firebasePush(): PushNative {
  return {
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
    requestPermission: askUser,
    getToken: async () => getToken(getMessaging()),
    deleteToken: async () => deleteToken(getMessaging()),
    onTokenRefresh: cb => onTokenRefresh(getMessaging(), cb),
    onMessage: cb => onMessage(getMessaging(), async () => cb()),
  };
}
