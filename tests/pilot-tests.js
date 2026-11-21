const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const ctx={console,Date,Intl,Math,JSON,URL,URLSearchParams,crypto:require('node:crypto').webcrypto,location:{pathname:'/',search:''},localStorage:{getItem:()=>null,setItem:()=>{}},addEventListener:()=>{}};
ctx.window=ctx;vm.createContext(ctx);
for(const file of ['config','utils','demo-data','calculations','risk-engine','ml-engine','store','domain','pilot-domain','trace-domain'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/js',file+'.js'),'utf8'),ctx);
const S=ctx.SPARK,clock='2026-11-21T06:00:00.000Z',seed=()=>{const s=S.seed('normal',clock);s.currentUserId='CO01';return s;};
let passed=0;const test=(name,fn)=>{fn();passed++;console.log('PASS '+name);};
const report={type:'RECORD_MORTALITY',cageId:'C01',periodStart:'2026-11-20T06:00:00.000Z',periodEnd:clock,population:250,deaths:0,inspection:'checked',causeStatus:'unknown',sourceName:'เจ้าของให้ข้อมูล',channel:'phone'};
test('Observed zero is distinct from an unobserved interval; no double counting',()=>{
  let s=S.domain.reduce(seed(),{...report,actionId:'same'});assert.equal(s.mortalities[0].deaths,0);assert.equal(s.mortalities[0].recorderId,'CO01');
  assert.equal(S.domain.reduce(s,{...report,actionId:'same'}).mortalities.length,1);
  assert.throws(()=>S.domain.reduce(s,report),/ช่วงตรวจซ้ำ/);
  s=S.domain.reduce(s,{...report,cageId:'C03',inspection:'unknown',deaths:''});assert.equal(s.mortalities[1].deaths,null);
});
test('Mortality input rejects invented confirmed causes, fractional counts and unauthorized farms',()=>{
  assert.throws(()=>S.domain.reduce(seed(),{...report,causeStatus:'confirmed',cause:'น้ำเปลี่ยน'}),/หลักฐาน/);
  assert.throws(()=>S.domain.reduce(seed(),{...report,deaths:1.3}),/จำนวนตาย/);
  const s=seed();s.currentUserId='F02';assert.throws(()=>S.domain.reduce(s,report),/ไม่มีสิทธิ์/);
});
test('A death observation enters care without inventing water readings or reducing stock',()=>{
  const s=S.domain.reduce(seed(),{...report,deaths:3}),o=s.observations.at(-1);assert.equal(o.values.do,null);assert.equal(o.symptoms[0],'พบปลาตาย');assert.equal(s.cages[0].liveKg,200);
  assert.equal(S.evaluateCageRisk(o,s.observations,S.config,clock).urgency,'urgent');
});
test('Corrections retain the original record, retract its symptom, and invalidate real candidate models',()=>{
  let s=S.domain.reduce(seed(),{...report,deaths:3});const id=s.lastResultId;s.models.push({id:'OLD',synthetic:false});
  s=S.domain.reduce(s,{type:'VOID_MORTALITY',id,reason:'นับซ้ำกับช่วงก่อน'});assert.equal(s.mortalities.length,1);assert.equal(s.mortalities[0].voidReason,'นับซ้ำกับช่วงก่อน');assert(s.models[0].invalidatedAt);
  assert(!S.calc.latest(s,'C01').mortalityId);assert.equal(S.ml.predict(s,s.cages[0],s.models[0]).available,false);
  const corrected=S.domain.reduce(s,{...report,deaths:0});assert.equal(corrected.mortalities.length,2);
});
test('No real training history produces no model and no invented prediction',()=>{
  assert.throws(()=>S.ml.train(seed(),false),/ข้อมูลใช้ฝึกไม่พอ/);assert.equal(S.ml.predict(seed(),seed().cages[0],null).available,false);
});
let synthetic,model;
test('Synthetic history is segregated from care readings and creates an actual trained model',()=>{
  const before=seed();synthetic=S.domain.reduce(before,{type:'LOAD_SYNTHETIC'});assert.equal(JSON.stringify(before.observations),JSON.stringify(synthetic.observations));
  model=S.ml.train(synthetic,true);assert.equal(model.weights.length,10);assert(model.weights.some(w=>Math.abs(w)>.01));assert(model.metrics.brier<model.metrics.baselineBrier);assert.equal(model.operationallyValidated,false);
});
test('Temporal split keeps future outcomes out of training; later backfills are excluded',()=>{
  const rows=S.ml.dataset(synthetic,true),cutoff=new Date(model.cutoff).getTime();
  assert(rows.filter(r=>new Date(r.at)>=cutoff).length>=10);assert(new Date(model.trainLastEnd).getTime()<cutoff);
  const changed=JSON.parse(JSON.stringify(synthetic)),first=changed.mlObservations[0];first.receivedAt=clock;
  const data=S.ml.dataset(changed,true);assert(data.length<rows.length);
});
test('Predictions respond to current measured features rather than fixed percentages',()=>{
  const low=S.ml.predict(synthetic,synthetic.cages.find(c=>c.id==='C01'),model),high=S.ml.predict(synthetic,synthetic.cages.find(c=>c.id==='C03'),model);
  assert(low.available&&high.available);assert(high.score>low.score);assert.equal(new Date(high.until)-new Date(high.issuedAt),86400000);
  const stale=JSON.parse(JSON.stringify(synthetic));stale.demoNow='2026-11-22T06:00:00.000Z';assert.equal(S.ml.predict(stale,stale.cages[0],model).available,false);
});
test('Synthetic training and model saves cannot enter live mode',()=>{
  S.cloud={enabled:true};assert.throws(()=>S.domain.reduce(seed(),{type:'LOAD_SYNTHETIC'}),/เฉพาะเดโม/);assert.throws(()=>S.domain.reduce(seed(),{type:'SAVE_MODEL',model}),/สังเคราะห์/);S.cloud={enabled:false};
});
test('GI records require a qualifying species, linked lot, minimum size and evidence',()=>{
  const s=seed();s.lots=[{id:'L',cageId:'C01'},{id:'S',cageId:'C04'}];const data={type:'SAVE_GI',cageId:'C01',lotId:'L',minFishKg:2,producerRef:'ref',evidence:'document'};
  assert.throws(()=>S.domain.reduce(s,data),/ปลากะพง/);assert.throws(()=>S.domain.reduce(s,{...data,cageId:'C04',lotId:'S',minFishKg:1}),/2 กก/);
  const out=S.domain.reduce(s,{...data,cageId:'C04',lotId:'S'});assert.equal(out.giRecords[0].status,'documents-recorded');
});
test('A Thai SELECT statement without current evidence is rejected',()=>{
  assert.throws(()=>S.domain.reduce(seed(),{type:'SAVE_PARTNER',name:'ร้าน',stage:'target',certStatus:'verified',minKg:1,maxKg:2,quantity:10}),/หลักฐาน/);
});
test('Assisted confirmation retains owner, actor, channel and proof without switching identities',()=>{
  let s=seed();s.currentUserId='R01';s=S.domain.reduce(s,{type:'CREATE_ORDER',productId:'P01',kg:10,receiveDate:'2026-11-22',place:'ท่าเรือ',window:'เช้า'});const orderId=s.lastResultId;s.currentUserId='CO01';
  s=S.domain.reduce(s,{type:'ALLOCATE',orderId,cageId:'C01',kg:10,reason:'ตรงสเปกและเจ้าของยืนยันภายหลัง'});
  assert.throws(()=>S.domain.reduce(s,{type:'ASSIST_CONFIRM',orderId,ownerId:'F01',channel:'phone'}),/คำยืนยัน/);
  s=S.domain.reduce(s,{type:'ASSIST_CONFIRM',orderId,ownerId:'F01',channel:'phone',confirmationEvidence:'เจ้าของยืนยัน 10 กก. 340 บาท/กก. และค่าใช้จ่ายที่ตกลง'});
  assert.equal(s.currentUserId,'CO01');assert.equal(s.orders[0].farmerConfirmed,true);assert.equal(s.orders[0].buyerConfirmed,false);assert.equal(s.orders[0].assistedConfirmations[0].recorderId,'CO01');
});
test('Boat trip revenue excludes seed retained for grow-out and counts each expense once',()=>{
  let s=S.domain.reduce(seed(),{type:'RECORD_TRIP',ownerId:'F01',at:clock,hours:2,seedCount:7,catchNote:'ได้ลูกปลาและปู',fuel:100,bait:50,ice:20,handling:30,transport:0,labor:100,sales:400});
  const r=s.boatTrips[0];assert.equal(r.sales,40000);assert.equal(r.fuel+r.bait+r.ice+r.handling+r.transport+r.labor,30000);assert.equal(s.financialEntries.length,0);
});
console.log(JSON.stringify({passed,failed:0}));
