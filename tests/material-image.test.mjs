import test from 'node:test';
import assert from 'node:assert/strict';
import { materialImage, MAX_IMAGE_BYTES } from '../src/lib/material-image.ts';
import { generationInput, createGenerationBody } from '../src/lib/gemini.ts';
import { materialAnalysisPending } from '../src/lib/material-analysis.ts';
import { generationHash } from '../src/lib/server/generation-usage.ts';
import { readStudyBody } from '../src/lib/server/study-http.ts';
const image={mimeType:'image/png',data:Buffer.from('\x89PNG\r\n\x1a\n','latin1').toString('base64')};
const input={mode:'material',title:'이미지 자료',image,count:2};
test('image input validates MIME, signature, base64 and size before provider use',()=>{
  assert.equal(materialImage.safeParse(image).success,true);
  for(const bad of [{...image,mimeType:'image/svg+xml'},{...image,mimeType:'image/jpeg'},{...image,data:'!!!'},{...image,data:Buffer.alloc(MAX_IMAGE_BYTES+1).toString('base64')},{...image,url:'https://private.invalid'}])assert.equal(materialImage.safeParse(bad).success,false);
  assert.equal(generationInput.safeParse({...input,mode:'automatic'}).success,false);
});
test('image-only material builds inline media and preserves request identity without storing raw source in result',()=>{
  const pending=materialAnalysisPending.parse({id:crypto.randomUUID(),input});
  const body=createGenerationBody(pending.input);
  assert.deepEqual(body.contents[0].parts[1],{inlineData:image});
  assert.match(body.contents[0].parts[0].text,/첨부 이미지/);
  assert.match(body.systemInstruction.parts[0].text,/추측하지/);
  assert.equal(generationHash(pending.input),generationHash(generationInput.parse(input)));
  assert.notEqual(generationHash(pending.input),generationHash(generationInput.parse({...input,text:'보충 설명'})));
});
test('larger image request limit is scoped to generation while ordinary study body stays bounded',async()=>{
  const request=()=>new Request('http://localhost',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({data:'a'.repeat(70000)})});
  await assert.rejects(()=>readStudyBody(request()));
  assert.equal((await readStudyBody(request(),450000)).data.length,70000);
  await assert.rejects(()=>readStudyBody(new Request('http://localhost',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({data:'a'.repeat(450001)})}),450000));
});

import { createGenerationHandlers } from '../src/lib/server/generation-http.ts';
import { generationMemoryDatabase } from './helpers/generation-db.mjs';
test('authenticated image analysis uses one provider call on replay and never writes image bytes to Firestore',async()=>{
  let calls=0;const db=generationMemoryDatabase();const writes=[];const transaction=db.transaction.bind(db);
  db.transaction=run=>transaction(tx=>run({...tx,set:(path,value)=>{writes.push(value);tx.set(path,value);}}));
  const handler=createGenerationHandlers({authenticate:async()=>({uid:'image-user'}),database:()=>db,
    environment:()=>({AI_GENERATION_ENABLED:'true',GEMINI_API_KEY:'fake',AI_COOLDOWN_SECONDS:'0'}),
    fetcher:async(_url,options)=>{calls++;assert.deepEqual(JSON.parse(options.body).contents[0].parts[1],{inlineData:image});
      return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({title:'이미지 학습',cards:[{question:'사진 속 개념은?',answer:'테스트 답',category:'과학',tags:['테스트'],difficulty:'초급'}]})}]}}]});}});
  const id=crypto.randomUUID();const request=()=>new Request('http://localhost/api/generate',{method:'POST',headers:{'content-type':'application/json','idempotency-key':id},body:JSON.stringify(input)});
  const first=await handler(request(),'generate');assert.equal(first.status,200);const body=await first.json();assert.equal(body.cards.length,1);
  assert.equal((await handler(request(),'generate')).status,200);assert.equal(calls,1);
  assert.equal(JSON.stringify(body).includes(image.data),false);
  assert.equal(JSON.stringify(writes).includes(image.data),false);
});
