import test from 'node:test';
import assert from 'node:assert/strict';
import { submitPose, pollPose } from '../services/image-studio/image-server/image-chat-pose.mjs';
const id = '12345678-1234-1234-1234-123456789abc';
const data = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aA1sAAAAASUVORK5CYII=';
test('pose submits once through existing controls API and polls the same job until a map is ready', async () => {
  let submissions = 0, polls = 0;
  const fetchImpl = async (url, options) => {
    if (options?.method === 'POST') { submissions++; assert.equal(url,'/api/controls?mode=pose&ext=png'); assert.equal(options.headers['Content-Type'],'application/octet-stream'); assert.equal(options.body[0],137); return {ok:true,json:async()=>({id})}; }
    if (url.endsWith('.png')) return {ok:true,blob:async()=>new Blob([Buffer.from(data.split(',')[1],'base64')],{type:'image/png'})};
    assert.equal(url,`/api/controls/${id}`); polls++;
    return {ok:true,json:async()=>polls === 1 ? {status:'running'} : {status:'ready',files:[{name:'pose.png',url:`/api/controls/${id}/pose.png`}]}};
  };
  assert.equal(await submitPose(data,fetchImpl),id);
  const result = await pollPose(id,{fetchImpl,wait:async()=>{}});
  assert.equal(result.role,'pose_map'); assert.equal(result.data,data); assert.equal(submissions,1); assert.equal(polls,2);
});
test('unknown jobs, failed jobs and untrusted result paths are rejected without submitting again', async () => {
  for (const job of [{status:'unknown'},{status:'failed',error:'No pose detected.'},{status:'ready',files:[{name:'map.png',url:'https://untrusted.example/map.png'}]}]) {
    await assert.rejects(pollPose(id,{fetchImpl:async(url,options)=>{assert.equal(options,undefined);return {ok:true,json:async()=>job};},wait:async()=>{}}));
  }
  let calls = 0;
  await assert.rejects(submitPose(data,async()=>{calls++;throw new Error('network interrupted');}));
  assert.equal(calls,1);
});
