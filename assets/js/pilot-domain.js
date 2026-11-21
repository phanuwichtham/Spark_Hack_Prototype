/* Additive pilot records; business transactions remain in domain.js / SQL.
 * Live mode sends these same commands to migration 002, never localStorage.
 */
(function(S){
  'use strict';
  const collections=['mortalities','boatTrips','partners','giRecords','contacts','models','buyerSpecs'];
  const ensure=s=>{for(const k of collections)s[k]??=[];return s;};
  const need=(ok,text)=>{if(!ok)throw Error(text);};
  const required=(v,label)=>{need(typeof v==='string'&&v.trim().length>0&&v.length<=1000,label);return v.trim();};
  const number=(v,label,min=0)=>{need(v!==''&&v!==null&&v!==undefined&&Number.isFinite(Number(v))&&Number(v)>=min,label);return Number(v);};
  const date=(v,label)=>{need(v&&Number.isFinite(new Date(v).getTime()),label);return new Date(v).toISOString();};
  const base=S.domain.reduce;
  function reduce(original,a){
    const s=ensure(S.util.clone(original)),actor=S.util.user(s),now=s.demoNow;
    if(a.actionId&&s.processedActions.includes(a.actionId))return s;
    const coordinator=()=>need(actor.role==='coordinator','ใช้บัญชีผู้ประสานงานโครงการ');
    const cage=id=>{const c=s.cages.find(c=>c.id===id);need(c,'ไม่พบกระชัง');need(actor.role==='coordinator'||actor.id===c.ownerId,'ไม่มีสิทธิ์ในกระชังนี้');return c;};
    const put=(key,row)=>{s[key].push(row);s.lastResultId=row.id;s.audit.push({id:S.util.id('AUD'),type:key,entityId:row.cageId||row.incidentId||row.orderId||row.id,actorId:actor.id,at:now,message:'บันทึก '+key+' '+row.id});};
    const provenance=()=>({sourceName:required(a.sourceName||actor.name,'ระบุผู้ให้ข้อมูล'),channel:required(a.channel||'self','ระบุช่องทาง'),recorderId:actor.id,recordedAt:now,synthetic:false});
    switch(a.type){
      case 'VOID_MORTALITY':{
        const row=s.mortalities.find(r=>r.id===a.id);need(row&&!row.synthetic&&!row.voidedAt,'เลือกบันทึกที่ยังไม่ยกเลิก');cage(row.cageId);
        row.voidReason=required(a.reason,'ระบุเหตุผลแก้ไขบันทึก');row.voidedAt=now;row.voidedBy=actor.id;
        s.observations.filter(o=>o.mortalityId===row.id).forEach(o=>o.retracted=true);
        s.models.filter(m=>!m.synthetic).forEach(m=>m.invalidatedAt=now);
        s.audit.push({id:S.util.id('AUD'),type:'mortalities',entityId:row.cageId,actorId:actor.id,at:now,message:'ยกเลิกบันทึก '+row.id+': '+row.voidReason});break;
      }
      case 'RECORD_MORTALITY':{
        cage(a.cageId);const start=date(a.periodStart,'ระบุเวลาเริ่มช่วงตรวจ'),end=date(a.periodEnd,'ระบุเวลาสิ้นสุดช่วงตรวจ');
        need(new Date(end)>new Date(start)&&new Date(end)<=new Date(now),'ช่วงตรวจต้องสิ้นสุดแล้วและเวลาเรียงถูกต้อง');
        need(new Date(end)-new Date(start)<=7*86400000,'หนึ่งบันทึกครอบคลุมได้ไม่เกิน 7 วัน');
        const population=number(a.population,'ระบุจำนวนปลาเริ่มช่วง',1);need(Number.isInteger(population),'จำนวนปลาต้องเป็นจำนวนเต็ม');
        need(['checked','unknown'].includes(a.inspection),'เลือกสถานะการตรวจ');
        const deaths=a.inspection==='checked'?number(a.deaths,'ระบุจำนวนตายที่พบ'):null;
        need(deaths===null||(Number.isInteger(deaths)&&deaths<=population),'จำนวนตายต้องไม่เกินจำนวนปลาเริ่มช่วง');
        need(!s.mortalities.some(r=>!r.synthetic&&!r.voidedAt&&r.cageId===a.cageId&&new Date(r.periodStart)<new Date(end)&&new Date(r.periodEnd)>new Date(start)),'ช่วงตรวจซ้ำกับบันทึกเดิม ส่งออก/ทักท้วงข้อมูลเดิมก่อน ไม่บวกยอดซ้ำ');
        need(['unknown','suspected','confirmed'].includes(a.causeStatus),'เลือกสถานะสาเหตุ');
        if(a.causeStatus!=='unknown')required(a.cause,'ระบุสาเหตุที่สงสัย/ยืนยัน');
        if(a.causeStatus==='confirmed')required(a.causeEvidence,'ระบุผู้ตรวจและหลักฐานยืนยันสาเหตุ');
        put('mortalities',{id:S.util.id('MORT'),cageId:a.cageId,periodStart:start,periodEnd:end,population,deaths,inspection:a.inspection,causeStatus:a.causeStatus,cause:a.cause||'',causeEvidence:a.causeEvidence||'',response:a.response||'',...provenance()});
        if(deaths>0)s.observations.push({id:S.util.id('OBS'),cageId:a.cageId,values:{do:null,salinity:null,temperature:null,ph:null},measuredAt:end,receivedAt:now,symptoms:['พบปลาตาย'],symptomAt:end,source:'กรอกเอง',point:'บันทึกการตรวจปลา',instrument:'ไม่ได้วัดน้ำในรายการนี้',recorder:actor.name,note:'พบตาย '+deaths+' ตัวในช่วงตรวจ',mortalityId:s.lastResultId,...provenance()});
        break;
      }
      case 'RECORD_TRIP':{
        need(actor.role!=='buyer','ผู้ซื้อบันทึกเที่ยวเรือไม่ได้');const ownerId=actor.role==='farmer'?actor.id:a.ownerId;
        need(s.users.some(u=>u.id===ownerId&&u.role==='farmer'),'เลือกเจ้าของเที่ยวเรือ');
        const at=date(a.at,'เลือกเวลาออกเรือ');need(new Date(at)<=new Date(now),'ยังบันทึกผลเที่ยวเรือในอนาคตไม่ได้');
        const row={id:S.util.id('TRIP'),ownerId,at,catchNote:required(a.catchNote,'ระบุผลจับ แม้ไม่ได้ปลา'),seedCount:number(a.seedCount,'จำนวนลูกปลาที่เก็บเลี้ยง'),hours:number(a.hours,'เวลาออกเรือ'),...provenance()};
        need(Number.isInteger(row.seedCount),'จำนวนลูกปลาต้องเป็นจำนวนเต็ม');
        for(const k of ['fuel','bait','ice','handling','transport','labor','sales'])row[k]=Math.round(number(a[k],k)*100);
        put('boatTrips',row);break;
      }
      case 'SAVE_PARTNER':{
        coordinator();need(['target','contacted','sample','ordered','repeat'].includes(a.stage),'เลือกขั้นการพัฒนาคู่ค้า');
        need(['unverified','verified','preparing'].includes(a.certStatus),'เลือกสถานะ Thai SELECT');
        if(a.certStatus==='verified'){required(a.certEvidence,'ระบุแหล่งหลักฐาน Thai SELECT');need(a.certUntil&&a.certUntil>=S.util.localTime(now).slice(0,10),'ระบุวันสิ้นอายุที่ยังใช้ได้');}
        const minKg=number(a.minKg,'ขนาดต่ำสุด'),maxKg=number(a.maxKg,'ขนาดสูงสุด');need(maxKg>=minKg,'ช่วงขนาดปลาไม่ถูกต้อง');
        put('partners',{id:S.util.id('PARTNER'),name:required(a.name,'ชื่อร้าน'),contact:a.contact||'',stage:a.stage,certStatus:a.certStatus,certEvidence:a.certEvidence||'',certUntil:a.certUntil||'',species:a.species,minKg,maxKg,quantity:number(a.quantity,'ปริมาณที่สนใจ'),note:a.note||'',...provenance()});break;
      }
      case 'SAVE_GI':{
        coordinator();const c=cage(a.cageId),lot=s.lots.find(l=>l.id===a.lotId&&l.cageId===c.id);need(lot,'เลือกล็อตที่เชื่อมกับกระชัง');
        need(c.species==='seabass','GI รายการนี้ใช้กับปลากะพงขาวตามข้อกำหนด');
        const minFishKg=number(a.minFishKg,'น้ำหนักปลาต่อตัวขั้นต่ำ');need(minFishKg>=2,'GI รายการนี้กำหนดปลาไม่น้อยกว่า 2 กก./ตัว');
        put('giRecords',{id:S.util.id('GI'),cageId:c.id,lotId:lot.id,minFishKg,producerRef:required(a.producerRef,'ระบุทะเบียน/หลักฐานผู้ผลิต'),evidence:required(a.evidence,'ระบุหลักฐาน GI และการตรวจล็อต'),reviewer:actor.name,status:'documents-recorded',...provenance()});break;
      }
      case 'RECORD_CONTACT':{
        const incident=s.incidents.find(i=>i.id===a.incidentId);need(incident,'เลือกเหตุ');cage(incident.cageId);
        need(['unreached','reached','responding','followup'].includes(a.outcome),'เลือกผลการติดต่อ');
        if(a.backupId)need(s.users.some(u=>u.id===a.backupId&&u.role==='coordinator'),'คนสำรองต้องเป็นผู้ประสาน');
        put('contacts',{id:S.util.id('CALL'),incidentId:incident.id,cageId:incident.cageId,backupId:a.backupId||null,phone:a.phone||'',outcome:a.outcome,nextAt:a.nextAt?date(a.nextAt,'เวลาติดตาม'):null,note:required(a.note,'บันทึกผลการติดต่อ'),...provenance()});break;
      }
      case 'ASSIST_CONFIRM':{
        coordinator();const o=s.orders.find(o=>o.id===a.orderId);need(o&&['allocated','waiting'].includes(o.status),'ออเดอร์ยังไม่อยู่ในขั้นยืนยัน');
        const owners=[...new Set((o.cageIds||[o.cageId]).map(id=>s.cages.find(c=>c.id===id)?.ownerId))];need(owners.includes(a.ownerId),'เจ้าของไม่เกี่ยวข้องกับออเดอร์');
        const proof=required(a.confirmationEvidence,'บันทึกคำยืนยันเรื่องปริมาณ ราคา และค่าใช้จ่ายที่ได้รับ');required(a.channel,'ระบุช่องทางยืนยัน');
        o.farmerConfirmations=[...new Set([...(o.farmerConfirmations||[]),a.ownerId])];o.farmerConfirmed=owners.every(id=>o.farmerConfirmations.includes(id));o.status=o.farmerConfirmed&&o.buyerConfirmed?'confirmed':'waiting';
        o.assistedConfirmations??=[];o.assistedConfirmations.push({ownerId:a.ownerId,evidence:proof,channel:a.channel,recorderId:actor.id,at:now,priceSatang:o.priceSatang,allocatedKg:o.allocatedKg});
        put('contacts',{id:S.util.id('CONF'),orderId:o.id,ownerId:a.ownerId,outcome:'owner-confirmed',note:proof,...provenance()});break;
      }
      case 'SET_BUYER_SPEC':{
        need(actor.role==='buyer','ใช้บัญชีผู้ซื้อ');const minKg=number(a.minKg,'ขนาดต่ำสุด'),maxKg=number(a.maxKg,'ขนาดสูงสุด');need(maxKg>=minKg,'ช่วงขนาดไม่ถูกต้อง');
        put('buyerSpecs',{id:S.util.id('SPEC'),buyerId:actor.id,minKg,maxKg,format:required(a.format,'รูปแบบสินค้า'),note:a.note||'',...provenance()});break;
      }
      case 'LOAD_SYNTHETIC':{
        coordinator();need(!S.cloud?.enabled,'ข้อมูลสังเคราะห์ใช้ได้เฉพาะเดโม');const data=S.ml.syntheticHistory(s);
        s.mlObservations=data.observations;s.mortalities=s.mortalities.filter(x=>!x.synthetic).concat(data.mortalities);s.models=s.models.filter(x=>!x.synthetic);s.lastResultId='SYNTHETIC';break;
      }
      case 'SAVE_MODEL':{
        coordinator();const m=a.model;need(m?.algorithm==='logistic-regression-v1'&&m.featureNames?.length===9&&m.weights?.length===10&&m.means?.length===9&&m.scales?.length===9,'รูปแบบโมเดลไม่รองรับ');
        need([...m.weights,...m.means,...m.scales].every(Number.isFinite)&&m.scales.every(v=>v>0),'ค่าของโมเดลไม่ถูกต้อง');
        need(typeof m.synthetic==='boolean'&&m.horizonHours===24&&Number.isSafeInteger(m.trainCount)&&m.trainCount>=20&&Number.isSafeInteger(m.testCount)&&m.testCount>=10&&Number.isFinite(m.metrics?.brier)&&Number.isFinite(m.metrics?.baselineBrier),'ข้อมูลประเมินโมเดลไม่ครบ');
        need(['tp','fp','fn','tn'].every(k=>Number.isSafeInteger(m.metrics[k])&&m.metrics[k]>=0),'ผลประเมินโมเดลไม่ถูกต้อง');
        need(!S.cloud?.enabled||!m.synthetic,'บันทึกโมเดลสังเคราะห์ในโหมดข้อมูลจริงไม่ได้');
        put('models',{...m,id:S.util.id('ML'),operationallyValidated:false,recorderId:actor.id});break;
      }
      default:{
        const next=base(s,a);
        if(a.type==='RECORD_WATER'){
          const obs=next.observations.find(x=>x.id===next.lastResultId);if(obs){obs.sourceName=a.sourceName||actor.name;obs.channel=a.channel||'self';obs.recorderId=actor.id;obs.synthetic=false;}
        }
        if(a.type==='CREATE_ORDER'){
          const o=next.orders.find(x=>x.id===next.lastResultId),spec=next.buyerSpecs.filter(x=>x.buyerId===actor.id).slice(-1)[0];if(o&&spec)o.buyerSpec=S.util.clone(spec);
        }
        return next;
      }
    }
    if(a.actionId)s.processedActions.push(a.actionId);return s;
  }
  S.pilot={collections,ensure,reduce};
  S.domain.reduce=reduce;S.domain.dispatch=a=>S.store.commit(reduce(S.store.get(),{actionId:S.util.id('ACT'),...a}));
})(SPARK);
