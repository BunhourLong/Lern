/* eslint-env jest */

jest.mock('@react-native-community/netinfo', () =>
  jest.requireActual('@react-native-community/netinfo/jest/netinfo-mock.js'),
);

jest.mock('react-native-maps', () => {
  const React = require('react');
  const { View } = require('react-native');
  const animateToRegion = jest.fn();
  const MapView = React.forwardRef(({ children, ...props }, ref) => {
    React.useImperativeHandle(ref, () => ({ animateToRegion }), []);
    return React.createElement(
      View,
      { testID: 'map-view', ...props },
      children,
    );
  });
  MapView.animateToRegion = animateToRegion;
  const Marker = ({ children, ...props }) =>
    React.createElement(View, { testID: 'map-marker', ...props }, children);
  return {
    __esModule: true,
    default: MapView,
    Marker,
    PROVIDER_GOOGLE: 'google',
    PROVIDER_DEFAULT: null,
  };
});
