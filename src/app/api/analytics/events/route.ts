import { analyticsHandler } from '@/lib/server/analytics-runtime';
export const runtime = 'nodejs';
export async function POST(request: Request) { return analyticsHandler(request, 'event'); }
