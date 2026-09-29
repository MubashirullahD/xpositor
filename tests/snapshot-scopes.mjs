import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync,renameSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createSnapshotStore} from '../snapshot.mjs';
const repo=mkdtempSync(join(tmpdir(),'patchwork-scopes-'));
const git=(...args)=>execFileSync('git',args,{cwd:repo,stdio:'pipe'});
const write=(path,text)=>writeFileSync(join(repo,path),text);
try {
 git('init','-q');git('config','user.name','Test');git('config','user.email','test@example.invalid');
 const store=createSnapshotStore(repo);
 write('first.js','index\n');git('add','.');write('first.js','working\n');write('untracked.js','untracked\n');
 let staged=store.capture('staged'),unstaged=store.capture('unstaged');
 assert.deepEqual(staged.files.map(f=>f.path),['first.js']);assert.equal(store.getFile(staged.snapshotId,{path:'first.js'}).source,'index\n');
 assert.deepEqual(unstaged.files.map(f=>f.path),['first.js','untracked.js']);assert.equal(unstaged.files[0].lines[0][2],'index');
 git('add','.');git('commit','-qm','Initial');
 write('first.js','staged change\n');git('add','first.js');write('first.js','working change\n');
 staged=store.capture('staged');unstaged=store.capture('unstaged');const all=store.capture('all');
 assert.equal(store.getFile(staged.snapshotId,{path:'first.js'}).source,'staged change\n');
 assert.equal(store.getFile(unstaged.snapshotId,{path:'first.js'}).source,'working change\n');
 assert.equal(staged.files[0].lines.find(l=>l[0]==='removed')[2],'working');
 assert.equal(unstaged.files[0].lines.find(l=>l[0]==='removed')[2],'staged change');
 assert.notEqual(staged.base,unstaged.base);assert.notEqual(staged.base,all.base);
 write('first.js','working\n');assert.equal(store.capture('all').files.length,0);assert.equal(store.capture('staged').files.length,1);assert.equal(store.capture('unstaged').files.length,1);
 git('add','.');
 renameSync(join(repo,'first.js'),join(repo,'renamed.js'));git('add','.');write('renamed.js','edited after rename\n');
 staged=store.capture('staged');unstaged=store.capture('unstaged');assert.equal(staged.files[0].oldPath,'first.js');assert.equal(unstaged.files[0].path,'renamed.js');
 assert.equal(store.getFile(staged.snapshotId,{path:'renamed.js'}).source,'working\n');
 git('add','.');git('commit','-qm','Rename');git('rm','renamed.js');write('renamed.js','recreated\n');
 assert.equal(store.capture('staged').files[0].sourceAvailable,false);assert.equal(store.capture('unstaged').files[0].status,'?');
 assert.throws(()=>store.capture('invalid'),e=>e.status===400);
 // A refresh keeps the snapshot (and its walkthrough) while the review itself is unchanged.
 const identityRepo=mkdtempSync(join(tmpdir(),'patchwork-identity-'));const g=(...args)=>execFileSync('git',args,{cwd:identityRepo,stdio:'pipe'});const w=(path,text)=>writeFileSync(join(identityRepo,path),text);
 try{
  g('init','-q');g('config','user.name','Test');g('config','user.email','test@example.invalid');w('review.js','one\n');w('other.js','one\n');g('add','.');g('commit','-qm','Initial');
  const identity=createSnapshotStore(identityRepo);w('review.js','two\n');
  const first=identity.capture('unstaged',{reuse:true});
  w('other.js','two\n');g('add','other.js');g('commit','-qm','Unrelated');
  assert.equal(identity.capture('unstaged',{reuse:true}).snapshotId,first.snapshotId,'Committing another file must not replace the unstaged review.');
  g('add','review.js');const staged=identity.capture('staged',{reuse:true});w('review.js','three\n');
  assert.equal(identity.capture('staged',{reuse:true}).snapshotId,staged.snapshotId,'A worktree edit must not replace the staged review.');
  const edited=identity.capture('unstaged',{reuse:true});
  assert.notEqual(edited.snapshotId,first.snapshotId,'Editing a reviewed file creates a new snapshot.');
  const comparison=identity.compare(first.snapshotId,edited.snapshotId);
  assert.deepEqual([comparison.sameScope,comparison.changed],[true,['review.js']]);
  assert.equal(identity.compare(first.snapshotId,staged.snapshotId).sameScope,false);
 }finally{rmSync(identityRepo,{recursive:true,force:true});}
 console.log('Scope snapshots passed: unborn, partial staging, index source, inverse changes, renames, recreated deletions and review-only snapshot identity.');
}finally{rmSync(repo,{recursive:true,force:true});}
