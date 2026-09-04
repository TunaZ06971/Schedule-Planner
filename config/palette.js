// Berkeleytime 的调色板（packages/theme/.../ThemeProvider.scss 里的 Tailwind 色阶）。
//
// 顺序和取值都照抄它的 `Color` enum 与 CSS 变量，一个字没改。
// 用色相名而不是 hex 存颜色：这样 -500（色块）和 -300（圆点）自动配对，
// 和 Berkeleytime 的 `getColorCSSVar` 用 -300、事件块用 -500 的约定一致。

export const PALETTE = {
  slate:   { label: 'Slate',   c500: '#64748b', c300: '#cbd5e1' },
  gray:    { label: 'Gray',    c500: '#6b7280', c300: '#d1d5db' },
  zinc:    { label: 'Zinc',    c500: '#71717a', c300: '#d4d4d8' },
  neutral: { label: 'Neutral', c500: '#737373', c300: '#d4d4d4' },
  stone:   { label: 'Stone',   c500: '#78716c', c300: '#d6d3d1' },
  red:     { label: 'Red',     c500: '#ef4444', c300: '#fca5a5' },
  orange:  { label: 'Orange',  c500: '#f97316', c300: '#fdba74' },
  amber:   { label: 'Amber',   c500: '#f59e0b', c300: '#fcd34d' },
  yellow:  { label: 'Yellow',  c500: '#eab308', c300: '#fde047' },
  lime:    { label: 'Lime',    c500: '#84cc16', c300: '#bef264' },
  green:   { label: 'Green',   c500: '#22c55e', c300: '#86efac' },
  emerald: { label: 'Emerald', c500: '#10b981', c300: '#6ee7b7' },
  teal:    { label: 'Teal',    c500: '#14b8a6', c300: '#5eead4' },
  cyan:    { label: 'Cyan',    c500: '#06b6d4', c300: '#67e8f9' },
  sky:     { label: 'Sky',     c500: '#0ea5e9', c300: '#7dd3fc' },
  blue:    { label: 'Blue',    c500: '#3b82f6', c300: '#93c5fd' },
  indigo:  { label: 'Indigo',  c500: '#6366f1', c300: '#a5b4fc' },
  violet:  { label: 'Violet',  c500: '#8b5cf6', c300: '#c4b5fd' },
  purple:  { label: 'Purple',  c500: '#a855f7', c300: '#d8b4fe' },
  fuchsia: { label: 'Fuchsia', c500: '#d946ef', c300: '#f0abfc' },
  pink:    { label: 'Pink',    c500: '#ec4899', c300: '#f9a8d4' },
  rose:    { label: 'Rose',    c500: '#f43f5e', c300: '#fda4af' },
}

export const HUES = Object.keys(PALETTE)

export const isHue = (h) => Object.prototype.hasOwnProperty.call(PALETTE, h)

/** 色相名 → 色块颜色；认不出来的退回 gray */
export const hex500 = (hue) => (PALETTE[hue] || PALETTE.gray).c500
/** 色相名 → 圆点颜色 */
export const hex300 = (hue) => (PALETTE[hue] || PALETTE.gray).c300
