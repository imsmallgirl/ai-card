import { generationHandler } from '@/lib/server/generation-runtime';
export const runtime = 'nodejs';
export const maxDuration = 60;
export async function POST(request: Request) { return generationHandler(request, 'generate'); }
