/**
 * Costly's design tokens, transcribed from the approved design canvas (v1.1):
 * the Color, Type and Handoff boards, and the theme variables the converted
 * screens use for light and dark. A value the design doesn't give is marked
 * "derived" with how it was chosen.
 *
 * This object is the single source. `css.ts` turns it into CSS custom
 * properties for the web; a native client would read the same object.
 */

export const cobalt = {
  50: '#F2F5FC',
  100: '#E3E9F8',
  200: '#C3D0F1',
  300: '#8FA8F0',
  400: '#3355C2',
  500: '#2849A8',
  600: '#203D8F',
  700: '#1A3276',
  800: '#13234F',
} as const;

export type ThemeName = 'light' | 'dark';

export interface ThemeColors {
  /** The page behind everything. */
  page: string;
  /** Cards, panels, inputs. */
  surface: string;
  /** Quiet fills: segmented tracks, icon tiles, hover rows. */
  subtle: string;
  /** An even quieter fill, for zebra rows and table headers. */
  subtleAlt: string;
  /** Menus, popovers, dialogs. In dark mode a lighter surface replaces the shadow. */
  raised: string;
  border: string;
  /** Input borders and secondary buttons. */
  borderStrong: string;
  /** Secondary button border on hover. */
  borderHover: string;

  text: string;
  textSecondary: string;
  /** Body copy that is quieter than `text` but stronger than `textSecondary`. */
  textBody: string;
  /** Large text and non-essential hints only (3:1). */
  textTertiary: string;

  /** Primary button fill. */
  accent: string;
  accentHover: string;
  accentPressed: string;
  /** Text and icons on `accent`. */
  onAccent: string;
  /** Links, ghost buttons, active navigation text. */
  accentText: string;
  /** Text on `accentSoft`, such as a selected option's label. */
  accentInk: string;
  /** Selected backgrounds. */
  accentSoft: string;
  /** Stronger selected backgrounds and the input focus halo. */
  accentSoftStrong: string;
  /** Selected-item borders that should stay quiet. */
  accentMuted: string;
  /** The active sidebar item. */
  navSelected: string;
  /** The 2 px focus ring. */
  focus: string;

  positive: string;
  positiveSoft: string;
  positiveInk: string;
  negative: string;
  negativeSoft: string;
  negativeInk: string;
  negativeBorder: string;
  warning: string;
  warningSoft: string;
  warningInk: string;
  info: string;

  /** Toasts and tooltips: the inverse of the page. */
  inverse: string;
  onInverse: string;
  onInverseSecondary: string;

  disabled: string;
  onDisabled: string;
  /** Chart gridlines. */
  grid: string;
  /** Behind dialogs and drawers. */
  scrim: string;
}

export const themes: Record<ThemeName, ThemeColors> = {
  light: {
    page: '#F7F8FA',
    surface: '#FFFFFF',
    subtle: '#F1F3F6',
    subtleAlt: '#FBFBFC',
    raised: '#FFFFFF',
    border: '#E4E7EC',
    borderStrong: '#CDD2DA',
    borderHover: '#B5BCC7',

    text: '#17191D',
    textSecondary: '#5F6672',
    textBody: '#3E4450',
    textTertiary: '#8A909B',

    accent: cobalt[500],
    accentHover: cobalt[600],
    accentPressed: cobalt[700],
    onAccent: '#FFFFFF',
    accentText: cobalt[500],
    accentInk: cobalt[700],
    accentSoft: cobalt[50],
    accentSoftStrong: cobalt[100],
    accentMuted: cobalt[200],
    navSelected: '#EEF1F8',
    focus: cobalt[500],

    positive: '#1E7B4E',
    positiveSoft: '#EAF5EF',
    positiveInk: '#155C39',
    negative: '#B4342D',
    negativeSoft: '#FBEDEC',
    negativeInk: '#8A2620',
    negativeBorder: '#E9B8B4',
    warning: '#9A5B00',
    warningSoft: '#FDF3E2',
    warningInk: '#6E4100',
    info: '#1F6391',

    inverse: '#17191D',
    onInverse: '#FFFFFF',
    onInverseSecondary: '#C9CED6',

    disabled: '#E4E7EC',
    onDisabled: '#8A909B',
    grid: '#EEF0F3',
    scrim: 'rgba(23, 25, 29, 0.32)',
  },
  dark: {
    page: '#0F1114',
    surface: '#171A1F',
    subtle: '#1E2228',
    subtleAlt: '#1A1D22',
    raised: '#2A2F37',
    border: '#2A2F37',
    borderStrong: '#3A404A',
    // derived: the dark chart bar neutral, one step above border-strong.
    borderHover: '#4A505B',

    text: '#ECEEF1',
    textSecondary: '#A1A8B3',
    textBody: '#C9CED6',
    textTertiary: '#6E7682',

    accent: cobalt[400],
    // derived: the design gives no dark hover or pressed fill; they step down
    // the Cobalt scale as in light mode, keeping white text above 8:1.
    accentHover: cobalt[500],
    accentPressed: cobalt[600],
    onAccent: '#FFFFFF',
    accentText: cobalt[300],
    accentInk: cobalt[200],
    accentSoft: '#18203A',
    accentSoftStrong: '#25335E',
    accentMuted: '#3A4F8F',
    navSelected: '#1E2747',
    focus: cobalt[300],

    positive: '#5BBF8A',
    positiveSoft: '#15301F',
    positiveInk: '#8FD9B0',
    negative: '#F07A70',
    negativeSoft: '#3A1F1E',
    // derived: no dark ink is given; the dark negative already reads on its soft fill.
    negativeInk: '#F07A70',
    negativeBorder: '#6B3431',
    warning: '#E0A647',
    warningSoft: '#33270F',
    warningInk: '#E8C27A',
    info: '#7FB5DE',

    inverse: '#ECEEF1',
    onInverse: '#17191D',
    onInverseSecondary: '#3E4450',

    // derived: disabled fills sit on the border colour, as in light mode.
    disabled: '#2A2F37',
    onDisabled: '#6E7682',
    grid: '#22262D',
    // derived: 32% ink disappears on a dark page; a deeper black scrim keeps
    // the dialog separated without a glow.
    scrim: 'rgba(0, 0, 0, 0.56)',
  },
};

/** Elevation: borders first. Dark mode uses `raised` instead of shadows. */
export const elevation: Record<ThemeName, { e1: string; e2: string }> = {
  light: {
    e1: '0 1px 2px rgba(16, 24, 40, 0.05), 0 4px 12px rgba(16, 24, 40, 0.06)',
    e2: '0 16px 40px rgba(16, 24, 40, 0.14)',
  },
  dark: { e1: 'none', e2: 'none' },
};

export const fonts = {
  sans: "'Geist Variable', 'Noto Sans Armenian Variable', Inter, system-ui, sans-serif",
  mono: "'Geist Mono Variable', ui-monospace, SFMono-Regular, Menlo, monospace",
} as const;

export interface TypeStyle {
  size: number;
  lineHeight: number;
  weight: 400 | 500 | 600;
  /** In em. */
  tracking: number;
}

/** The Type board's scale, in px. */
export const typeScale = {
  'display-xl': { size: 40, lineHeight: 44, weight: 500, tracking: -0.02 },
  'display-l': { size: 32, lineHeight: 38, weight: 500, tracking: -0.02 },
  'heading-page': { size: 24, lineHeight: 32, weight: 600, tracking: -0.01 },
  'heading-section': { size: 18, lineHeight: 26, weight: 600, tracking: -0.01 },
  'title-card': { size: 15, lineHeight: 22, weight: 600, tracking: 0 },
  body: { size: 14, lineHeight: 20, weight: 400, tracking: 0 },
  'body-small': { size: 13, lineHeight: 18, weight: 400, tracking: 0 },
  label: { size: 12, lineHeight: 16, weight: 500, tracking: 0.01 },
  caption: { size: 11, lineHeight: 14, weight: 500, tracking: 0.02 },
} as const satisfies Record<string, TypeStyle>;

/** 4 px base. Tailwind's default spacing is the same scale, so it is not re-declared. */
export const space = [2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64] as const;

export const radius = { xs: 4, s: 6, m: 10, l: 14, full: 999 } as const;

/** Minimum widths: below `sm` is mobile web, `md` is laptop with a rail, `lg` is large desktop. */
export const breakpoints = { sm: 768, md: 1024, lg: 1440 } as const;

export interface MotionToken {
  duration: number;
  easing: string;
}

/** The Motion board's tokens, in ms. */
export const motion = {
  instant: { duration: 100, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
  control: { duration: 160, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
  select: { duration: 240, easing: 'cubic-bezier(0.3, 1.25, 0.6, 1)' },
  panel: { duration: 240, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
  exit: { duration: 200, easing: 'cubic-bezier(0.4, 0, 1, 1)' },
  nav: { duration: 280, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
  amount: { duration: 320, easing: 'cubic-bezier(0.33, 1, 0.68, 1)' },
  chart: { duration: 520, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
} as const satisfies Record<string, MotionToken>;
