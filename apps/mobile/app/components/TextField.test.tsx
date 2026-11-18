import {
  fireEvent,
  isHiddenFromAccessibility,
  render,
  screen,
} from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { themes, touch, type } from '@theme';
import { TextField } from './TextField';

const label = 'Pickup · កន្លែងឡើងជិះ';
const error = 'Enter a pickup location';

test('has a visible label and forwards Khmer text changes', async () => {
  const onChangeText = jest.fn();
  await render(<TextField label={label} onChangeText={onChangeText} />);
  const input = screen.getByLabelText(label);
  await fireEvent.changeText(input, 'ផ្សារ');
  expect(onChangeText).toHaveBeenCalledWith('ផ្សារ');
  const visibleLabel = screen.getByText(label, { includeHiddenElements: true });
  expect(isHiddenFromAccessibility(visibleLabel)).toBe(true);
  expect(screen.queryByText(label)).toBeNull();
  expect(visibleLabel).toHaveProp('accessibilityElementsHidden', true);
  expect(visibleLabel).toHaveProp(
    'importantForAccessibility',
    'no-hide-descendants',
  );
  expect(StyleSheet.flatten(visibleLabel.props.style)).toMatchObject(
    type.bodyStrong,
  );
});

test('announces the error and uses the danger color for the outline and message', async () => {
  await render(<TextField label={label} error={error} />);
  const input = screen.getByLabelText(label);
  const message = screen.getByText(error);
  expect(message).toHaveProp('accessibilityLiveRegion', 'polite');
  expect(input).toHaveProp('accessibilityHint', error);
  expect(StyleSheet.flatten(input.props.style)).toHaveProperty(
    'borderColor',
    themes.light.danger,
  );
  expect(StyleSheet.flatten(message.props.style)).toHaveProperty(
    'color',
    themes.light.danger,
  );
});

test('passes through the accessibility hint when there is no error', async () => {
  await render(
    <TextField label={label} accessibilityHint="Street or landmark" />,
  );
  expect(screen.getByLabelText(label)).toHaveProp(
    'accessibilityHint',
    'Street or landmark',
  );
});

test('uses a themed outline, placeholder and growing input when there is no error', async () => {
  await render(<TextField label={label} placeholder="Market" multiline />);
  const input = screen.getByLabelText(label);
  const inputStyle = StyleSheet.flatten(input.props.style);
  expect(screen.queryByText(error)).toBeNull();
  expect(input).toHaveProp('placeholder', 'Market');
  expect(input).toHaveProp('placeholderTextColor', themes.light.textMuted);
  expect(inputStyle).toMatchObject({
    ...type.body,
    borderColor: themes.light.border,
    backgroundColor: themes.light.surface,
    color: themes.light.text,
    minHeight: touch.min,
  });
  expect(inputStyle).not.toHaveProperty('height');
});
