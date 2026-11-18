import { render, screen, userEvent } from '@testing-library/react-native';
import { StyleSheet, useColorScheme } from 'react-native';
import type { PressableProps } from 'react-native';
import { opacity, themes, touch, type } from '@theme';
import { Button } from './Button';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  default: jest.fn(),
}));

const mockPressed = jest.fn(() => false);

jest.mock('react-native/Libraries/Components/Pressable/Pressable', () => {
  const { default: NativePressable } = jest.requireActual<{
    default: React.ComponentType<PressableProps>;
  }>('react-native/Libraries/Components/Pressable/Pressable');
  return {
    default: (props: PressableProps) => (
      <NativePressable {...props} testOnly_pressed={mockPressed()} />
    ),
  };
});

const mockColorScheme = jest.mocked(useColorScheme);
const label = 'Confirm ride · បញ្ជាក់ការធ្វើដំណើរ';

beforeEach(() => {
  mockColorScheme.mockReturnValue('light');
  mockPressed.mockReturnValue(false);
});

test('finds the button by name and presses it once', async () => {
  const onPress = jest.fn();
  await render(<Button label={label} onPress={onPress} />);
  const button = screen.getByRole('button', { name: label });
  await userEvent.setup().press(button);
  expect(onPress).toHaveBeenCalledTimes(1);
  expect(
    button.queryAll(node => node.type === 'ActivityIndicator'),
  ).toHaveLength(0);
});

test('lets the label wrap and the button grow beyond its minimum height', async () => {
  await render(<Button label={label} onPress={jest.fn()} />);
  const button = screen.getByRole('button', { name: label });
  const style = StyleSheet.flatten(button.props.style);
  expect(screen.getByText(label)).not.toHaveProp('numberOfLines');
  expect(style).toHaveProperty('minHeight', touch.min);
  expect(style).not.toHaveProperty('height');
});

test('disables presses and exposes the disabled state', async () => {
  const onPress = jest.fn();
  await render(<Button label={label} onPress={onPress} disabled />);
  const button = screen.getByRole('button', { name: label, disabled: true });
  await userEvent.setup().press(button);
  expect(onPress).not.toHaveBeenCalled();
  expect(StyleSheet.flatten(button.props.style)).toHaveProperty(
    'opacity',
    opacity.disabled,
  );
});

test('keeps the label and shows a matching spinner while blocking presses', async () => {
  const onPress = jest.fn();
  await render(<Button label={label} onPress={onPress} loading />);
  const button = screen.getByRole('button', {
    name: label,
    busy: true,
    disabled: true,
  });
  await userEvent.setup().press(button);
  expect(onPress).not.toHaveBeenCalled();
  expect(screen.getByText(label)).toBeVisible();
  const [spinner] = button.queryAll(node => node.type === 'ActivityIndicator');
  expect(spinner).toHaveProp('animating', true);
  expect(spinner).toHaveProp('color', themes.light.onPrimary);
});

test.each([
  {
    scheme: 'light',
    variant: 'primary',
    labelColor: 'onPrimary',
    fill: 'primary',
  },
  {
    scheme: 'light',
    variant: 'secondary',
    labelColor: 'primary',
    fill: undefined,
  },
  { scheme: 'light', variant: 'ghost', labelColor: 'primary', fill: undefined },
  {
    scheme: 'dark',
    variant: 'primary',
    labelColor: 'onPrimary',
    fill: 'primary',
  },
] as const)(
  'uses the $scheme $variant colors',
  async ({ scheme, variant, labelColor, fill }) => {
    mockColorScheme.mockReturnValue(scheme);
    await render(
      <Button label={label} onPress={jest.fn()} variant={variant} />,
    );
    const button = screen.getByRole('button', { name: label });
    const buttonStyle = StyleSheet.flatten(button.props.style);
    expect(buttonStyle.minHeight).toBe(touch.min);
    expect(buttonStyle.backgroundColor).toBe(
      fill ? themes[scheme][fill] : undefined,
    );
    expect(buttonStyle.borderColor).toBe(
      variant === 'secondary' ? themes[scheme].border : undefined,
    );
    expect(
      StyleSheet.flatten(screen.getByText(label).props.style),
    ).toMatchObject({
      ...type.button,
      color: themes[scheme][labelColor],
    });
  },
);

test('applies the pressed opacity when Pressable renders as pressed', async () => {
  mockPressed.mockReturnValue(true);
  await render(<Button label={label} onPress={jest.fn()} />);
  const button = screen.getByRole('button', { name: label });
  expect(StyleSheet.flatten(button.props.style)).toHaveProperty(
    'opacity',
    opacity.pressed,
  );
});
