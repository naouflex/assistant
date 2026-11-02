/** Rounded mountain silhouette for the Atlas avatar. Coordinates are local to the group translated by (0, 9). */
export const LOGO_BODY_PATH =
  "M11.41 79.46C9.09 79.46 6.95 78.2 5.82 76.17C4.68 74.15 4.73 71.66 5.95 69.68C19.23 48.09 32.52 26.49 45.8 4.89C46.7 3.43 48.29 2.54 50 2.54C51.71 2.54 53.3 3.43 54.2 4.89C67.48 26.49 80.77 48.09 94.05 69.68C95.27 71.66 95.32 74.15 94.18 76.17C93.05 78.2 90.91 79.46 88.59 79.46C62.86 79.46 37.14 79.46 11.41 79.46Z";

/** White snow cap: inset from the peak, with two rounded bumps along the bottom. */
export const LOGO_SNOW_PATH =
  "M33.09 32C38.28 23.55 43.48 15.11 48.67 6.66C48.96 6.2 49.46 5.92 50 5.92C50.54 5.92 51.04 6.2 51.33 6.66C56.52 15.11 61.72 23.55 66.91 32C65.22 32 63.53 30.96 61.84 30.16C60.15 29.35 58.46 27.16 56.76 27.16C55.64 27.16 54.51 26.41 53.38 27.31C52.25 28.21 51.13 32.54 50 32.54C48.87 32.54 47.75 30.73 46.62 29.77C45.49 28.81 44.36 26.77 43.24 26.77C41.54 26.77 39.85 28.9 38.16 29.77C36.47 30.64 34.78 32 33.09 32Z";

/**
 * Same upright pill eyes as the default organic avatar, centered on the mountain
 * face (coordinates are local to the group translated by (0, 9)).
 */
export const LOGO_EYES = [
  { cx: 39.5, cy: 52, width: 7, height: 24 },
  { cx: 60.5, cy: 52, width: 7, height: 24 },
] as const;

/** Shared vector paint palette for web SVG and react-native-svg. */
export function logoAvatarPaint(hex: string, originalOrange = false) {
  const full = hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join("")}` : hex;
  const raw = originalOrange ? "#ff7b08" : full;
  const rgb = [1, 3, 5].map((i) => Number.parseInt(raw.slice(i, i + 2), 16));
  const shade = (factor: number) =>
    `#${rgb
      .map((v) =>
        Math.max(0, Math.min(255, Math.round(v * factor)))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")}`;
  return {
    base: shade(1),
    edge: shade(0.96),
    flank: originalOrange ? "#c14d08" : shade(0.58),
  };
}

/** Shared, directional surface lighting for web and native SVG bodies. */
export const LOGO_AVATAR_LIGHTING = {
  body: { cx: "57%", cy: "28%", r: "78%" },
  flank: {
    gradientUnits: "userSpaceOnUse",
    cx: 0,
    cy: 0,
    r: 1,
    gradientTransform: "matrix(48 0 0 70 8 40)",
  },
  crown: {
    gradientUnits: "userSpaceOnUse",
    cx: 0,
    cy: 0,
    r: 1,
    gradientTransform: "matrix(28 0 0 22 50 8)",
    peak: 0.22,
    shoulder: 0.08,
  },
} as const;
