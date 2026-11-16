/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';
import { startApp } from '../app/boot/app-core';

jest.mock('../app/boot/app-core', () => ({
  core: {},
  startApp: jest.fn(),
}));
jest.mock('../app/screens/Debug/DebugContainer', () => () => null);

test('renders correctly and starts the app once', async () => {
  await ReactTestRenderer.act(() => {
    ReactTestRenderer.create(<App />);
  });
  expect(startApp).toHaveBeenCalledTimes(1);
});
