export const FOCUS_MS=25*60*1000;
export const BREAK_MS=5*60*1000;
export const newTimer=()=>({phase:'focus',remainingMs:FOCUS_MS,endsAt:null});
export function sanitizeTimer(value) {
 const phase=value?.phase==='break'?'break':'focus',duration=phase==='focus'?FOCUS_MS:BREAK_MS;
 return {phase,remainingMs:Number.isFinite(value?.remainingMs)?Math.max(0,Math.min(duration,value.remainingMs)):duration,endsAt:Number.isFinite(value?.endsAt)&&value.endsAt>0?value.endsAt:null};
}
export function advanceTimer(timer,now=Date.now()) {
 if(timer.endsAt===null||now<timer.endsAt)return '';
 if(timer.phase==='focus') {
  const breakEnd=timer.endsAt+BREAK_MS;
  if(now<breakEnd){Object.assign(timer,{phase:'break',remainingMs:BREAK_MS,endsAt:breakEnd});return 'Focus complete. Take a five-minute screen-free break.';}
 }
 Object.assign(timer,newTimer());return 'Break complete. Start your next focus session when you’re ready.';
}
export function remainingTime(timer,now=Date.now()){return Math.max(0,timer.endsAt===null?timer.remainingMs:timer.endsAt-now);}
export function toggleTimer(timer,now=Date.now()) {
 const message=advanceTimer(timer,now);
 if(timer.endsAt!==null){timer.remainingMs=remainingTime(timer,now);timer.endsAt=null;}
 else timer.endsAt=now+timer.remainingMs;
 return message;
}
export function timerLabel(timer,now=Date.now()) {const seconds=Math.ceil(remainingTime(timer,now)/1000);return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;}
