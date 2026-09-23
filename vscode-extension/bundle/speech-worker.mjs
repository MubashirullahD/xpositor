import { speechPhrases } from './src/speech-timing.js';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
const root=process.env.PATCHWORK_VOICE_HOME;
const require=createRequire(join(root,'package.json'));
let model;
process.on('message',async({id,text,voice})=>{
 try{
  if(!model){const {KokoroTTS,env}=await import(pathToFileURL(require.resolve('kokoro-js')).href);if(env)env.cacheDir=join(root,'models');model=await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX',{dtype:'q8',device:'cpu',cache_dir:join(root,'models')});}
  const chunks=[],timings=[];let length=0,sampleRate=24000;
  for(const phrase of speechPhrases(text)){
   const audio=await model.generate(text.slice(phrase.start,phrase.end),{voice});
   sampleRate=audio.sampling_rate;timings.push({...phrase,time:length/sampleRate,duration:audio.audio.length/sampleRate});chunks.push(audio.audio);length+=audio.audio.length;
  }
  const pcm=new Float32Array(length);let offset=0;for(const chunk of chunks){pcm.set(chunk,offset);offset+=chunk.length;}
  const wav=Buffer.alloc(44+pcm.length*2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(sampleRate,24);wav.writeUInt32LE(sampleRate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(pcm.length*2,40);
  for(let i=0;i<pcm.length;i++)wav.writeInt16LE(Math.round(Math.max(-1,Math.min(1,pcm[i]))*32767),44+i*2);
  process.send({id,audio:wav.toString('base64'),timings});
 }catch(error){process.send({id,error:error.message});}
});
