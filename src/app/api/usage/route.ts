import { generationHandler } from '@/lib/server/generation-runtime';
export const runtime = 'nodejs';
export async function GET(request: Request) { return generationHandler(request, 'usage'); }
