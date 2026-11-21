// Real PostgreSQL SQL via PGlite. Auth claims are supplied only by this test harness.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';

const { PGlite } = await import(process.env.SPARK_PGLITE_MODULE
  ? pathToFileURL(process.env.SPARK_PGLITE_MODULE).href : '@electric-sql/pglite');
const db = new PGlite();
const read = file => readFile(new URL(file, import.meta.url), 'utf8');
const coordinator = '00000000-0000-4000-8000-000000000001';
const farmer = '00000000-0000-4000-8000-000000000002';
const otherFarmer = '00000000-0000-4000-8000-000000000003';
const a = '00000000-0000-4000-8000-000000000004';
const b = '00000000-0000-4000-8000-000000000005';
const stranger = '00000000-0000-4000-8000-000000000006';
const date = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
const measuredAt = new Date(Date.now() - 60000).toISOString();
const workspace = 'test-group';
const sql = await read('../database/migrations/001_spark_pilot.sql');
await db.exec(`
  create role anon; create role authenticated;
  create schema auth; create table auth.users(id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
  $$;
`);
await db.exec(sql);
await db.exec(sql); // Idempotent deployment and existing records are kept.
const pilotSql = await read('../database/migrations/002_ml_gi_pilot.sql');
await db.exec(pilotSql);
await db.exec(pilotSql);
await db.exec(`
  insert into spark_pilot.groups(id,title) values ('test-group','กลุ่มหนึ่ง'),('second','กลุ่มสอง');
  insert into auth.users(id) values ('${coordinator}'),('${farmer}'),('${otherFarmer}'),('${a}'),('${b}'),('${stranger}');
  insert into spark_pilot.members(group_id,user_id,role,display_name) values
  ('test-group','${coordinator}','coordinator','ผู้ประสาน'),
  ('test-group','${farmer}','farmer','ผู้เลี้ยง A'),
  ('test-group','${otherFarmer}','farmer','ผู้เลี้ยง B'),
  ('test-group','${a}','buyer','ร้าน A'),
  ('test-group','${b}','buyer','ร้าน B'),
  ('second','${stranger}','coordinator','อีกกลุ่ม');
`);
function as(actor, statement, values = [], role = 'authenticated') {
  return db.transaction(async tx => {
    await tx.exec('set local role ' + role);
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [actor]);
    return (await tx.query(statement, values)).rows[0]?.value;
  });
}
const state = actor => as(actor, 'select public.spark_pilot_read($1) value', [workspace]);
async function apply(actor, command, revision, request = randomUUID()) {
  if (revision === undefined) revision = (await state(actor)).revision;
  return as(actor, 'select public.spark_pilot_apply($1,$2,$3,$4) value',
    [workspace, revision, request, JSON.stringify(command)]);
}
const action = (actor, type, fields) => apply(actor, { type, ...fields });
const deny = (call, code) => assert.rejects(call, error => error.code === code);
try {
  await deny(() => state(stranger), '42501');
  await deny(() => as('', 'select public.spark_pilot_read($1)', [workspace], 'anon'), '42501');
  await deny(() => as(a, 'select * from spark_pilot.groups'), '42501');
  await deny(() => action(a, 'SET_USER', { userId: coordinator }), 'P0001');
  const cageId = (await action(farmer, 'ADD_CAGE', { ownerId: otherFarmer, species:'grouper', count: 250, avgKg: 0.8 })).resultId;
  const cageB = (await action(otherFarmer, 'ADD_CAGE', { species:'grouper', count: 130, avgKg: 1 })).resultId;
  assert.deepEqual((await state(farmer)).cages.map(c => c.id), [cageId]);
  assert.equal((await state(coordinator)).cages.length, 2);
  assert.equal((await state(a)).cages.length, 0);
  const water = { type:'RECORD_WATER', cageId, measuredAt, values:{ ph:'', do:'' }, symptoms:['ลอยหัว'], note:'สังเกตเช้านี้' };
  await deny(() => apply(otherFarmer, water), '42501');
  await deny(() => apply(a, water), '42501');
  const revision = (await state(farmer)).revision, requestId = randomUUID();
  const saved = await apply(farmer, water, revision, requestId);
  const replay = await apply(farmer, water, revision, requestId);
  assert.equal(saved.resultId, replay.resultId);
  assert.equal(replay.state.revision, revision + 1);
  assert.equal(replay.state.observations.length, 1);
  assert.equal(replay.state.observations[0].values.do, null);
  await deny(() => apply(farmer, { ...water, note:'ต่างจากครั้งก่อน' }, revision, requestId), 'P0001');
  await deny(() => apply(farmer, water, revision), '40001');
  assert.equal((await state(otherFarmer)).observations.length, 0);
  const incidentId = (await action(farmer, 'CREATE_CARE', { cageId })).resultId;
  const care = await state(farmer);
  assert.equal(care.incidents.find(i => i.id === incidentId).urgency, 'urgent');
  assert(care.assessments[0].ruleIds.includes('SYM-01'));
  assert(care.assessments[0].ruleIds.includes('DATA-MISSING'));
  const taskId = care.tasks[0].id;
  await deny(() => action(otherFarmer, 'TASK_UPDATE', { taskId, status:'assigned' }), '42501');
  await action(farmer, 'TASK_UPDATE', { taskId, status:'assigned' });
  await action(farmer, 'TASK_UPDATE', { taskId, status:'working' });
  await action(farmer, 'TASK_UPDATE', { taskId, status:'followup', evidence:'ส่งต่อผู้ประสาน' });

  await deny(() => action(farmer, 'SET_LISTING', { cageId, offerKg: 50, price: 340 }), '42501');
  await action(coordinator, 'SET_LISTING', { cageId, offerKg: 50, price: 340 });
  assert.equal((await state(a)).products.find(p => p.id === 'P01').availableKg, 50);
  const requestOrder = (buyer, kg) => action(buyer, 'CREATE_ORDER', { productId:'P01', kg, receiveDate:date,
    place:'ท่าเรือทดสอบ', window:'09:00–12:00' });
  const orderA = (await requestOrder(a, 20)).resultId;
  const orderB = (await requestOrder(b, 30)).resultId;
  assert.deepEqual((await state(a)).orders.map(o => o.id), [orderA]);
  assert.equal((await state(farmer)).orders.length, 0);
  assert.equal((await state(coordinator)).orders.length, 2);
  await deny(() => action(a, 'ALLOCATE', { orderId: orderA, cageId, kg:20, reason:'ทดสอบ' }), '42501');
  for (const [buyer, orderId, kg] of [[a,orderA,20],[b,orderB,30]]) {
    await action(coordinator, 'ALLOCATE', { orderId, cageId, kg, reason:'ตามน้ำหนักสั่งซื้อ' });
    await deny(() => action(otherFarmer, 'CONFIRM_ORDER', { orderId }), '42501');
    await deny(() => action(buyer===a?b:a, 'CONFIRM_ORDER', { orderId }), '42501');
    await action(farmer, 'CONFIRM_ORDER', { orderId });
    await action(buyer, 'CONFIRM_ORDER', { orderId });
  }
  const planId = (await action(farmer, 'CREATE_PLAN', { cageId, kg:50, coldKg:0, date, reason:'จับตามคำขอสองร้าน' })).resultId;
  await deny(() => action(otherFarmer, 'HARVEST', { planId, actualKg:50 }), '42501');
  await deny(() => action(coordinator, 'APPROVE_PLAN', { planId }), 'P0001');
  await action(coordinator, 'CHECK_PLAN', { planId, quality:'passed', inspector:'ผู้ตรวจทดสอบ', coldKg:0, transportKg:50, vehicleConfirmed:true });
  await action(coordinator, 'APPROVE_PLAN', { planId });
  assert.equal((await state(farmer)).cages[0].liveKg, 200);
  const harvest = { type:'HARVEST', planId, actualKg:50 };
  const harvestRev = (await state(farmer)).revision, harvestRequest = randomUUID();
  await apply(farmer, harvest, harvestRev, harvestRequest);
  const afterHarvest = (await apply(farmer, harvest, harvestRev, harvestRequest)).state;
  assert.equal(afterHarvest.cages[0].liveKg, 150);
  assert.equal(afterHarvest.lots.length, 1);
  assert.equal(afterHarvest.lots[0].kg, 50);
  for (const [buyer, orderId, acceptedKg] of [[a,orderA,20],[b,orderB,30]]) {
    const deliveryId = (await action(coordinator, 'CREATE_DELIVERY', { orderId })).resultId;
    await action(coordinator, 'DISPATCH', { deliveryId });
    await deny(() => action(buyer===a?b:a, 'RECEIVE', { deliveryId, acceptedKg }), '42501');
    await action(buyer, 'RECEIVE', { deliveryId, acceptedKg });
    await action(coordinator, 'COLLECT', { orderId });
  }
  const buyerState = await state(a);
  assert.equal(buyerState.deliveries.length, 1);
  assert.equal(buyerState.lots[0].kg, 20);
  assert.equal(buyerState.lots[0].ownerId, undefined);
  assert.equal(buyerState.financialEntries.length, 0);
  assert.equal(buyerState.plans.length, 0);
  assert.equal(buyerState.observations.length, 0);
  assert.equal(buyerState.orders[0].cageId, undefined);
  assert(!JSON.stringify(buyerState).includes(orderB));
  assert(!JSON.stringify(await state(farmer)).includes(cageB));
  assert.equal((await state(otherFarmer)).plans.length, 0);
  assert.equal((await state(otherFarmer)).financialEntries.length, 0);
  const vmContext = { SPARK:{} };
  vmContext.window = vmContext;
  vm.createContext(vmContext);
  for (const file of ['utils', 'calculations']) vm.runInContext(await read('../assets/js/' + file + '.js'), vmContext);
  const farmData = await state(farmer), finance = vmContext.SPARK.calc.finance(farmData, planId);
  assert.equal(farmData.incidents[0].status, 'open');
  assert.equal(finance.acceptedKg, 50);
  assert.equal(finance.sales, 1700000);
  assert.equal(finance.costs, 100000);
  assert.equal(finance.net, 1600000);
  await action(coordinator, 'PAYOUT', { planId });
  assert.equal(vmContext.SPARK.calc.finance(await state(farmer), planId).paid, 1600000);
  await deny(() => action(coordinator, 'PAYOUT', { planId }), 'P0001');
  const end = new Date(Date.now()-60000).toISOString(), start = new Date(Date.now()-86460000).toISOString();
  const mortality = {type:'RECORD_MORTALITY',cageId,periodStart:start,periodEnd:end,population:250,deaths:0,inspection:'checked',causeStatus:'unknown',sourceName:'ผู้เลี้ยงแจ้งทางโทรศัพท์',channel:'phone'};
  await deny(()=>apply(otherFarmer,mortality),'42501');
  await deny(()=>apply(a,mortality),'42501');
  await apply(coordinator,mortality);
  assert.equal((await state(farmer)).mortalities[0].deaths,0);
  assert.equal((await state(farmer)).mortalities[0].recorderId,coordinator);
  assert.equal((await state(otherFarmer)).mortalities.length,0);
  assert.equal((await state(a)).mortalities.length,0);
  await deny(()=>apply(coordinator,mortality),'P0001');
  await deny(()=>apply(coordinator,{...mortality,cageId:cageB,causeStatus:'confirmed',cause:'น้ำเปลี่ยน'}),'P0001');
  await action(otherFarmer,'RECORD_MORTALITY',{...mortality,cageId:cageB,inspection:'unknown',deaths:''});
  assert.equal((await state(otherFarmer)).mortalities[0].deaths,null);
  const trip={type:'RECORD_TRIP',ownerId:farmer,at:end,hours:2,seedCount:3,catchNote:'จับลูกปลาและปู',fuel:100,bait:0,ice:0,handling:0,transport:0,labor:100,sales:300};
  await apply(coordinator,trip);assert.equal((await state(farmer)).boatTrips[0].sales,30000);assert.equal((await state(a)).boatTrips.length,0);
  await deny(()=>apply(a,trip),'42501');
  await action(coordinator,'SAVE_PARTNER',{name:'ร้านทดสอบ',stage:'contacted',certStatus:'unverified',species:'seabass',minKg:2,maxKg:3,quantity:10});
  assert.equal((await state(a)).partners.length,0);assert.equal((await state(farmer)).partners.length,0);
  await deny(()=>action(coordinator,'SAVE_MODEL',{model:{algorithm:'logistic-regression-v1',synthetic:true}}),'P0001');
  await deny(()=>action(coordinator,'SAVE_GI',{cageId,lotId:afterHarvest.lots[0].id,minFishKg:2,producerRef:'ref',evidence:'doc'}),'P0001');
  await action(coordinator,'RECORD_CONTACT',{incidentId,outcome:'reached',backupId:coordinator,note:'รับเรื่องแล้ว',phone:'0800000000'});
  assert.equal((await state(otherFarmer)).contacts.length,0);assert.equal((await state(a)).contacts.length,0);
  await action(a,'SET_BUYER_SPEC',{minKg:.6,maxKg:1.2,format:'ทั้งตัว',note:'ทดสอบสเปก'});
  await action(coordinator,'SET_LISTING',{cageId,offerKg:5,price:340});
  const assistedOrder=(await requestOrder(a,5)).resultId;
  assert.equal((await state(a)).orders.find(o=>o.id===assistedOrder).buyerSpec.minKg,.6);
  await action(coordinator,'ALLOCATE',{orderId:assistedOrder,cageId,kg:5,reason:'ตรงสเปก'});
  await deny(()=>action(coordinator,'ASSIST_CONFIRM',{orderId:assistedOrder,ownerId:farmer,channel:'phone'}),'P0001');
  await action(coordinator,'ASSIST_CONFIRM',{orderId:assistedOrder,ownerId:farmer,channel:'phone',confirmationEvidence:'เจ้าของยืนยัน 5 กก. ราคา 340 และค่าใช้จ่ายที่ตกลง'});
  await action(a,'CONFIRM_ORDER',{orderId:assistedOrder});
  assert.equal((await state(a)).orders.find(o=>o.id===assistedOrder).status,'confirmed');
  assert.equal((await state(a)).orders.find(o=>o.id===assistedOrder).assistedConfirmations,undefined);
  assert.equal((await state(farmer)).orders.find(o=>o.id===assistedOrder).assistedConfirmations[0].recorderId,coordinator);
  assert(!JSON.stringify(await state(otherFarmer)).includes(assistedOrder));
  const mortId=(await state(farmer)).mortalities[0].id;
  await action(farmer,'VOID_MORTALITY',{id:mortId,reason:'ทดสอบการแก้ไขพร้อมหลักฐาน'});
  assert.equal((await state(farmer)).mortalities[0].voidReason,'ทดสอบการแก้ไขพร้อมหลักฐาน');
  await apply(farmer,mortality);
  assert.equal((await state(farmer)).mortalities.length,2);
  console.log('PASS PostgreSQL pilot: additive/idempotent migration, death intervals and privacy, trip costs, partner/GI controls, assisted confirmations and buyer specifications.');
  console.log('PASS PostgreSQL: isolation by role and group, permission errors, replay and revision conflicts, care and sale through payout (50 kg / THB 17,000 / THB 16,000).');
} finally { await db.close(); }
