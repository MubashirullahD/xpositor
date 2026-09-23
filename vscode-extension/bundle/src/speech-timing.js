// Speech is generated in bounded phrases. Offsets refer to the original script.
export function speechPhrases(text) {
 const phrases=[];
 for(const sentence of new Intl.Segmenter('en',{granularity:'sentence'}).segment(text)) {
  let start=sentence.index,end=start+sentence.segment.length;
  while(start<end){
   let stop=Math.min(end,start+250);
   if(stop<end){const space=text.lastIndexOf(' ',stop);if(space>start)stop=space;}
   if(text.slice(start,stop).trim())phrases.push({start,end:stop});
   start=stop;while(start<end&&/\s/.test(text[start]))start++;
  }
 }
 // Avoid a separate synthesis call for tiny fragments such as “Yes.”
 const grouped=[];
 for(const phrase of phrases){const previous=grouped.at(-1);if(previous&&previous.end-previous.start<40&&phrase.end-previous.start<=250)previous.end=phrase.end;else grouped.push({...phrase});}
 return grouped;
}
export function estimatedWordCues(text,phrases) {
 const cues=[];
 for(const phrase of phrases||[]){
  if(!Number.isFinite(phrase.time)||!Number.isFinite(phrase.duration)||phrase.duration<=0||!Number.isInteger(phrase.start)||!Number.isInteger(phrase.end)||phrase.start<0||phrase.end>text.length)continue;
  const words=[...text.slice(phrase.start,phrase.end).matchAll(/\S+/g)];
  const weight=w=>Math.max(2,w.length)+(/[.!?,;:]$/.test(w)?3:0);
  const total=words.reduce((n,w)=>n+weight(w[0]),0);let elapsed=0;
  for(const w of words){const duration=weight(w[0])/total*phrase.duration;cues.push({offset:phrase.start+w.index,start:phrase.time+elapsed,end:phrase.time+elapsed+duration});elapsed+=duration;}
 }return cues;
}
