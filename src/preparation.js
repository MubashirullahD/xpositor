// Ephemeral coordination only: no health data, tracking, or timer persistence.
let current=null,resting=false;
const listeners=new Set();
export const preparation=()=>current;
export const isResting=()=>resting;
export function setResting(value){resting=Boolean(value);}
export function watchPreparation(listener){listeners.add(listener);return ()=>listeners.delete(listener);}
export function prepare(id,label){if(current?.id===id&&current.status==='pending')return;current={id,label,status:'pending'};for(const fn of listeners)fn();}
export function finishPreparation(id,status='ready',resume){if(current?.id!==id||status==='cancelled'&&current.status!=='pending')return;current={...current,status,resume};for(const fn of listeners)fn();}
export function restInvitation(){return `<section class="rest-invitation"><span class="rest-mark" aria-hidden="true">◌</span><div><strong>Your guide is being prepared</strong><p>Why not try a breathing exercise while you wait?</p><button class="secondary-button" data-action="mindfulness-open" data-location="waiting">Try a breathing exercise</button></div></section>`;}
export function preparationMessage(){if(!current)return '';return current.status==='pending'?`${current.label} is still preparing. Take your time.`:current.status==='ready'?`${current.label} is ready. Come back when you’re ready.`:current.status==='cancelled'?'Preparation stopped. You can still take this moment.':`${current.label} needs attention. Your place is saved.`;}
