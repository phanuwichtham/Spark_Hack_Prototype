-- Additive pilot migration. Run AFTER 001. No rows, members, or orders are reset.
begin;
do $$ begin
  if to_regprocedure('spark_pilot.apply_action_v1(jsonb,jsonb,text,uuid,text,text,timestamptz)') is null then
    alter function spark_pilot.apply_action(jsonb,jsonb,text,uuid,text,text,timestamptz) rename to apply_action_v1;
  end if;
  if to_regprocedure('spark_pilot.project_v1(text,text,bigint,jsonb,uuid,text,timestamptz)') is null then
    alter function spark_pilot.project(text,text,bigint,jsonb,uuid,text,timestamptz) rename to project_v1;
  end if;
end $$;

create or replace function spark_pilot.apply_action(
  s jsonb,a jsonb,workspace text,actor uuid,role_name text,actor_name text,now_at timestamptz
) returns jsonb language plpgsql volatile set search_path='' as $$
declare
  cmd text:=a->>'type'; k text; key_name text; result_id text; c jsonb; x jsonb; o jsonb; m jsonb; r jsonb; provenance jsonb;
  start_at timestamptz; end_at timestamptz; population numeric; deaths numeric; low numeric; high numeric; owner_id text; refs jsonb; confirmations jsonb;
begin
  foreach k in array array['mortalities','boatTrips','partners','giRecords','contacts','models','buyerSpecs'] loop
    s:=jsonb_set(s,array[k],coalesce(s->k,'[]'::jsonb));
  end loop;
  if cmd not in ('VOID_MORTALITY','RECORD_MORTALITY','RECORD_TRIP','SAVE_PARTNER','SAVE_GI','RECORD_CONTACT','ASSIST_CONFIRM','SET_BUYER_SPEC','SAVE_MODEL') then
    r:=spark_pilot.apply_action_v1(s,a,workspace,actor,role_name,actor_name,now_at);
    if cmd='RECORD_WATER' then
      x:=spark_pilot.need(r->'state','observations',r->>'resultId');
      x:=x||jsonb_build_object('sourceName',coalesce(nullif(spark_pilot.t(a,'sourceName'),''),actor_name),
        'channel',coalesce(nullif(spark_pilot.t(a,'channel'),''),'self'),'recorderId',actor,'synthetic',false);
      r:=jsonb_set(r,'{state}',spark_pilot.put(r->'state','observations',x));
    end if;
    if cmd='CREATE_ORDER' then
      select v into x from spark_pilot.items(s,'buyerSpecs') with ordinality z(v,ord) where v->>'buyerId'=actor::text order by ord desc limit 1;
      if x is not null then
        o:=spark_pilot.need(r->'state','orders',r->>'resultId');
        r:=jsonb_set(r,'{state}',spark_pilot.put(r->'state','orders',o||jsonb_build_object('buyerSpec',x)));
      end if;
    end if;
    return r;
  end if;
  perform spark_pilot.ensure(role_name in ('farmer','coordinator','buyer'),'บัญชีไม่รองรับ','42501');
  if cmd in ('SAVE_PARTNER','SAVE_GI','ASSIST_CONFIRM','SAVE_MODEL') then
    perform spark_pilot.ensure(role_name='coordinator','ใช้บัญชีผู้ประสานงานโครงการ','42501');
  end if;
  provenance:=jsonb_build_object('sourceName',coalesce(nullif(spark_pilot.t(a,'sourceName'),''),actor_name),
    'channel',coalesce(nullif(spark_pilot.t(a,'channel'),''),'self'),'recorderId',actor,'recordedAt',now_at,'synthetic',false);
  case cmd
  when 'VOID_MORTALITY' then
    x:=spark_pilot.need(s,'mortalities',a->>'id');c:=spark_pilot.need(s,'cages',x->>'cageId');perform spark_pilot.owner_ok(c,role_name,actor);
    perform spark_pilot.ensure(x->>'voidedAt' is null and coalesce(x->>'synthetic','false')='false','บันทึกถูกยกเลิกแล้ว/เป็นข้อมูลสังเคราะห์');
    x:=x||jsonb_build_object('voidedAt',now_at,'voidedBy',actor,'voidReason',spark_pilot.t(a,'reason',true));
    s:=spark_pilot.put(s,'mortalities',x);
    for r in select v from spark_pilot.items(s,'observations') v where v->>'mortalityId'=x->>'id' loop
      s:=spark_pilot.put(s,'observations',r||'{"retracted":true}'::jsonb);
    end loop;
    for r in select v from spark_pilot.items(s,'models') v where v->'synthetic'='false'::jsonb loop
      s:=spark_pilot.put(s,'models',r||jsonb_build_object('invalidatedAt',now_at));
    end loop;
    s:=spark_pilot.log_item(s,'mortalities',c->>'id',actor,now_at,'ยกเลิกบันทึก '||(x->>'id')||': '||(x->>'voidReason'));
    return jsonb_build_object('state',s,'resultId',x->>'id');
  when 'RECORD_MORTALITY' then
    c:=spark_pilot.need(s,'cages',a->>'cageId');perform spark_pilot.owner_ok(c,role_name,actor);
    start_at:=spark_pilot.ts(a->>'periodStart');end_at:=spark_pilot.ts(a->>'periodEnd');
    perform spark_pilot.ensure(end_at>start_at and end_at<=now_at and end_at-start_at<=interval '7 days','ตรวจช่วงเวลาที่บันทึก');
    population:=spark_pilot.n(a,'population',1);perform spark_pilot.ensure(population=trunc(population),'จำนวนปลาต้องเป็นจำนวนเต็ม');
    perform spark_pilot.ensure(a->>'inspection' in ('checked','unknown'),'เลือกผลการตรวจ');
    deaths:=case when a->>'inspection'='checked' then spark_pilot.n(a,'deaths',0,population) else null end;
    perform spark_pilot.ensure(deaths is null or deaths=trunc(deaths),'จำนวนตายต้องเป็นจำนวนเต็ม');
    perform spark_pilot.ensure(not exists(select 1 from spark_pilot.items(s,'mortalities') v where
      v->>'cageId'=c->>'id' and coalesce(v->>'synthetic','false')='false' and v->>'voidedAt' is null
      and (v->>'periodStart')::timestamptz<end_at and (v->>'periodEnd')::timestamptz>start_at),'ช่วงตรวจซ้ำกับบันทึกเดิม');
    perform spark_pilot.ensure(a->>'causeStatus' in ('unknown','suspected','confirmed'),'เลือกสถานะสาเหตุ');
    if a->>'causeStatus'<>'unknown' then perform spark_pilot.t(a,'cause',true); end if;
    if a->>'causeStatus'='confirmed' then perform spark_pilot.t(a,'causeEvidence',true); end if;
    result_id:=spark_pilot.new_id('MORT');key_name:='mortalities';
    x:=jsonb_build_object('id',result_id,'cageId',c->'id','periodStart',start_at,'periodEnd',end_at,
      'population',population,'deaths',deaths,'inspection',a->>'inspection','causeStatus',a->>'causeStatus',
      'cause',spark_pilot.t(a,'cause'),'causeEvidence',spark_pilot.t(a,'causeEvidence'),'response',spark_pilot.t(a,'response'))||provenance;
  when 'RECORD_TRIP' then
    perform spark_pilot.ensure(role_name in ('farmer','coordinator'),'ผู้ซื้อบันทึกเที่ยวเรือไม่ได้','42501');
    owner_id:=case role_name when 'farmer' then actor::text else a->>'ownerId' end;
    perform spark_pilot.ensure(exists(select 1 from spark_pilot.members where group_id=workspace and user_id::text=owner_id and role='farmer'),'เลือกเจ้าของเที่ยวเรือ');
    start_at:=spark_pilot.ts(a->>'at');perform spark_pilot.ensure(start_at<=now_at,'เที่ยวเรือยังไม่สิ้นสุด');
    low:=spark_pilot.n(a,'seedCount');perform spark_pilot.ensure(low=trunc(low),'จำนวนลูกปลาต้องเป็นจำนวนเต็ม');
    result_id:=spark_pilot.new_id('TRIP');key_name:='boatTrips';
    x:=jsonb_build_object('id',result_id,'ownerId',owner_id,'at',start_at,'hours',spark_pilot.n(a,'hours'),
      'seedCount',low,'catchNote',spark_pilot.t(a,'catchNote',true))||provenance;
    foreach k in array array['fuel','bait','ice','handling','transport','labor','sales'] loop
      x:=x||jsonb_build_object(k,round(spark_pilot.n(a,k)*100));
    end loop;
  when 'SAVE_PARTNER' then
    perform spark_pilot.ensure(a->>'stage' in ('target','contacted','sample','ordered','repeat'),'เลือกขั้นคู่ค้า');
    perform spark_pilot.ensure(a->>'certStatus' in ('unverified','verified','preparing'),'เลือกสถานะตรา');
    if a->>'certStatus'='verified' then
      perform spark_pilot.t(a,'certEvidence',true);
      perform spark_pilot.ensure(spark_pilot.day(a->>'certUntil')>=(now_at at time zone 'Asia/Bangkok')::date,'หลักฐานตราหมดอายุ/ยังไม่มีวันสิ้นอายุ');
    end if;
    low:=spark_pilot.n(a,'minKg');high:=spark_pilot.n(a,'maxKg');perform spark_pilot.ensure(high>=low,'ช่วงขนาดปลาไม่ถูกต้อง');
    perform spark_pilot.ensure(a->>'species' in ('seabass','grouper'),'เลือกชนิดปลา');
    result_id:=spark_pilot.new_id('PARTNER');key_name:='partners';
    x:=jsonb_build_object('id',result_id,'name',spark_pilot.t(a,'name',true),'contact',spark_pilot.t(a,'contact'),
      'stage',a->>'stage','certStatus',a->>'certStatus','certEvidence',spark_pilot.t(a,'certEvidence'),'certUntil',spark_pilot.t(a,'certUntil'),
      'species',a->>'species','minKg',low,'maxKg',high,'quantity',spark_pilot.n(a,'quantity'),'note',spark_pilot.t(a,'note'))||provenance;
  when 'SAVE_GI' then
    c:=spark_pilot.need(s,'cages',a->>'cageId');r:=spark_pilot.need(s,'lots',a->>'lotId');
    perform spark_pilot.ensure(c->>'species'='seabass' and r->>'cageId'=c->>'id','GI นี้ต้องเป็นล็อตปลากะพงตามข้อกำหนด');
    low:=spark_pilot.n(a,'minFishKg',2,100);
    result_id:=spark_pilot.new_id('GI');key_name:='giRecords';
    x:=jsonb_build_object('id',result_id,'cageId',c->'id','lotId',r->'id','minFishKg',low,
      'producerRef',spark_pilot.t(a,'producerRef',true),'evidence',spark_pilot.t(a,'evidence',true),
      'reviewer',actor_name,'status','documents-recorded')||provenance;
  when 'RECORD_CONTACT' then
    r:=spark_pilot.need(s,'incidents',a->>'incidentId');c:=spark_pilot.need(s,'cages',r->>'cageId');perform spark_pilot.owner_ok(c,role_name,actor);
    perform spark_pilot.ensure(a->>'outcome' in ('unreached','reached','responding','followup'),'เลือกผลการติดต่อ');
    if nullif(a->>'backupId','') is not null then
      perform spark_pilot.ensure(exists(select 1 from spark_pilot.members where group_id=workspace and user_id::text=a->>'backupId' and role='coordinator'),'เลือกผู้ประสานสำรอง');
    end if;
    result_id:=spark_pilot.new_id('CALL');key_name:='contacts';
    x:=jsonb_build_object('id',result_id,'incidentId',r->'id','cageId',c->'id','backupId',a->>'backupId',
      'phone',spark_pilot.t(a,'phone'),'outcome',a->>'outcome','note',spark_pilot.t(a,'note',true),
      'nextAt',case when nullif(a->>'nextAt','') is null then null else spark_pilot.ts(a->>'nextAt') end)||provenance;
  when 'ASSIST_CONFIRM' then
    o:=spark_pilot.need(s,'orders',a->>'orderId');perform spark_pilot.ensure(o->>'status' in ('allocated','waiting'),'ออเดอร์ไม่อยู่ในขั้นยืนยัน');
    select jsonb_agg(distinct v->'ownerId') into refs from spark_pilot.items(s,'cages') v where coalesce(o->'cageIds',jsonb_build_array(o->>'cageId')) ? (v->>'id');
    owner_id:=a->>'ownerId';perform spark_pilot.ensure(refs ? owner_id,'เจ้าของไม่เกี่ยวข้อง');
    perform spark_pilot.t(a,'confirmationEvidence',true);perform spark_pilot.t(a,'channel',true);
    confirmations:=coalesce(o->'farmerConfirmations','[]');if not(confirmations ? owner_id) then confirmations:=confirmations||to_jsonb(owner_id);end if;
    o:=o||jsonb_build_object('farmerConfirmations',confirmations,'farmerConfirmed',refs<@confirmations,
      'status',case when refs<@confirmations and o->'buyerConfirmed'='true'::jsonb then 'confirmed' else 'waiting' end,
      'assistedConfirmations',coalesce(o->'assistedConfirmations','[]')||jsonb_build_array(jsonb_build_object(
        'ownerId',owner_id,'evidence',a->>'confirmationEvidence','channel',a->>'channel','recorderId',actor,'at',now_at,
        'priceSatang',o->'priceSatang','allocatedKg',o->'allocatedKg')));
    s:=spark_pilot.put(s,'orders',o);
    result_id:=spark_pilot.new_id('CONF');key_name:='contacts';
    x:=jsonb_build_object('id',result_id,'orderId',o->'id','ownerId',owner_id,'outcome','owner-confirmed','note',a->>'confirmationEvidence')||provenance;
  when 'SET_BUYER_SPEC' then
    perform spark_pilot.ensure(role_name='buyer','ใช้บัญชีผู้ซื้อ','42501');
    low:=spark_pilot.n(a,'minKg');high:=spark_pilot.n(a,'maxKg');perform spark_pilot.ensure(high>=low,'ช่วงขนาดไม่ถูกต้อง');
    result_id:=spark_pilot.new_id('SPEC');key_name:='buyerSpecs';
    x:=jsonb_build_object('id',result_id,'buyerId',actor,'minKg',low,'maxKg',high,'format',spark_pilot.t(a,'format',true),'note',spark_pilot.t(a,'note'))||provenance;
  when 'SAVE_MODEL' then
    m:=a->'model';
    perform spark_pilot.ensure(m->>'algorithm'='logistic-regression-v1' and m->'synthetic'='false'::jsonb and
      jsonb_array_length(m->'featureNames')=9 and jsonb_array_length(m->'weights')=10 and
      jsonb_array_length(m->'means')=9 and jsonb_array_length(m->'scales')=9 and m->>'horizonHours'='24','รูปแบบโมเดลไม่รองรับ/เป็นข้อมูลสังเคราะห์');
    foreach k in array array['weights','means','scales'] loop
      perform spark_pilot.ensure(not exists(select 1 from jsonb_array_elements(m->k) v where jsonb_typeof(v)<>'number' or abs(v::text::numeric)>1000000),'ค่าของโมเดลไม่ถูกต้อง');
    end loop;
    perform spark_pilot.ensure(not exists(select 1 from jsonb_array_elements_text(m->'scales') v where v::numeric<=0),'scale ต้องมากกว่าศูนย์');
    perform spark_pilot.n(m,'trainCount',20);perform spark_pilot.n(m,'testCount',10);
    perform spark_pilot.n(m->'metrics','brier',0,1);perform spark_pilot.n(m->'metrics','baselineBrier',0,1);
    foreach k in array array['tp','fp','fn','tn'] loop
      low:=spark_pilot.n(m->'metrics',k);perform spark_pilot.ensure(low=trunc(low),'ผลประเมินต้องเป็นจำนวนเต็ม');
    end loop;
    perform spark_pilot.ensure(jsonb_typeof(m->'metrics'->'brier')='number' and jsonb_typeof(m->'metrics'->'baselineBrier')='number','รูปแบบคะแนนโมเดลไม่ถูกต้อง');
    result_id:=spark_pilot.new_id('ML');key_name:='models';
    select jsonb_object_agg(key,value) into x from jsonb_each(m) where key=any(array[
      'algorithm','featureNames','means','scales','weights','synthetic','horizonHours','target','trainCount','testCount',
      'cutoff','trainLastEnd','firstAt','lastAt','metrics']);
    x:=x||jsonb_build_object('id',result_id,'operationallyValidated',false,'recorderId',actor,'trainedAt',now_at);
  end case;
  s:=spark_pilot.append_item(s,key_name,x);
  if cmd='RECORD_MORTALITY' and deaths>0 then
    s:=spark_pilot.append_item(s,'observations',jsonb_build_object('id',spark_pilot.new_id('OBS'),'cageId',c->'id',
      'values',jsonb_build_object('do',null,'salinity',null,'temperature',null,'ph',null),'measuredAt',end_at,'receivedAt',now_at,
      'symptoms',jsonb_build_array('พบปลาตาย'),'symptomAt',end_at,'source','กรอกเอง','point','บันทึกการตรวจปลา',
      'instrument','ไม่ได้วัดน้ำในรายการนี้','recorder',actor_name,'note','พบตาย '||deaths||' ตัวในช่วงตรวจ','mortalityId',result_id)||provenance);
  end if;
  s:=spark_pilot.log_item(s,key_name,coalesce(x->>'cageId',x->>'incidentId',x->>'orderId',result_id),actor,now_at,'บันทึก '||key_name||' '||result_id);
  return jsonb_build_object('state',s,'resultId',result_id);
end $$;

create or replace function spark_pilot.project(
  workspace text,group_title text,rev bigint,s jsonb,actor uuid,role_name text,now_at timestamptz
) returns jsonb language plpgsql stable set search_path='' as $$
declare result jsonb; k text; ids text[]; order_ids text[];
begin
  result:=spark_pilot.project_v1(workspace,group_title,rev,s,actor,role_name,now_at);
  result:=result-'mlObservations';
  ids:=array(select v->>'id' from spark_pilot.items(result,'cages') v);
  order_ids:=array(select v->>'id' from spark_pilot.items(result,'orders') v);
  foreach k in array array['mortalities','boatTrips','partners','giRecords','contacts','models','buyerSpecs'] loop
    result:=jsonb_set(result,array[k],case when role_name='coordinator' then coalesce(s->k,'[]') else
      coalesce((select jsonb_agg(v) from spark_pilot.items(s,k) v where
        (k in ('mortalities','giRecords') and v->>'cageId'=any(ids)) or
        (k='boatTrips' and v->>'ownerId'=actor::text) or
        (k='contacts' and role_name='farmer' and (v->>'cageId'=any(ids) or v->>'ownerId'=actor::text)) or
        (k='models' and role_name='farmer' and v->'synthetic'='false'::jsonb) or
        (k='buyerSpecs' and v->>'buyerId'=actor::text)),'[]') end);
  end loop;
  if role_name<>'coordinator' then
    result:=jsonb_set(result,'{orders}',coalesce((select jsonb_agg(case when role_name='buyer' then v-'assistedConfirmations'
      else jsonb_set(v,'{assistedConfirmations}',coalesce((select jsonb_agg(p) from jsonb_array_elements(coalesce(v->'assistedConfirmations','[]')) p
        where p->>'ownerId'=actor::text),'[]')) end) from spark_pilot.items(result,'orders') v),'[]'));
  end if;
  return result;
end $$;
create or replace function spark_pilot.care(s jsonb,cid text,now_at timestamptz,open_urgent boolean) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  obs jsonb;
  tasks jsonb := '[]'; missing text[] := '{}'; rules text[] := '{}';
  urgency text := 'unknown';
  k text; age numeric; threshold numeric; trend numeric[];
begin
  select x into obs from jsonb_array_elements(s->'observations') with ordinality a(x, part_index)
  where x->>'cageId'=cid and x->>'retracted' is distinct from 'true' order by (x->>'measuredAt')::timestamptz desc, part_index desc limit 1;
  if obs is null then
    return jsonb_build_object('urgency',urgency,'observationId',null,'ruleIds',array['DATA-00'],
      'recommendedTasks',array['บันทึกค่าน้ำและอาการ']);
  end if;
  age := extract(epoch from now_at-(obs->>'measuredAt')::timestamptz)/3600;
  foreach k in array array['do','temperature','salinity','ph'] loop
    threshold := case k when 'do' then 4 when 'temperature' then 6 else 12 end;
    if obs->'values'->>k is null then missing := array_append(missing,k);
    elsif age>threshold then
      rules := array_append(rules,'DATA-AGE-'||k);
      tasks := tasks||to_jsonb('วัด '||k||' ซ้ำพร้อมเวลา');
    end if;
    if (obs->'values'->>k)::numeric=0 then
      rules := array_append(rules,'DATA-ZERO');
      tasks := tasks||to_jsonb('ตรวจเครื่องวัดและวัดซ้ำ'::text);
    end if;
  end loop;
  if cardinality(missing)>0 then
    rules := array_append(rules,'DATA-MISSING');
    tasks := tasks||to_jsonb('เพิ่มค่าที่ขาด: '||array_to_string(missing,', '));
  end if;
  if obs->'symptoms' ?| array['ลอยหัว','พบปลาตาย'] then
    urgency := 'urgent'; rules := array_append(rules,'SYM-01');
    tasks := to_jsonb(array['เร่งตรวจอาการและติดต่อผู้รับผิดชอบ'])||tasks;
  elsif obs->'symptoms' ?| array['กินอาหารลดลง','ว่ายผิดปกติ'] then
    urgency := 'watch'; rules := array_append(rules,'SYM-02');
    tasks := tasks||to_jsonb('ตรวจอาการและบันทึกติดตาม'::text);
  end if;
  select array_agg(sub.dissolved order by sub.stamp desc) into trend from (
    select distinct on ((x->>'measuredAt')::timestamptz)
      (x->>'measuredAt')::timestamptz stamp,(x->'values'->>'do')::numeric dissolved
    from jsonb_array_elements(s->'observations') with ordinality a(x,part_index)
    where x->>'cageId'=cid and x->>'retracted' is distinct from 'true' and x->>'source'=obs->>'source' and x->>'point'=obs->>'point'
      and x->'values'->>'do' is not null and (x->>'measuredAt')::timestamptz<=(obs->>'measuredAt')::timestamptz
    order by stamp desc,part_index limit 3
  ) sub;
  if cardinality(trend)=3 and trend[3]>trend[2] and trend[2]>trend[1] then
    if urgency<>'urgent' then urgency := 'watch'; end if;
    rules := array_append(rules,'TREND-DO-01'); tasks := tasks||to_jsonb('ตรวจเครื่องและวัด DO ซ้ำ'::text);
  end if;
  if open_urgent then
    urgency := 'urgent'; rules := array_append(rules,'INC-OPEN');
    tasks := to_jsonb(array['ตรวจติดตามเหตุเร่งด่วนเดิม'])||tasks;
  end if;
  if urgency='unknown' and cardinality(rules)=0 then urgency := 'routine'; end if;
  if tasks='[]' then tasks := to_jsonb(array['ติดตามข้อมูลและขอผู้รับผิดชอบตรวจ']); end if;
  return jsonb_build_object('urgency',urgency,'observationId',obs->>'id','ruleIds',to_jsonb(rules),'recommendedTasks',tasks);
end
$$;


revoke all on all functions in schema spark_pilot from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
