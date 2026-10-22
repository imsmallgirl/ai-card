import { z } from 'zod';
export const MAX_IMAGE_BYTES = 256 * 1024;
export const materialImage = z.object({
  mimeType: z.enum(['image/jpeg','image/png','image/webp']),
  data: z.string().min(4).max(Math.ceil(MAX_IMAGE_BYTES/3)*4).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
}).strict().refine(image=>{
  try {
    const bytes=atob(image.data);
    if(bytes.length>MAX_IMAGE_BYTES)return false;
    if(image.mimeType==='image/jpeg')return bytes.startsWith('\xff\xd8\xff');
    if(image.mimeType==='image/png')return bytes.startsWith('\x89PNG\r\n\x1a\n');
    return bytes.startsWith('RIFF')&&bytes.slice(8,12)==='WEBP';
  } catch {return false;}
},'이미지 형식 또는 크기를 확인해 주세요.');
export type MaterialImage = z.infer<typeof materialImage>;
