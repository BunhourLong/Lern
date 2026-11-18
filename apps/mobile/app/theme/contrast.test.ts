import { themes } from './index';

function luminance(color: string, background = '#ffffff'): number {
  const rgba = color.match(/^rgba\(([^)]+)\)$/)?.[1];
  const channels = rgba
    ? rgba.split(',').map(Number)
    : [1, 3, 5].map(start => parseInt(color.slice(start, start + 2), 16));
  const [red, green, blue] = channels.slice(0, 3).map((channel, index) => {
    const alpha = channels[3] ?? 1;
    const start = 1 + 2 * index;
    const backdrop = parseInt(background.slice(start, start + 2), 16);
    const sRGB = (alpha * channel + (1 - alpha) * backdrop) / 255;
    return sRGB <= 0.04045 ? sRGB / 12.92 : ((sRGB + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(foreground: string, background: string, backdrop?: string) {
  const a = luminance(foreground);
  const b = luminance(background, backdrop);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const pairs = [
  ...(['text', 'textMuted'] as const).flatMap(foreground =>
    (['background', 'surface', 'surfaceGlass'] as const).map(background => ({
      foreground,
      background,
      minimum: 4.5,
    })),
  ),
  { foreground: 'onPrimary', background: 'primary', minimum: 4.5 },
  ...(['primary', 'danger', 'success', 'warning', 'border'] as const).flatMap(
    foreground =>
      (['background', 'surface', 'surfaceGlass'] as const).map(background => ({
        foreground,
        background,
        minimum: foreground === 'border' ? 3 : 4.5,
      })),
  ),
] as const;

test.each(
  Object.entries(themes).flatMap(([scheme, colors]) =>
    pairs.map(pair => ({ scheme, colors, ...pair })),
  ),
)(
  '$scheme $foreground on $background',
  ({ colors, foreground, background, minimum }) => {
    expect(
      contrast(colors[foreground], colors[background], colors.background),
    ).toBeGreaterThanOrEqual(minimum);
  },
);

test('contrast is 21 for black and white and 1 for equal colors', () => {
  expect(contrast('#000000', '#ffffff')).toBe(21);
  expect(contrast('#123456', '#123456')).toBe(1);
});

test.each(Object.entries(themes))(
  '%s text on surfaceGlass over primary',
  (_scheme, { text, surfaceGlass, primary }) => {
    expect(contrast(text, surfaceGlass, primary)).toBeGreaterThanOrEqual(4.5);
  },
);
