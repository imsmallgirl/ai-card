import { analyticsHandler } from '@/lib/server/analytics-runtime';
export const runtime = 'nodejs';
export async function GET(request: Request) { return analyticsHandler(request, 'consent'); }
export async function POST(request: Request) { return analyticsHandler(request, 'consent'); }
