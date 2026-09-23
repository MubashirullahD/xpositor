// File summaries are generated from the immutable capture before the walkthrough.
// Batching keeps prompts small; a few independent Codex clients can work at once.
const BATCH_SIZE = 8;
const WORKERS = 4;
const SUMMARY_LIMIT = 800;

export const FILE_OVERVIEW_SCHEMA = {
  type:'object', additionalProperties:false, required:['files'],
  properties:{files:{type:'array',maxItems:BATCH_SIZE,items:{type:'object',additionalProperties:false,required:['path','summary'],properties:{path:{type:'string'},summary:{type:'string',minLength:1,maxLength:SUMMARY_LIMIT}}}}},
};

export function skipFileOverview(path) {
  return /(?:^|\/)(?:package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|Cargo\.lock|poetry\.lock|Pipfile\.lock|Gemfile\.lock|composer\.lock|uv\.lock|go\.sum)$/i.test(path);
}

export function fileOverviewPrompt(repository, files) {
  const entries=files.map(file=>{
    const source=repository.read(file.path);
    return {path:file.path,status:file.status||'changed',sourceReason:source.reason||file.sourceReason||null,
      diff:JSON.stringify(file.lines||[]).slice(0,3500),source:typeof source.source==='string'?source.source.slice(0,1500):null};
  });
  return `Summarize each changed file separately for its own Overview tab. Use only this immutable snapshot data. Explain that file's role and what changed in one or two concrete sentences. Do not reuse a generic summary across files, infer unshown behavior as fact, or claim to have read truncated content. Return exactly one files item for each listed path, using the path verbatim.\n\nSnapshot ${repository.snapshot.snapshotId}\n${JSON.stringify(entries)}`;
}

export async function generateFileOverviews(repository, ai, {signal,model,effort,onProgress}={}) {
  const files=repository.snapshot.files;
  const summaries=Object.create(null),status=Object.create(null);
  const wanted=[];
  for(const file of files){if(skipFileOverview(file.path))status[file.path]='skipped';else wanted.push(file);}
  const batches=[];
  for(let index=0;index<wanted.length;index+=BATCH_SIZE)batches.push(wanted.slice(index,index+BATCH_SIZE));
  let next=0,completed=files.length-wanted.length;
  const report=()=>onProgress?.({phase:'overviews',completed,total:files.length,fileOverviews:{...summaries},overviewStatus:{...status}});
  await report();
  async function worker(index){
    while(next<batches.length){
      if(signal?.aborted)throw new Error('Stopped.');
      const batch=batches[next++],expected=new Set(batch.map(file=>file.path));
      for(let attempt=0;attempt<2;attempt++){
        const result=await ai.generate(fileOverviewPrompt(repository,batch),{signal,model,effort,jsonSchema:FILE_OVERVIEW_SCHEMA,parallelKey:`file-overview-${index}`,turnTimeoutMs:5*60_000});
        if(signal?.aborted)throw new Error('Stopped.');
        if(result.status!==200){if(attempt===0&&result.status>=500)continue;break;}
        let value;
        try{value=JSON.parse(result.body.text);}catch{if(attempt===0)continue;break;}
        for(const item of Array.isArray(value?.files)?value.files:[]){
          if(!expected.has(item?.path)||typeof item.summary!=='string'||!item.summary.trim()||Object.hasOwn(summaries,item.path))continue;
          summaries[item.path]=item.summary.trim().slice(0,SUMMARY_LIMIT);
          status[item.path]='ready';
        }
        if(batch.every(file=>status[file.path]==='ready'))break;
      }
      for(const file of batch)if(!status[file.path])status[file.path]='failed';
      completed+=batch.length;
      await report();
    }
  }
  const workers=await Promise.allSettled(Array.from({length:Math.min(WORKERS,batches.length)},(_,index)=>worker(index)));
  const failure=workers.find(result=>result.status==='rejected');
  if(failure)throw failure.reason;
  if(signal?.aborted)throw new Error('Stopped.');
  return {fileOverviews:summaries,overviewStatus:status};
}
