import { estimatedWordCues } from './speech-timing.js';
import { escapeHtml as esc } from './render.js';

// One clip per logical range; oversized ranges may contain several speech parts.
// Serialize preparation because the local voice worker handles one job at a time.
export function createDeepAudio({apiFetch, render, next, active}) {
  const cache = new Map(), pending = new Map(), prefetched = new Set();
  let queue = Promise.resolve(), audio, media, url, key = '', token = 0, loading = false;
  let error = '', root, cues = [], offset = 0, part = 0, clip, timer, attempted = '';
  let autoplay = false, mountedItem;
  let voice = 'af_heart', speed = 1, continuous = false;
  const identity = item => JSON.stringify([item.snapshotId, item.id, item.index, item.group, voice]);
  function stop() {
    token++; clearTimeout(timer);
    if(audio){audio.pause();audio.ontimeupdate=null;audio.onseeked=null;audio.onended=null;audio.onerror=null;}
    if (url) URL.revokeObjectURL(url);
    audio = null; url = null; loading = false; key = ''; cues = []; clip = null;
  }
  async function load(item) {
    const id = identity(item), selectedVoice = voice;
    if (cache.has(id)) return cache.get(id);
    if (pending.has(id)) return pending.get(id);
    const work = queue.catch(()=>{}).then(async () => {
      const parts = [];
      for (let chunk = 0, total = 1; chunk < total; chunk++) {
        let response;
        for (let retry=0; retry<4; retry++) {
          response = await apiFetch('/api/guide/deep/speech', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({conversationId:item.id,index:item.index,group:item.group,chunk,voice:selectedVoice}),signal:AbortSignal.timeout(660000)});
          if (response.status!==429 || retry===3) break;
          await new Promise(resolve=>setTimeout(resolve,1000*(retry+1)));
        }
        if (!response.ok) { const body=await response.json(); throw new Error(body.error || 'Local audio is unavailable.'); }
        total = Math.max(1, Number(response.headers.get('x-xpositor-audio-chunks')) || 1);
        let timings=[];try {timings=JSON.parse(response.headers.get('x-xpositor-speech-timing')||'[]');} catch {}
        parts.push({blob:await response.blob(),timings,text:decodeURIComponent(response.headers.get('x-xpositor-speech-text')||''),offset:Number(response.headers.get('x-xpositor-speech-offset'))||0});
      }
      const bytes=parts.reduce((sum,p)=>sum+p.blob.size,0);
      while(cache.size && (cache.size>=3 || [...cache.values()].reduce((sum,c)=>sum+c.bytes,0)+bytes>24*1024*1024))cache.delete(cache.keys().next().value);
      const result={parts,bytes};if(bytes<=24*1024*1024)cache.set(id,result);return result;
    });
    queue=work;pending.set(id,work);
    try{return await work;}finally{pending.delete(id);}
  }
  function updateWords() {
    const cue=cues.find(c=>audio.currentTime>=c.start && audio.currentTime<c.end);
    root?.querySelectorAll('.lesson-word').forEach(el=>el.classList.toggle('is-spoken',Boolean(cue)&&Number(el.dataset.offset)===cue.offset+offset));
  }
  function mountPart(item, index) {
    if(url)URL.revokeObjectURL(url);
    mountedItem=item;part=index;const data=clip.parts[index];offset=data.offset;
    cues=estimatedWordCues(data.text||item.text,data.timings);
    url=URL.createObjectURL(data.blob);audio=media||=new Audio();audio.src=url;audio.playbackRate=speed;
    audio.ontimeupdate=updateWords;audio.onseeked=updateWords;
    const own=token;
    audio.onended=async()=>{
      if(own!==token)return;
      if(part+1<clip.parts.length){mountPart(item,part+1);await play();return;}
      render();
      if(continuous)timer=setTimeout(()=>{if(own===token&&active())next();},750);
    };
    audio.onerror=()=>{if(own!==token)return;error='Audio could not play. You can retry or read the explanation.';stop();render();};
  }
  async function prepare(item, following) {
    if (!item) return;
    const id=identity(item);
    if(key===id || attempted===id)return;
    stop();key=id;attempted=id;error='';loading=true;const own=token;render();
    try {
      const result=await load(item);
      if(own!==token || !active())return;
      clip=result;loading=false;mountPart(item,0);const startPlaying=autoplay;autoplay=false;render();if(startPlaying)await play();
      prefetch(following);
    } catch(e) {if(own===token){loading=false;error=e.message;render();}}
  }
  async function play() {
    clearTimeout(timer);
    if(!audio)return;
    if(!audio.paused){audio.pause();render();return;}
    if(audio.ended){mountPart(mountedItem,0);}
    try{await audio.play();error='';}catch{error='Tap Play again to allow audio playback.';}
    render();
  }
  function html(text,online=true) {
    text=text.trim().replace(/\s+/g,' ');
    let offset=0;
    return `<div class="lesson-controls"><button class="secondary-button" data-deep="previous">Back</button><button class="primary-button" data-deep="play" ${loading||(!online&&!audio)?'disabled':''}>${!online&&!audio?'Audio offline':loading?'Preparing audio…':audio&&!audio.paused?'Pause':error&&!audio?'Retry audio':'Play'}</button><button class="secondary-button" data-deep="next">Next</button></div><p class="lesson-transcript">${text.split(/(\s+)/).map(word=>{const start=offset;offset+=word.length;return /^\s+$/.test(word)?esc(word):`<span class="lesson-word" data-offset="${start}">${esc(word)}</span>`;}).join('')}</p><div class="deep-audio-meta"><span role="status">${loading?'Preparing local audio':audio?'Audio ready':'Read at your own pace'}</span><label><input id="deep-continuous" type="checkbox" ${continuous?'checked':''}> Auto-advance</label></div>${error?`<p class="guide-error" role="alert">${esc(error)}</p>`:''}<details class="lesson-options"><summary>Voice & speed</summary><label>Voice <select id="deep-voice">${[['af_heart','Heart'],['af_bella','Bella'],['am_michael','Michael']].map(([id,name])=>`<option value="${id}" ${voice===id?'selected':''}>${name}</option>`).join('')}</select></label><label>Speed <select id="deep-speed">${[0.8,1,1.2,1.5].map(n=>`<option ${speed===n?'selected':''}>${n}</option>`).join('')}</select></label></details>`;
  }
  function prefetch(item){if(!item||prefetched.has(identity(item)))return;prefetched.add(identity(item));load(item).catch(()=>{});}
  function bind(element,item,following,online) {
    root=element;if(!item)stop();if(audio)updateWords();
    if(online&&audio&&item&&key===identity(item))prefetch(following);
    root.querySelector('#deep-continuous')?.addEventListener('change',e=>{continuous=e.target.checked;if(!continuous){clearTimeout(timer);autoplay=false;}});
    root.querySelector('#deep-speed')?.addEventListener('change',e=>{speed=Number(e.target.value);if(audio)audio.playbackRate=speed;});
    root.querySelector('#deep-voice')?.addEventListener('change',e=>{voice=e.target.value;stop();attempted='';render();});
    if(online&&item&&key!==identity(item)&&attempted!==identity(item))queueMicrotask(()=>prepare(item,following));
  }
  // Pause without discarding the clip, so Play resumes from the same word.
  function pause(){clearTimeout(timer);autoplay=false;if(audio&&!audio.paused){audio.pause();render();}}
  return {html,bind,play,pause,prepare,requestAutoplay:()=>{autoplay=true;},stop:()=>{stop();attempted='';autoplay=false;},retry:(item,following)=>{attempted='';stop();return prepare(item,following);}};
}
