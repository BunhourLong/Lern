/**
 * @format
 */

import { AppRegistry } from 'react-native';
// Defines the background location task at JS start: TaskManager needs it before any component mounts, including
// when the OS relaunches the app in the background to deliver locations
import './app/services/location.service';
import App from './App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
