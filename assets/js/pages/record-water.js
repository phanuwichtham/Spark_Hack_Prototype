SPARK.page=function(){
  const S=SPARK,U=S.ui,s=U.state(),u=U.user(),c=U.allowedCages(s).find(c=>c.id===S.util.query('cage'));
  if(!c){U.missing('กระชังที่บัญชีนี้บันทึกได้');return;}
  document.querySelector('#water-cage-title').textContent='กระชัง '+c.id+' • '+c.name;
  const f=document.querySelector('#water-form'),draft=s.drafts[u.id+':water:'+c.id];
  // ไม่เติมค่าน้ำปกติให้ฟอร์ม ค่าว่างหมายถึงไม่มีข้อมูล
  for(const k of ['do','temperature','salinity','ph','point','note'])f.elements[k].value=draft?.[k]??'';
  f.elements.measuredAt.value=draft?.measuredAt||S.util.localTime(s.demoNow);f.elements.symptomAt.value=draft?.symptomAt||S.util.localTime(s.demoNow);
  if(S.cloud.enabled){
    f.elements.source.closest('.field').hidden=true;
    f.elements.instrument.options[1].textContent='ตรวจเครื่องแล้ว';
  }
  f.elements.source.value=draft?.source||'กรอกเอง';f.elements.instrument.value=draft?.instrument||'ยังไม่ยืนยัน';
  f.querySelectorAll('[name=symptoms]').forEach(x=>x.checked=(draft?.symptoms||[]).includes(x.value));
  const latest=S.calc.latest(s,c.id);
  U.html('#last-saved-water',latest?'<p class="small muted">'+U.e(S.util.date(latest.measuredAt))+' • '+U.e(latest.source)+'</p><dl class="key-value">'+Object.keys(S.config.units).map(k=>'<dt>'+U.e(k)+' '+S.config.units[k]+'</dt><dd>'+U.e(latest.values[k]??'ไม่มีข้อมูล')+'</dd>').join('')+'</dl><p class="small">อาการ: '+U.e(latest.symptoms.join(', ')||'ยังไม่พบอาการที่ระบุ')+'</p>'+(latest.note?'<p>สิ่งที่บันทึก: '+U.e(latest.note)+'</p>':'')+'<div class="actions">'+U.link('risk.html?cage='+c.id,'ดูผลจากชุดล่าสุด','btn small secondary')+'</div>':U.empty('ยังไม่มีข้อมูล'));
  document.querySelector('#save-water-draft').onclick=()=>{
    S.retry.capture(f);
    document.querySelector('#draft-status').textContent='เก็บร่างในแท็บนี้แล้ว';
  };
  U.form(f,fd=>{
    const d=Object.fromEntries(fd);
    const values=Object.fromEntries(Object.keys(S.config.units).map(k=>[k,d[k]]));
    const symptoms=fd.getAll('symptoms');
    if(!Object.values(values).some(v=>v!=='')&&!symptoms.length&&!d.note.trim())
      throw Error('กรอกค่าที่วัดได้ เลือกอาการ หรือจดสิ่งที่สังเกตอย่างน้อยหนึ่งอย่าง');
    return U.submit({type:'RECORD_WATER',cageId:c.id,values,symptoms,source:d.source,sourceName:d.sourceName,channel:d.channel,point:d.point,instrument:d.instrument,note:d.note,
      measuredAt:S.util.fromThaiTime(d.measuredAt),symptomAt:symptoms.length?S.util.fromThaiTime(d.symptomAt):null},'risk.html?cage='+c.id);
  });
};
