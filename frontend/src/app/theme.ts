/**
 * One green palette for the whole interface. Every screen takes its colors from here or from
 * the same hex values, so the public site and the ERP look like one product.
 */
export const C = {
  // Greens, darkest to lightest.
  g950: "#0A2A1C",
  g900: "#0F3B27",
  g800: "#154D33",
  g700: "#1B5E3F", // primary
  g600: "#24714D",
  g500: "#2E8A5C",
  g400: "#5BAA80",
  g300: "#9CCDB1",
  g200: "#C8E4D3",
  g100: "#E3F1E8",
  g50: "#F2F8F4",
  // Neutrals with a green tint.
  ink: "#1E2B25",
  text: "#33433B",
  muted: "#66786F",
  faint: "#9AABA2",
  line: "#DCE5E0",
  bg: "#F5F8F6",
  white: "#FFFFFF",
  // Only for errors and warnings that must stand out.
  danger: "#B3261E",
  dangerBg: "#FBECEA",
  warn: "#8A6400",
  warnBg: "#FBF4E2",
} as const;

export const font = "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif";
