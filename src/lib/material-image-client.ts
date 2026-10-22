import { materialImage, type MaterialImage } from './material-image.ts';
export async function prepareMaterialImage(file:File):Promise<MaterialImage>{
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>10*1024*1024)throw new Error('JPG·PNG·WebP 이미지 한 장(최대 10MB)을 선택해 주세요.');
  const bitmap=await createImageBitmap(file);
  try{
    if(bitmap.width*bitmap.height>40000000)throw new Error('이미지가 너무 큽니다. 필요한 부분을 잘라 다시 선택해 주세요.');
    const scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height));
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
    const context=canvas.getContext('2d');if(!context)throw new Error('이미지를 처리할 수 없는 브라우저입니다.');
    context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(bitmap,0,0,canvas.width,canvas.height);
    for(const quality of [.88,.72,.55,.38]){
      const result=materialImage.safeParse({mimeType:'image/jpeg',data:canvas.toDataURL('image/jpeg',quality).split(',')[1]});
      if(result.success)return result.data;
    }
    throw new Error('이미지가 복잡하거나 큽니다. 문제 영역만 잘라 다시 등록해 주세요.');
  }finally{bitmap.close();}
}
