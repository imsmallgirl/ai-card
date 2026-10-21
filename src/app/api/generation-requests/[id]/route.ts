import { generationHandler } from '@/lib/server/generation-runtime';
export const runtime = 'nodejs';
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return generationHandler(request, 'result', (await params).id);
}
