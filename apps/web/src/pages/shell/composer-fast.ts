/** Whether the composer should show a fast-tier toggle for this catalog entry. */
export function modelSupportsFastTier(entry: { supportsFastTier?: boolean } | undefined): boolean {
  return entry?.supportsFastTier === true;
}
