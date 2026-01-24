// Plan limits configuration
export const PLAN_LIMITS = {
  Free: {
    dailyEditions: 3,
    dailyResearch: 2,
    vaultSize: 10,
    chatMessagesPerEdition: 10,
    allowedRegions: ['Global'],
    allowedLanguages: ['English'],
    audioQuality: '24khz',
    pdfExport: false,
    priorityQueue: false,
  },
  Pro: {
    dailyEditions: 999,
    dailyResearch: 999,
    vaultSize: 999,
    chatMessagesPerEdition: 999,
    allowedRegions: 'all',
    allowedLanguages: 'all',
    audioQuality: '48khz',
    pdfExport: true,
    priorityQueue: true,
  },
} as const;

export type Plan = keyof typeof PLAN_LIMITS;

export function getPlanLimits(plan: string) {
  return PLAN_LIMITS[plan as Plan] || PLAN_LIMITS.Free;
}
