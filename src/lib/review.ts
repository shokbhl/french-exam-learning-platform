export type ReviewRating = 0 | 1 | 2 | 3;
export type ReviewSchedule = { intervalDays: number; ease: number; repetitions: number };
export function scheduleReview(current: ReviewSchedule, rating: ReviewRating): ReviewSchedule {
  if (rating === 0) return { intervalDays: 1, ease: Math.max(1.3,current.ease-.2), repetitions: 0 };
  const repetitions=current.repetitions+1;
  const base=repetitions===1?1:repetitions===2?3:Math.max(4,Math.round(current.intervalDays*current.ease));
  const multiplier=rating===1?.65:rating===3?1.25:1;
  return { intervalDays: Math.max(1,Math.round(base*multiplier)), ease: Math.max(1.3,current.ease+(rating===3?.1:rating===1?-.1:0)), repetitions };
}

export type Mistake = { id:string; skill:"listening"|"reading"; prompt:string; answer:string; correct:string; explanation:string; createdAt:string };
export const mistakeKey="parcours-mistakes-v1";
export function getMistakes():Mistake[]{if(typeof window==="undefined")return[];try{return JSON.parse(localStorage.getItem(mistakeKey)??"[]")}catch{return[]}}
export function addMistake(mistake:Omit<Mistake,"id"|"createdAt">){const items=getMistakes();items.unshift({...mistake,id:crypto.randomUUID(),createdAt:new Date().toISOString()});localStorage.setItem(mistakeKey,JSON.stringify(items.slice(0,100)))}
