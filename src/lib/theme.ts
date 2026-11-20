/**
 * Dark only, for now (Marshall, 2026-11-19: "Temporarily disable the light
 * mode"). Every visitor gets the dark theme whatever their device asks for,
 * the Studio included. Set this to false to follow the device again: the
 * light theme's colours are all still in globals.css, untouched.
 *
 * Read by the theme provider (forcedTheme) and by the root layout (the colour
 * of the browser's own bar on phones).
 */
export const DARK_ONLY = true;
