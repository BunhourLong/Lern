import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { RootRoute } from './root-route';

export const Stack =
  createNativeStackNavigator<Record<RootRoute | 'Debug', undefined>>();
