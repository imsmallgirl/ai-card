import { analyticsHandler } from '@/lib/server/analytics-runtime';
export const runtime = 'nodejs';
export const maxDuration = 30;
export async function POST(request: Request) { return analyticsHandler(request, 'export'); }
