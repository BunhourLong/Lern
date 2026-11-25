import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { NotificationTarget } from '../boot/core';
import type { RootRoute } from './root-route';

export type RootStackParams = Record<
  RootRoute | 'Debug' | 'AppLock' | 'EnrollPin' | 'ConfirmPin' | 'DriverApply',
  undefined
> & {
  Otp: { phone: string; sentAt: number };
  NotificationStatus: NotificationTarget;
};

export const Stack = createNativeStackNavigator<RootStackParams>();
