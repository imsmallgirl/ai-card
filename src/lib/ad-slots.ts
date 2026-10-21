// Layout integration points only. No ad SDK, account, unit ID, tracking or network request.
export const AD_PLACEMENTS = ['dashboard','deck-list','completion','landing'] as const;
export type AdPlacement = typeof AD_PLACEMENTS[number];
export const ADS_CONFIG = { enabled:false } as const;
