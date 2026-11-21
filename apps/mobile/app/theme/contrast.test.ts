import { opacity, themes } from './index';

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
  const a = luminance(foreground, backdrop);
  const b = luminance(background, backdrop);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function pressed(color: string) {
  const channels = [1, 3, 5].map(start =>
    parseInt(color.slice(start, start + 2), 16),
  );
  return `rgba(${channels.join(', ')}, ${opacity.pressed})`;
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
  ...(['danger', 'warning', 'success'] as const).map(background => ({
    foreground: 'onStatus' as const,
    background,
    minimum: 4.5,
  })),
  ...(
    ['primary', 'danger', 'success', 'warning', 'border', 'brand'] as const
  ).flatMap(foreground =>
    (['background', 'surface', 'surfaceGlass'] as const).map(background => ({
      foreground,
      background,
      minimum: foreground === 'border' || foreground === 'brand' ? 3 : 4.5,
    })),
  ),
] as const;

const pressedPairs = [
  { foreground: 'onPrimary', background: 'primary', minimum: 4.5 },
  ...(['primary', 'text', 'textMuted', 'border'] as const).map(foreground => ({
    foreground,
    minimum: foreground === 'border' ? 3 : 4.5,
  })),
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

test.each(
  Object.entries(themes).flatMap(([scheme, colors]) =>
    (['background', 'surface'] as const).flatMap(backdrop =>
      pressedPairs.map(pair => ({
        scheme,
        colors,
        backdrop,
        background: backdrop,
        ...pair,
      })),
    ),
  ),
)(
  '$scheme pressed $foreground on $background over $backdrop',
  ({ colors, foreground, background, backdrop, minimum }) => {
    expect(
      contrast(
        pressed(colors[foreground]),
        pressed(colors[background]),
        colors[backdrop],
      ),
    ).toBeGreaterThanOrEqual(minimum);
  },
);

test('contrast is 21 for black and white and 1 for equal colors', () => {
  expect(contrast('#000000', '#ffffff')).toBe(21);
  expect(contrast('#123456', '#123456')).toBe(1);
});

test.each(Object.entries(themes))(
  '%s vehicle option text, selected and unselected outlines stay readable while pressed',
  (_scheme, colors) => {
    const surface = pressed(colors.surface);
    for (const text of [colors.text, colors.textMuted, colors.primary]) {
      expect(
        contrast(pressed(text), surface, colors.background),
      ).toBeGreaterThanOrEqual(4.5);
    }
    for (const outline of [colors.border, colors.primary]) {
      expect(
        contrast(pressed(outline), surface, colors.background),
      ).toBeGreaterThanOrEqual(3);
      expect(
        contrast(pressed(outline), colors.background, colors.background),
      ).toBeGreaterThanOrEqual(3);
    }
  },
);

test.each(Object.entries(themes))(
  '%s text on surfaceGlass over primary',
  (_scheme, { text, surfaceGlass, primary }) => {
    expect(contrast(text, surfaceGlass, primary)).toBeGreaterThanOrEqual(4.5);
  },
);

test.each(Object.entries(themes))(
  '%s map pin icons and outlines contrast with their badge backgrounds',
  (_scheme, colors) => {
    const badges = [
      [colors.primary, colors.onPrimary, colors.surface],
      [colors.surface, colors.primary, colors.primary],
      [colors.danger, colors.onStatus, colors.surface],
    ];
    for (const [background, icon, border] of badges) {
      expect(contrast(icon, background)).toBeGreaterThanOrEqual(3);
      expect(contrast(border, background)).toBeGreaterThanOrEqual(3);
    }
  },
);
