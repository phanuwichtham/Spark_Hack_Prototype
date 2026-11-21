/* Private farm records and explicit, versioned sharing with a lot's buyers.
 * Migration 003 enforces the same rules before projecting live buyer responses.
 */
(function(S){
  'use strict';
  const keys=['husbandryRecords','standardRecords','traceShares'];
  const ensure=s=>{keys.forEach(k=>s[k]??=[]);return s;};
  const need=(ok,message)=>{if(!ok)throw Error(message);};
  const text=(v,label,required=false)=>{need((v==null||typeof v==='string')&&String(v??'').length<=1000,'ตรวจข้อมูล '+label);const t=String(v??'').trim();need(!required||t,label);return t;};
  const day=(v,label,optional=false)=>{if(optional&&!v)return '';need(typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v,label);return v;};
  const today=s=>new Date(new Date(s.demoNow).getTime()+7*3600000).toISOString().slice(0,10);
  function safeUrl(value){
    if(!value)return '';
    try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&u.hostname.includes('.')&&!/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(u.hostname)&&!u.hostname.endsWith('.local')?u.href:'';}catch(_){return '';}
  }
  const pick=(row,fields)=>Object.fromEntries(fields.map(k=>[k,row[k]??null]));
  const historyFields=['id','kind','fromDate','toDate','description','productName','batchRef','quantityKg','treatmentStatus','withdrawalUntil','withdrawalNote','documentUrl','sourceName','channel','recorderName','recordedAt'];
  const evidenceFields=['id','standardName','certificateNo','issuer','issuedOn','expiresOn','scope','documentUrl','reviewStatus','reviewerName','reviewedAt','reviewNote','sourceName','recorderName','recordedAt'];
  function publicTrace(s,lotId){
    const share=(s.traceShares||[]).filter(r=>r.lotId===lotId).slice(-1)[0];
    if(!share||share.status!=='shared')return null;
    const history=(s.husbandryRecords||[]).filter(r=>share.historyIds.includes(r.id)&&!r.voidedAt).map(r=>pick(r,historyFields));
    const standards=(s.standardRecords||[]).filter(r=>share.evidenceIds.includes(r.id)&&!r.voidedAt).map(r=>({...pick(r,evidenceFields),documentUrl:r.reviewStatus==='rejected'?'':safeUrl(r.documentUrl)}));
    history.forEach(r=>r.documentUrl=safeUrl(r.documentUrl));
    return {...pick(share,['id','lotId','producerLabel','area','methodSummary','sharedAt','recorderName']),history,standards,withdrawnCount:share.historyIds.length+share.evidenceIds.length-history.length-standards.length};
  }
  const base=S.domain.reduce;
  function reduce(original,a){
    if(!['RECORD_HUSBANDRY','ADD_STANDARD','REVIEW_STANDARD','VOID_TRACE_RECORD','SHARE_LOT_TRACE','REVOKE_LOT_TRACE'].includes(a.type))return base(original,a);
    const s=ensure(S.util.clone(original)),actor=S.util.user(s),now=s.demoNow;
    if(a.actionId&&s.processedActions.includes(a.actionId))return s;
    need(actor.role==='farmer'||actor.role==='coordinator','ผู้ซื้อแก้ไขประวัติฟาร์มไม่ได้');
    const cage=id=>{const c=s.cages.find(r=>r.id===id);need(c&&(actor.role==='coordinator'||c.ownerId===actor.id),'ไม่มีสิทธิ์ในกระชังนี้');return c;};
    const provenance=()=>({sourceName:text(a.sourceName||actor.name,'ระบุผู้ให้ข้อมูล',true),channel:text(a.channel||'self','ระบุช่องทาง',true),recorderId:actor.id,recorderName:actor.name,recordedAt:now});
    let key,row,entityId;
    if(a.type==='RECORD_HUSBANDRY'){
      cage(a.cageId);need(['method','feed','treatment'].includes(a.kind),'เลือกประเภทประวัติ');
      const fromDate=day(a.fromDate,'ระบุวันที่เริ่ม'),toDate=day(a.toDate,'ระบุวันที่สิ้นสุด');
      need(fromDate<=toDate&&toDate<=today(s),'ช่วงบันทึกต้องเรียงถูกต้องและไม่อยู่ในอนาคต');
      row={id:S.util.id('FARM'),cageId:a.cageId,kind:a.kind,fromDate,toDate,description:text(a.description,'ระบุรายละเอียดวิธีเลี้ยง / อาหาร / การดูแล',true),...provenance()};
      row.productName=text(a.productName,'ชื่ออาหารหรือยา',a.kind==='feed'||(a.kind==='treatment'&&a.treatmentStatus==='used'));
      row.batchRef=text(a.batchRef,'รุ่นผลิต');row.quantityKg=null;
      if(a.kind==='feed'&&a.quantityKg!==''&&a.quantityKg!=null){need(Number.isFinite(Number(a.quantityKg))&&Number(a.quantityKg)>0&&Number(a.quantityKg)<=1000000,'ปริมาณอาหารต้องมากกว่า 0');row.quantityKg=Number(a.quantityKg);}
      row.treatmentStatus=a.kind==='treatment'?a.treatmentStatus:null;
      if(a.kind==='treatment')need(['used','reported-none','unknown'].includes(a.treatmentStatus),'ระบุสถานะการใช้ยา');
      row.withdrawalUntil=a.kind==='treatment'&&a.treatmentStatus==='used'?day(a.withdrawalUntil,'วันที่สิ้นสุดหยุดยาตามเอกสารไม่ถูกต้อง',true):'';
      row.withdrawalNote=text(a.withdrawalNote,'ระบุแหล่งอ้างอิงการหยุดยา เช่น ฉลาก / สัตวแพทย์',a.kind==='treatment'&&a.treatmentStatus==='used');
      if(row.withdrawalUntil)need(row.withdrawalUntil>=toDate,'วันหยุดยาต้องไม่ก่อนวันสิ้นสุดการใช้');
      row.documentUrl=a.documentUrl?text(safeUrl(a.documentUrl),'ใช้ลิงก์หลักฐาน HTTPS ที่เปิดตรวจได้',true):'';key='husbandryRecords';
    }else if(a.type==='ADD_STANDARD'){
      cage(a.cageId);if(a.lotId){const l=s.lots.find(r=>r.id===a.lotId);need(l&&l.cageId===a.cageId,'หลักฐานต้องตรงกระชังและล็อต');}
      const issuedOn=day(a.issuedOn,'ระบุวันออกเอกสาร'),expiresOn=day(a.expiresOn,'วันหมดอายุไม่ถูกต้อง',true);
      need(issuedOn<=today(s)&&(!expiresOn||expiresOn>=issuedOn),'ตรวจวันออกเอกสารและวันหมดอายุ');
      row={id:S.util.id('CERT'),cageId:a.cageId,lotId:a.lotId||'',standardName:text(a.standardName,'ระบุชื่อมาตรฐาน',true),certificateNo:text(a.certificateNo,'ระบุเลขที่เอกสาร',true),issuer:text(a.issuer,'ระบุหน่วยงานผู้ออก',true),issuedOn,expiresOn,scope:text(a.scope,'ระบุขอบเขตที่เอกสารรับรอง',true),documentUrl:text(safeUrl(a.documentUrl),'ใช้ลิงก์หลักฐาน HTTPS ที่เปิดตรวจได้',true),reviewStatus:'recorded',...provenance()};key='standardRecords';
    }else if(a.type==='REVIEW_STANDARD'){
      need(actor.role==='coordinator','ให้ผู้ประสานตรวจเอกสาร');row=s.standardRecords.find(r=>r.id===a.id&&!r.voidedAt);need(row,'ไม่พบหลักฐานที่ยังใช้งาน');
      need(['checked','rejected'].includes(a.reviewStatus),'เลือกผลตรวจเอกสาร');Object.assign(row,{reviewStatus:a.reviewStatus,reviewNote:text(a.reviewNote,'ระบุผลตรวจเอกสารที่ร้านจะอ่านได้',true),reviewerName:actor.name,reviewedAt:now,reviewerId:actor.id});key='standardRecords';
    }else if(a.type==='VOID_TRACE_RECORD'){
      need(['husbandryRecords','standardRecords'].includes(a.collection),'ประเภทบันทึกไม่ถูกต้อง');key=a.collection;row=s[key].find(r=>r.id===a.id&&!r.voidedAt);need(row,'บันทึกถูกยกเลิกแล้วหรือไม่พบ');cage(row.cageId);Object.assign(row,{voidedAt:now,voidedBy:actor.id,voidReason:text(a.reason,'ระบุเหตุผลยกเลิกเพื่อแก้ไข',true)});
    }else{
      const lot=s.lots.find(r=>r.id===a.lotId);need(lot,'ไม่พบล็อต');const c=cage(lot.cageId);entityId=lot.id;key='traceShares';
      if(a.type==='REVOKE_LOT_TRACE'){
        row=s.traceShares.filter(r=>r.lotId===lot.id).slice(-1)[0];need(row?.status==='shared','ล็อตนี้ยังไม่ได้แชร์');Object.assign(row,{status:'revoked',revokedAt:now,revokedBy:actor.id,reason:text(a.reason,'ระบุเหตุผลหยุดแชร์',true)});
      }else{
        need(a.ownerConsent===true,'ยืนยันว่าเจ้าของอนุญาตให้แชร์ข้อมูลที่เลือก');
        const ids=k=>{need(Array.isArray(a[k])&&a[k].length<=100&&a[k].every(v=>typeof v==='string'),'ตรวจรายการหลักฐาน');need(new Set(a[k]).size===a[k].length,'ไม่เลือกบันทึกซ้ำ');return a[k];};
        const historyIds=ids('historyIds'),evidenceIds=ids('evidenceIds');need(historyIds.length>0,'เลือกประวัติการเลี้ยงอย่างน้อยหนึ่งรายการ');
        const harvest=s.harvests.find(r=>r.id===lot.harvestId);const harvestDay=new Date(new Date(harvest?.at||lot.at).getTime()+7*3600000).toISOString().slice(0,10);
        historyIds.forEach(id=>need(s.husbandryRecords.some(r=>r.id===id&&r.cageId===c.id&&!r.voidedAt&&r.toDate<=harvestDay),'ประวัติต้องตรงกระชัง ไม่ถูกยกเลิก และไม่หลังวันจับ'));
        evidenceIds.forEach(id=>need(s.standardRecords.some(r=>r.id===id&&r.cageId===c.id&&(!r.lotId||r.lotId===lot.id)&&!r.voidedAt&&r.reviewStatus!=='rejected'),'เอกสารต้องตรงกระชัง / ล็อต และไม่ถูกยกเลิกหรือปฏิเสธ'));
        row={id:S.util.id('TRACE'),lotId:lot.id,cageId:c.id,producerLabel:text(a.producerLabel,'ระบุชื่อแหล่งผลิตที่อนุญาตเปิดเผย',true),area:text(a.area,'ระบุพื้นที่เลี้ยง',true),methodSummary:text(a.methodSummary,'สรุปวิธีเลี้ยงสำหรับร้าน',true),historyIds,evidenceIds,consentByOwnerId:c.ownerId,consentEvidence:text(a.consentEvidence,'ระบุคำอนุญาตจากเจ้าของ',actor.role==='coordinator'),consentChannel:text(a.consentChannel||'self','ระบุช่องทางรับคำอนุญาต',true),recorderId:actor.id,recorderName:actor.name,sharedAt:now,status:'shared'};
      }
    }
    if(!s[key].some(r=>r.id===row.id))s[key].push(row);
    s.lastResultId=row.id;s.audit.push({id:S.util.id('AUD'),type:a.type,entityId:entityId||row.cageId,actorId:actor.id,at:now,message:a.type+' '+row.id+(row.voidReason?': '+row.voidReason:'')});
    if(a.actionId)s.processedActions.push(a.actionId);return s;
  }
  S.trace={ensure,safeUrl,today,publicTrace,keys};S.domain.reduce=reduce;
  S.domain.dispatch=a=>S.store.commit(reduce(S.store.get(),{actionId:S.util.id('ACT'),...a}));
})(SPARK);
