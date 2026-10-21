export function goalProgress(completed:number,goal:number) {
  if(!Number.isFinite(completed)||!Number.isFinite(goal)||goal<=0)return 0;
  return Math.max(0,Math.min(100,Math.round(completed/goal*100)));
}
