SPARK.page=function(){
  'use strict';
  const S=SPARK,U=S.ui,s=U.state(),u=U.user(),e=U.e;
  if(!U.gate(['farmer','coordinator']))return;
  const cages=U.allowedCages(s),wanted=S.util.query('cage'),intent=S.util.query('intent');
  const c=cages.find(c=>c.id===wanted)||(!wanted&&cages.length===1?cages[0]:null);
  const workspace=document.querySelector('#water-workspace'),saved=document.querySelector('#water-saved'),choice=document.querySelector('#water-cage-selection');
  workspace.hidden=true;saved.hidden=true;choice.innerHTML='';
  if(wanted&&!c){U.html('#water-cage-selection',U.empty('ไม่พบกระชังที่บัญชีนี้จดได้','เลือกจากกระชังในบัญชีของตัวเอง','record-water.html','เลือกกระชังใหม่'));return;}
  if(!c){
    choice.innerHTML='<h2>จดให้กระชังไหน?</h2><p>เลือกกระชังก่อน แล้วตอบคำถามทีละขั้น</p><div class="cage-choice-grid">'+cages.map(c=>'<a class="cage-choice" href="record-water.html?cage='+encodeURIComponent(c.id)+(intent==='alert'?'&intent=alert':'')+'">'+U.icon('fish')+'<span><strong>กระชัง '+e(c.id)+' · '+e(c.name)+'</strong><small>'+e(s.users.find(x=>x.id===c.ownerId)?.name||'')+'</small></span></a>').join('')+'</div>'+(cages.length?'':U.empty('ยังไม่มีกระชังในบัญชีนี้','ให้ผู้ประสานช่วยเพิ่มข้อมูลกระชังก่อน','help.html','ให้ผู้ประสานช่วย'));return;
  }
  const savedId=S.util.query('saved'),obs=s.observations.find(o=>o.id===savedId&&o.cageId===c.id);
  if(obs){
    saved.hidden=false;
    saved.innerHTML='<article class="card water-wizard"><h2>สิ่งที่บันทึกไว้</h2><p><strong>กระชัง '+e(c.id)+' · '+e(c.name)+'</strong></p><p>'+e(S.util.date(obs.measuredAt))+'</p><p>'+e(obs.note||'')+'</p>'+(obs.symptoms.length?'<p>อาการที่พบ: '+e(obs.symptoms.join(', '))+'</p>':'')+'<dl class="key-value" style="margin-top:18px">'+Object.entries(S.config.units).map(([k,unit])=>'<dt>'+e(({do:'ออกซิเจน',temperature:'อุณหภูมิ',salinity:'ความเค็ม',ph:'กรด–ด่าง'})[k])+'</dt><dd>'+e(obs.values[k]===null?'ไม่ได้วัด':obs.values[k]+' '+unit)+'</dd>').join('')+'</dl><p class="small" style="margin-top:18px">ผู้ให้ข้อมูล '+e(obs.sourceName||obs.recorder)+' · จดโดย '+e(obs.recorder||u.name)+'</p><div class="actions">'+U.link('risk.html?cage='+c.id,'ดูสิ่งที่ควรทำต่อ','btn')+U.link('dashboard.html','กลับหน้าหลัก')+U.link('traceability.html?cage='+c.id,'จดอาหาร ยา หรือวิธีเลี้ยง')+U.link('record-water.html?cage='+c.id,'จดครั้งถัดไป')+'</div>'+(obs.symptoms.includes('พบปลาตาย')?'<div class="notice warning" style="margin-top:20px">หากทราบจำนวนปลาตาย ให้จดจำนวนและช่วงที่ตรวจเพิ่มได้'+U.link('mortality.html?cage='+c.id,'จดจำนวนปลาตาย')+'</div>':'')+'</article>';return;
  }
  workspace.hidden=false;
  document.querySelector('#water-selected-cage').innerHTML='<div><strong>กระชัง '+e(c.id)+' · '+e(c.name)+'</strong><small>เจ้าของ '+e(s.users.find(x=>x.id===c.ownerId)?.name||'')+'</small></div>'+U.link('record-water.html'+(intent==='alert'?'?intent=alert':''),'เลือกกระชังอื่น','btn secondary');
  const f=document.querySelector('#water-form');
  f.reset();f.elements.measuredAt.value=S.util.localTime(s.demoNow).slice(0,16);f.elements.exactMeasuredAt.value=S.util.localTime(s.demoNow);f.elements.sourceName.value=u.name;f.elements.channel.value='self';
  if(u.role==='coordinator'){f.elements.sourceName.value=s.users.find(x=>x.id===c.ownerId)?.name||'';f.elements.channel.value='';document.querySelector('#water-provenance').open=true;}
  if(intent==='alert')f.elements.inspectionStatus.value='issue';
  let step=0;
  const measuredTime=()=>S.util.fromThaiTime(f.elements.measuredAt.value===f.elements.exactMeasuredAt.value.slice(0,16)?f.elements.exactMeasuredAt.value:f.elements.measuredAt.value);
  const status=()=>f.elements.inspectionStatus.value;
  const hasWater=()=>status()!=='notchecked'&&f.elements.hasWater.value==='yes';
  function sync(){document.querySelector('#water-symptoms').hidden=status()!=='issue';document.querySelector('#water-measured-choice').hidden=status()==='notchecked';document.querySelector('#water-values').hidden=!hasWater();document.querySelector('#water-time-label').textContent=status()==='notchecked'?'แจ้งว่ายังไม่ได้ตรวจเมื่อไร? (เวลาไทย)':'ตรวจหรือสังเกตเมื่อไร? (เวลาไทย)';}
  function error(text){const box=document.querySelector('#water-form-error');box.textContent=text;box.hidden=false;box.focus();}
  function validate(n){
    if(!status()){error('เลือกก่อนว่าวันนี้ได้ตรวจปลาแล้วหรือยัง');return false;}
    if(n<1)return true;
    let time;try{time=measuredTime();}catch(_){error('ตรวจวันและเวลาอีกครั้ง');return false;}
    if(!f.elements.measuredAt.value||!Number.isFinite(new Date(time).getTime())||new Date(time)>new Date(s.demoNow)){error('ตรวจวันและเวลาอีกครั้ง ต้องเป็นเวลาที่เกิดขึ้นแล้ว');return false;}
    if(status()!=='notchecked'&&!f.elements.hasWater.value){error('เลือกว่าครั้งนี้มีค่าน้ำที่วัดไว้หรือไม่มี');return false;}
    if(status()==='issue'&&!f.querySelector('[name=symptoms]:checked')&&!f.elements.note.value.trim()){error('เลือกอาการที่เห็น หรือเขียนอาการเพิ่มเติมในช่องอยากจดอะไรเพิ่ม');return false;}
    if(hasWater()){
      const inputs=[...f.querySelectorAll('#water-values input[type=number]')];
      if(!inputs.some(x=>x.value!=='')){error('กรอกค่าน้ำอย่างน้อยหนึ่งค่าที่วัดได้ หรือเลือกไม่มีค่าวัดในครั้งนี้');return false;}
      for(const input of inputs)if(input.validity.badInput||(input.value!==''&&!input.checkValidity())){error('ตรวจตัวเลขในช่อง '+f.querySelector('label[for="'+input.id+'"]').textContent+' อีกครั้ง');input.focus();return false;}
    }
    if(!f.elements.sourceName.value.trim()||!f.elements.channel.value){document.querySelector('#water-provenance').open=true;error('ระบุผู้ให้ข้อมูลและช่องทางที่ได้รับข้อมูลด้วย');return false;}
    return true;
  }
  function review(){
    const text=({checked:'ตรวจแล้ว ยังไม่พบอาการผิดปกติที่สังเกต',issue:'พบปลามีอาการผิดปกติ',notchecked:'ยังไม่ได้ตรวจปลาในครั้งนี้'})[status()];
    const symptoms=status()==='issue'?[...f.querySelectorAll('[name=symptoms]:checked')].map(x=>x.value):[];
    const values=Object.entries(S.config.units).map(([k,unit])=>'<p>'+e(({do:'ออกซิเจน',temperature:'อุณหภูมิ',salinity:'ความเค็ม',ph:'กรด–ด่าง'})[k])+': '+e(hasWater()&&f.elements[k].value!==''?f.elements[k].value+' '+unit:'ไม่ได้วัด')+'</p>').join('');
    document.querySelector('#water-review').innerHTML='<p><strong>กระชัง '+e(c.id)+' · '+e(c.name)+'</strong></p><p>'+e(S.util.date(measuredTime()))+'</p><p><strong>'+e(text)+'</strong></p>'+(symptoms.length?'<p>อาการ: '+e(symptoms.join(', '))+'</p>':'')+values+(f.elements.note.value.trim()?'<p>จดเพิ่มเติม: '+e(f.elements.note.value.trim())+'</p>':'')+'<p>ผู้ให้ข้อมูล: '+e(f.elements.sourceName.value)+'<br>ผู้จด: '+e(u.name)+'</p>';
  }
  function show(n,focus=true){
    step=n;f.elements.wizardStep.value=String(n);sync();
    document.querySelectorAll('[data-water-step]').forEach(x=>x.hidden=Number(x.dataset.waterStep)!==n);
    document.querySelectorAll('[data-water-progress]').forEach(x=>{x.classList.toggle('active',Number(x.dataset.waterProgress)===n);if(Number(x.dataset.waterProgress)===n)x.setAttribute('aria-current','step');else x.removeAttribute('aria-current');});
    document.querySelector('#water-prev').hidden=n===0;document.querySelector('#water-next').hidden=n===2;document.querySelector('#water-submit').hidden=n!==2;document.querySelector('#water-form-error').hidden=true;
    if(n===2)review();if(focus)document.querySelector('#water-step-'+n).focus();S.retry.capture(f);
  }
  U.form(f,fd=>{
    if(step!==2){if(validate(step))show(step+1);return;}
    if(!validate(2))return;
    const d=Object.fromEntries(fd),symptoms=status()==='issue'?fd.getAll('symptoms'):[];
    const summary=({checked:'ตรวจปลาแล้ว ยังไม่พบอาการผิดปกติที่สังเกต',issue:'ตรวจปลาแล้ว พบอาการผิดปกติ',notchecked:'แจ้งว่ายังไม่ได้ตรวจปลาในครั้งนี้'})[status()];
    const values=Object.fromEntries(Object.keys(S.config.units).map(k=>[k,hasWater()?d[k]:'']));
    return U.submit({type:'RECORD_WATER',cageId:c.id,values,symptoms,source:'กรอกเอง',sourceName:d.sourceName.trim(),channel:d.channel,point:hasWater()?d.point:'ไม่ได้วัดน้ำในครั้งนี้',instrument:hasWater()?d.instrument:'ไม่ได้วัดน้ำในครั้งนี้',note:summary+(d.note.trim()?' · '+d.note.trim():''),measuredAt:measuredTime(),symptomAt:symptoms.length?measuredTime():null},state=>'record-water.html?cage='+encodeURIComponent(c.id)+'&saved='+encodeURIComponent(state.lastResultId));
  });
  f.addEventListener('change',sync);
  document.querySelector('#water-next').onclick=()=>{if(validate(step))show(step+1);};
  document.querySelector('#water-prev').onclick=()=>show(Math.max(0,step-1));
  document.querySelector('#save-water-draft').onclick=()=>{S.retry.capture(f);document.querySelector('#draft-status').textContent='เก็บสิ่งที่กรอกในแท็บนี้แล้ว กลับมาหน้านี้ในแท็บเดิมเพื่อกรอกต่อ ยังไม่ได้ส่งให้กลุ่ม';};
  const restored=Math.max(0,Math.min(2,Number(f.elements.wizardStep.value)||0));show(restored===2&&!status()?0:restored,false);
};
