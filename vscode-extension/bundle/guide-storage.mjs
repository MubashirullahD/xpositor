import { mkdirSync, readFileSync, writeFileSync, renameSync, rmSync, lstatSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// Private companion-owned files; no browser-supplied path reaches the filesystem.
export function createGuideStorage(directory, repoId, { maxSnapshots = 8 } = {}) {
  if (!/^[a-f0-9]{64}$/.test(repoId)) throw new Error('Invalid repository identity for guide storage.');
  const root = join(directory, repoId);
  const pathFor = id => {
    if (!/^[a-zA-Z0-9_-]{16,180}$/.test(id)) throw new Error('Invalid snapshot identity.');
    return join(root, `snapshot-${id}.json`);
  };
  function read(path, limit) {
    try {
      const rootInfo=lstatSync(root);
      if(!rootInfo.isDirectory()||rootInfo.isSymbolicLink())throw new Error('Guide storage must be a regular directory.');
      const info=lstatSync(path);
      if(!info.isFile()||info.isSymbolicLink()||info.size>limit)throw new Error('Saved guide data is unsafe or too large.');
      return JSON.parse(readFileSync(path,'utf8'));
    }catch(error){if(error.code==='ENOENT')return null;throw error;}
  }
  function write(path, value, limit) {
    const text=JSON.stringify(value);
    if(Buffer.byteLength(text)>limit)throw new Error('Saved guide data exceeds the storage limit.');
    mkdirSync(root,{recursive:true,mode:0o700});
    if(lstatSync(root).isSymbolicLink())throw new Error('Guide storage must not be a symbolic link.');
    const temporary=join(root,`.write-${randomUUID()}`);
    try{writeFileSync(temporary,text,{flag:'wx',mode:0o600});renameSync(temporary,path);}finally{rmSync(temporary,{force:true});}
  }
  return {
    load:()=>read(join(root,'conversations.json'),32*1024*1024),
    save:value=>write(join(root,'conversations.json'),value,32*1024*1024),
    loadSnapshot:id=>read(pathFor(id),64*1024*1024),
    saveSnapshot(id,value){
      const path=pathFor(id);write(path,value,64*1024*1024);
      const entries=readdirSync(root).filter(name=>/^snapshot-[a-zA-Z0-9_-]+\.json$/.test(name)).map(name=>({name,time:lstatSync(join(root,name)).mtimeMs})).sort((a,b)=>b.time-a.time);
      for(const entry of entries.slice(maxSnapshots))rmSync(join(root,entry.name));
    },
  };
}
