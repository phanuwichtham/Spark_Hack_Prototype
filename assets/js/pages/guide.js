SPARK.page=function(){
  const S=SPARK,U=S.ui;
  for(const el of document.querySelectorAll('[data-demo-only]'))el.hidden=S.cloud.enabled;
  document.querySelector('#group-guide').hidden=!S.cloud.enabled;
  if(S.cloud.enabled)return;
  document.querySelectorAll('[data-scenario]').forEach(b=>b.onclick=()=>U.scenario(b.dataset.scenario));
  document.querySelector('#reset-demo').onclick=()=>U.scenario('normal');
};
