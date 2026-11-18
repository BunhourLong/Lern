import { render, screen, userEvent } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import type { PressableProps } from 'react-native';
import { opacity, themes, touch, type } from '@theme';
import { ListRow } from './ListRow';

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

beforeEach(() => {
  mockPressed.mockReturnValue(false);
});

test('joins the accessible name of a pressable row and handles a press', async () => {
  const onPress = jest.fn();
  await render(
    <ListRow
      title="Ride"
      subtitle="Market pickup"
      value="12,000 ៛"
      onPress={onPress}
    />,
  );
  const row = screen.getByRole('button', {
    name: 'Ride, Market pickup, 12,000 ៛',
  });
  await userEvent.setup().press(row);
  expect(onPress).toHaveBeenCalledTimes(1);
  expect(StyleSheet.flatten(row.props.style)).toMatchObject({
    minHeight: touch.min,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: themes.light.border,
  });
  expect(
    StyleSheet.flatten(screen.getByText('Market pickup').props.style),
  ).toMatchObject({ ...type.caption, color: themes.light.textMuted });
  expect(
    StyleSheet.flatten(screen.getByText('12,000 ៛').props.style),
  ).toMatchObject({ ...type.body, color: themes.light.textMuted });
});

test('lets the title and value wrap and the row grow beyond its minimum height', async () => {
  await render(
    <ListRow title="Estimated fare" value="12,000 ៛" onPress={jest.fn()} />,
  );
  const row = screen.getByRole('button', { name: 'Estimated fare, 12,000 ៛' });
  const style = StyleSheet.flatten(row.props.style);
  expect(screen.getByText('Estimated fare')).not.toHaveProp('numberOfLines');
  expect(screen.getByText('12,000 ៛')).not.toHaveProp('numberOfLines');
  expect(style).toHaveProperty('minHeight', touch.min);
  expect(style).not.toHaveProperty('height');
});

test.each([
  { title: 'Cash', value: undefined, name: 'Cash' },
  { title: 'Title', value: 'value', name: 'Title, value' },
])(
  'uses the exact button name "$name" when optional parts are missing',
  async ({ title, value, name }) => {
    await render(<ListRow title={title} value={value} onPress={jest.fn()} />);
    expect(screen.getByRole('button', { name })).toHaveProp(
      'accessibilityLabel',
      name,
    );
  },
);

test('applies the pressed opacity when Pressable renders as pressed', async () => {
  mockPressed.mockReturnValue(true);
  await render(
    <ListRow
      title="Ride"
      subtitle="Market"
      value="12,000 ៛"
      onPress={jest.fn()}
    />,
  );
  const row = screen.getByRole('button', { name: 'Ride, Market, 12,000 ៛' });
  expect(StyleSheet.flatten(row.props.style)).toHaveProperty(
    'opacity',
    opacity.pressed,
  );
});

test('reads a plain row as one item and only renders the title if it is the only part', async () => {
  await render(<ListRow title="Ride" />);
  expect(screen.queryByRole('button')).toBeNull();
  expect(screen.getByRole('none', { name: 'Ride' })).toHaveProp(
    'accessible',
    true,
  );
  const title = screen.getByText('Ride');
  expect(screen.getAllByRole('text')).toEqual([title]);
  expect(StyleSheet.flatten(title.props.style)).toMatchObject(type.bodyStrong);
});
