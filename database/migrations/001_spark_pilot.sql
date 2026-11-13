-- Run in Supabase SQL Editor as project owner. Legacy spark_* data is kept.
begin;

create schema if not exists spark_pilot;
revoke all on schema spark_pilot from public, anon, authenticated;
alter default privileges in schema spark_pilot revoke execute on functions from public;

create or replace function spark_pilot.blank_state() returns jsonb
language sql immutable set search_path = '' as $$
  select '{
    "cages":[],"observations":[],"assessments":[],"incidents":[],"tasks":[],
    "orders":[],"reservations":[],"offers":[],"plans":[],"harvests":[],"lots":[],
    "deliveries":[],"qualityChecks":[],"financialEntries":[],"audit":[],"notifications":[],
    "products":[
      {"id":"P01","name":"ปลาเก๋าดอกแดง • ไซซ์จาน","species":"grouper","size":"0.6–1.2 กก./ตัว","priceSatang":34000,"image":"grouper.webp"},
      {"id":"P02","name":"ปลาเก๋าดอกแดง • ตัวใหญ่","species":"grouper","size":"มากกว่า 1.2 กก./ตัว","priceSatang":32000,"image":"grouper.webp"},
      {"id":"P03","name":"ปลากะพงสามน้ำ","species":"seabass","size":"ประมาณ 1 กก./ตัว","priceSatang":18000,"image":"seabass.webp"}
    ]
  }'::jsonb
$$;

create table if not exists spark_pilot.groups (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  title text not null check (length(trim(title)) between 1 and 120),
  revision bigint not null default 0 check (revision >= 0),
  state jsonb not null default spark_pilot.blank_state()
);
create table if not exists spark_pilot.members (
  group_id text not null references spark_pilot.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('farmer','buyer','coordinator')),
  display_name text not null check (length(trim(display_name)) between 1 and 120),
  preferences jsonb not null default '{}',
  primary key (group_id, user_id)
);
create table if not exists spark_pilot.requests (
  group_id text not null references spark_pilot.groups(id) on delete cascade,
  actor_id uuid not null,
  request_id uuid not null,
  command jsonb not null,
  result_id text,
  created_at timestamptz not null default now(),
  primary key (group_id, actor_id, request_id)
);

alter table spark_pilot.groups enable row level security;
alter table spark_pilot.members enable row level security;
alter table spark_pilot.requests enable row level security;
revoke all on all tables in schema spark_pilot from public, anon, authenticated;

create or replace function spark_pilot.ensure(ok boolean, explanation text, code text default 'P0001')
returns void language plpgsql immutable set search_path = '' as $$
begin
  if ok is distinct from true then raise exception '%', explanation using errcode = code; end if;
end
$$;

create or replace function spark_pilot.items(s jsonb, k text) returns setof jsonb
language sql immutable set search_path = '' as $$
  select value from jsonb_array_elements(coalesce(s->k,'[]'::jsonb))
$$;

create or replace function spark_pilot.item(s jsonb, k text, key text) returns jsonb
language sql immutable set search_path = '' as $$
  select x from spark_pilot.items(s,k) x where x->>'id'=key
$$;

create or replace function spark_pilot.need(s jsonb, k text, key text) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare row_data jsonb := spark_pilot.item(s,k,key);
begin
  perform spark_pilot.ensure(row_data is not null, 'ไม่พบรายการที่เข้าถึงได้', '42501');
  return row_data;
end
$$;

create or replace function spark_pilot.append_item(s jsonb,k text,x jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_set(s,array[k],(s->k) || jsonb_build_array(x))
$$;

create or replace function spark_pilot.put(s jsonb,k text,x jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_set(s,array[k],coalesce((
    select jsonb_agg(case when e.value->>'id'=x->>'id' then x else e.value end order by e.ordinality)
    from jsonb_array_elements(s->k) with ordinality e
  ),'[]'))
$$;

create or replace function spark_pilot.new_id(prefix text) returns text
language sql volatile set search_path = '' as $$
  select prefix || '-' || left(replace(gen_random_uuid()::text,'-',''),16)
$$;

create or replace function spark_pilot.n(x jsonb, k text, minimum numeric default 0, maximum numeric default 1000000)
returns numeric language plpgsql immutable set search_path = '' as $$
declare v text := x->>k;
begin
  perform spark_pilot.ensure(length(v)<=24 and v ~ '^[+-]?[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]{1,2})?$', 'ตรวจจำนวนหรือหน่วยในช่อง '||k);
  perform spark_pilot.ensure(v::numeric between minimum and maximum, 'จำนวนในช่อง '||k||' เกินช่วงที่กำหนด');
  return v::numeric;
end
$$;

create or replace function spark_pilot.t(x jsonb,k text,required boolean default false)
returns text language plpgsql immutable set search_path = '' as $$
declare v text := coalesce(x->>k,'');
begin
  perform spark_pilot.ensure((not required or length(trim(v))>0) and length(v)<=1000, 'กรอกข้อมูลในช่อง '||k||' ให้ครบ');
  return trim(v);
end
$$;

create or replace function spark_pilot.ts(v text) returns timestamptz
language plpgsql stable set search_path = '' as $$
begin
  perform spark_pilot.ensure(v ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,3})?Z$', 'วันเวลาไม่ถูกต้อง');
  return v::timestamptz;
exception when datetime_field_overflow or invalid_datetime_format then raise exception 'วันเวลาไม่ถูกต้อง';
end
$$;

create or replace function spark_pilot.day(v text) returns date
language plpgsql stable set search_path = '' as $$
begin
  perform spark_pilot.ensure(v ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$', 'วันที่ไม่ถูกต้อง');
  return v::date;
exception when datetime_field_overflow or invalid_datetime_format then raise exception 'วันที่ไม่ถูกต้อง';
end
$$;

create or replace function spark_pilot.active(r jsonb, now_at timestamptz) returns boolean
language sql stable set search_path = '' as $$
  select r->>'status'='active' and (r->>'expiresAt' is null or (r->>'expiresAt')::timestamptz > now_at)
$$;

create or replace function spark_pilot.cage_reserved(s jsonb,cage_id text, now_at timestamptz) returns numeric
language sql stable set search_path = '' as $$
  select coalesce(sum((x->>'kg')::numeric),0)
  from spark_pilot.items(s,'reservations') x
  where x->>'cageId'=cage_id and x->>'lotId' is null and spark_pilot.active(x,now_at)
$$;

create or replace function spark_pilot.cage_available(s jsonb,c jsonb,now_at timestamptz) returns numeric
language sql stable set search_path = '' as $$
  select greatest(0,(c->>'liveKg')::numeric-spark_pilot.cage_reserved(s,c->>'id',now_at))
$$;

create or replace function spark_pilot.product_available(s jsonb,product_id text,now_at timestamptz) returns numeric
language sql stable set search_path = '' as $$
  select coalesce(sum(greatest(0,least((c->>'offerKg')::numeric,(c->>'liveKg')::numeric)
    -spark_pilot.cage_reserved(s,c->>'id',now_at))),0)
  from spark_pilot.items(s,'cages') c where c->>'productId'=product_id
$$;

create or replace function spark_pilot.lot_remaining(s jsonb,l jsonb) returns numeric
language sql immutable set search_path = '' as $$
  select (l->>'kg')::numeric-coalesce(sum((d->'lotUse'->>(l->>'id'))::numeric),0)
  from spark_pilot.items(s,'deliveries') d where d->>'status'='received'
$$;

create or replace function spark_pilot.order_parts(s jsonb,o jsonb)
returns table(plan_id text, kg numeric, part_index bigint)
language sql immutable set search_path = '' as $$
  with parts as (
    select coalesce(l->>'planId',o->>'planId') as pid,(r.value->>'kg')::numeric as quantity,r.ordinality
    from jsonb_array_elements(s->'reservations') with ordinality r
    left join lateral spark_pilot.item(s,'lots',r.value->>'lotId') l on true
    where r.value->>'orderId'=o->>'id' and r.value->>'status' in ('active','fulfilled')
  )
  select pid,sum(quantity),min(ordinality) from parts where pid is not null group by pid
  union all
  select o->>'planId',(o->>'allocatedKg')::numeric,1::bigint
  where o->>'planId' is not null and not exists(select 1 from parts where pid is not null)
$$;

create or replace function spark_pilot.order_shares(s jsonb,o jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  with totals as (
    select *, sum(kg) over () as total, lead(part_index) over(order by part_index) as next_part,
      (o->>'acceptedKg')::numeric as accepted, round((o->>'acceptedKg')::numeric*(o->>'priceSatang')::numeric) as sale
    from spark_pilot.order_parts(s,o)
  ), shares as (
    select *,round(coalesce(sale*kg/nullif(total,0),0)) as amount,
      round(coalesce(accepted*kg/nullif(total,0),0),3) as weight
    from totals
  )
  select coalesce(jsonb_agg(jsonb_build_object('planId',plan_id,
    'amountSatang',case when next_part is null then sale-prior_money else amount end,
    'acceptedKg',case when next_part is null then accepted-prior_weight else weight end) order by part_index),'[]')
  from (select *,coalesce(sum(amount) over(order by part_index rows between unbounded preceding and 1 preceding),0) prior_money,
    coalesce(sum(weight) over(order by part_index rows between unbounded preceding and 1 preceding),0) prior_weight from shares) x
$$;

create or replace function spark_pilot.plan_orders(s jsonb,pid text) returns setof jsonb
language sql immutable set search_path = '' as $$
  select o from spark_pilot.items(s,'orders') o
  where o->>'status' not in ('cancelled','rejected') and exists (
    select 1 from spark_pilot.order_parts(s,o) p where p.plan_id=pid
  )
$$;

create or replace function spark_pilot.log_item(s jsonb,kind text,key text, actor uuid, now_at timestamptz, description text)
returns jsonb language sql volatile set search_path = '' as $$
  select spark_pilot.append_item(s,'audit',jsonb_build_object('id',spark_pilot.new_id('AUD'),
    'type',kind,'entityId',key,'actorId',actor,'at',now_at,'message',description))
$$;

create or replace function spark_pilot.notify(s jsonb,member text,now_at timestamptz,description text,url text)
returns jsonb language sql volatile set search_path = '' as $$
  select spark_pilot.append_item(s,'notifications',jsonb_build_object('id',spark_pilot.new_id('N'),
    'userId',member,'at',now_at,'text',description,'url',url,'read',false))
$$;

create or replace function spark_pilot.care(s jsonb,cid text,now_at timestamptz,open_urgent boolean) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  obs jsonb;
  tasks jsonb := '[]'; missing text[] := '{}'; rules text[] := '{}';
  urgency text := 'unknown';
  k text; age numeric; threshold numeric; trend numeric[];
begin
  select x into obs from jsonb_array_elements(s->'observations') with ordinality a(x, part_index)
  where x->>'cageId'=cid order by (x->>'measuredAt')::timestamptz desc, part_index desc limit 1;
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
    where x->>'cageId'=cid and x->>'source'=obs->>'source' and x->>'point'=obs->>'point'
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

create or replace function spark_pilot.owner_ok(c jsonb, role_name text, uid uuid) returns void
language sql immutable set search_path = '' as $$
  select spark_pilot.ensure(role_name='coordinator' or (role_name='farmer' and c->>'ownerId'=uid::text),
    'บัญชีนี้ไม่ดูแลกระชังนี้','42501')
$$;

create or replace function spark_pilot.buyer_ok(o jsonb, role_name text, uid uuid) returns void
language sql immutable set search_path = '' as $$
  select spark_pilot.ensure(role_name='buyer' and o->>'buyerId'=uid::text,
    'รายการนี้ใช้บัญชีผู้ซื้อของออเดอร์','42501')
$$;

create or replace function spark_pilot.apply_action(
  s jsonb, a jsonb, workspace text, actor uuid, role_name text, actor_name text, now_at timestamptz
) returns jsonb
language plpgsql volatile set search_path = '' as $$
declare
  cmd text := a->>'type'; result_id text; uid text := actor::text;
  today date := (now_at at time zone 'Asia/Bangkok')::date;
  c jsonb; p jsonb; o jsonb; l jsonb; d jsonb; i jsonb; r jsonb; x jsonb; prod jsonb;
  values_json jsonb; flags jsonb; shares jsonb; costs jsonb; checks jsonb; refs jsonb;
  weights jsonb; lots jsonb; next_row jsonb;
  cid text; pid text; oid text; lid text; nid text; k text; status_name text; detail text; member text;
  stamp timestamptz; observed timestamptz; date_value date;
  amount numeric; total numeric; cold numeric; accepted numeric; sales numeric; paid numeric;
  bound numeric; part numeric; remainder numeric; cost_amount numeric;
  setting boolean; keep boolean; already jsonb;
begin
  if cmd in ('SET_LISTING','ALLOCATE','CHECK_PLAN','APPROVE_PLAN','CANCEL_PLAN','DRAFT_OFFER',
    'SEND_OFFER','CANCEL_OFFER','EXPIRE_OFFER','CREATE_DELIVERY','DISPATCH','SET_COSTS','COLLECT','PAYOUT','CLOSE_ORDER') then
    perform spark_pilot.ensure(role_name='coordinator','รายการนี้ใช้บัญชีผู้ประสานกลุ่ม','42501');
  end if;
  case cmd
  when 'ADD_CAGE' then
    perform spark_pilot.ensure(role_name in ('coordinator','farmer'),'บัญชีนี้เพิ่มกระชังไม่ได้','42501');
    member := case when role_name='farmer' then uid else a->>'ownerId' end;
    perform spark_pilot.ensure(exists(select 1 from spark_pilot.members m
      where m.group_id=workspace and m.user_id::text=member and m.role='farmer'),'เลือกผู้เลี้ยงในกลุ่มนี้','42501');
    prod := spark_pilot.need(s,'products',coalesce(nullif(a->>'productId',''),case a->>'species' when 'seabass' then 'P03' else 'P01' end));
    amount := spark_pilot.n(a,'count',1); bound := spark_pilot.n(a,'avgKg',0.001,200);
    perform spark_pilot.ensure(amount=trunc(amount),'จำนวนปลาต้องเป็นจำนวนเต็ม');
    result_id := spark_pilot.new_id('C');
    s := spark_pilot.append_item(s,'cages',jsonb_build_object('id',result_id,'ownerId',member,
      'name',case prod->>'species' when 'seabass' then 'ปลากะพงสามน้ำ' else 'ปลาเก๋าดอกแดง' end,
      'species',prod->'species','productId',prod->'id','stage',coalesce(nullif(spark_pilot.t(a,'stage'),''),'ระยะขุน'),
      'count',amount,'avgKg',bound,'liveKg',round(amount*bound,3),'offerKg',0,'surveyAt',now_at));
  when 'ADJUST_CAGE' then
    c := spark_pilot.need(s,'cages',a->>'cageId'); perform spark_pilot.owner_ok(c,role_name,actor);
    amount := round(spark_pilot.n(a,'liveKg'),3); cid := c->>'id';
    perform spark_pilot.ensure(amount>=spark_pilot.cage_reserved(s,cid,now_at),'ต่ำกว่ายอดกันไว้ ต้องปรับแผนก่อน');
    s := spark_pilot.put(s,'cages',c||jsonb_build_object('liveKg',amount,'surveyAt',now_at));
    s := spark_pilot.log_item(s,'cage',cid,actor,now_at,'ปรับประมาณการ '||amount||' กก. · '||spark_pilot.t(a,'reason',true));
  when 'SET_LISTING' then
    c := spark_pilot.need(s,'cages',a->>'cageId'); cid := c->>'id';
    prod := spark_pilot.need(s,'products',c->>'productId');
    amount := round(spark_pilot.n(a,'offerKg'),3);
    perform spark_pilot.ensure(amount<=(c->>'liveKg')::numeric,'ปริมาณเปิดขายเกินปลาที่มี');
    cost_amount := round(spark_pilot.n(a,'price',0.01,100000)*100);
    s := spark_pilot.put(s,'cages',c||jsonb_build_object('offerKg',amount));
    s := spark_pilot.put(s,'products',prod||jsonb_build_object('priceSatang',cost_amount));
    s := spark_pilot.log_item(s,'cage',cid,actor,now_at,'ปรับปริมาณเปิดขายและราคาของสินค้ากลุ่ม');
  when 'RECORD_WATER' then
    c := spark_pilot.need(s,'cages',a->>'cageId'); cid := c->>'id';
    perform spark_pilot.owner_ok(c,role_name,actor);
    stamp := spark_pilot.ts(a->>'measuredAt');
    perform spark_pilot.ensure(stamp<=now_at,'วันเวลาวัดอยู่ในอนาคต');
    observed := case when a->>'symptomAt' is null then stamp else spark_pilot.ts(a->>'symptomAt') end;
    perform spark_pilot.ensure(observed<=now_at,'เวลาสังเกตอาการอยู่ในอนาคต');
    flags := coalesce(a->'symptoms','[]');
    perform spark_pilot.ensure(jsonb_typeof(flags)='array' and jsonb_array_length(flags)<=4
      and flags <@ '["กินอาหารลดลง","ลอยหัว","ว่ายผิดปกติ","พบปลาตาย"]'::jsonb,'ตรวจรายการอาการ');
    values_json := '{}';
    foreach k in array array['do','temperature','salinity','ph'] loop
      bound := case k when 'do' then 50 when 'temperature' then 60 when 'salinity' then 100 else 14 end;
      amount := case when nullif(a->'values'->>k,'') is null then null else spark_pilot.n(a->'values',k,0,bound) end;
      values_json := values_json||jsonb_build_object(k,amount);
    end loop;
    detail := spark_pilot.t(a,'note');
    perform spark_pilot.ensure(values_json<>'{"do":null,"temperature":null,"salinity":null,"ph":null}'::jsonb
      or flags<>'[]' or detail<>'','กรอกสิ่งที่วัดหรือสังเกตได้อย่างน้อยหนึ่งอย่าง');
    result_id := spark_pilot.new_id('OBS');
    s := spark_pilot.append_item(s,'observations',jsonb_build_object('id',result_id,'cageId',cid,
      'values',values_json,'measuredAt',stamp,'receivedAt',now_at,'source','กรอกเอง',
      'point',coalesce(nullif(spark_pilot.t(a,'point'),''),'ไม่ระบุ'),
      'instrument',coalesce(nullif(spark_pilot.t(a,'instrument'),''),'ยังไม่ยืนยัน'),
      'symptoms',flags,'symptomAt',observed,'recorder',actor_name,'note',detail));
    s := spark_pilot.log_item(s,'cage',cid,actor,now_at,'บันทึกสิ่งที่พบในกระชัง');
  when 'CREATE_CARE' then
    c := spark_pilot.need(s,'cages',a->>'cageId'); cid := c->>'id';
    perform spark_pilot.owner_ok(c,role_name,actor);
    select v into i from spark_pilot.items(s,'incidents') v where v->>'cageId'=cid and v->>'status'<>'closed' limit 1;
    x := spark_pilot.care(s,cid,now_at,coalesce(i->>'urgency'='urgent',false));
    if i is null then
      i := jsonb_build_object('id',spark_pilot.new_id('INC'),'cageId',cid,'status','open','createdAt',now_at,
        'reason',x->'recommendedTasks'->>0,'urgency',x->'urgency');
      s := spark_pilot.append_item(s,'incidents',i);
    else
      i := i||jsonb_build_object('urgency',x->'urgency');
      s := spark_pilot.put(s,'incidents',i);
    end if;
    result_id := i->>'id';
    select v->>'id' into nid from spark_pilot.items(s,'assessments') v
      where v->>'incidentId'=result_id and (v->>'observationId') is not distinct from (x->>'observationId') limit 1;
    if nid is null then
      nid := spark_pilot.new_id('RA');
      s := spark_pilot.append_item(s,'assessments',x||jsonb_build_object('id',nid,'incidentId',result_id,'cageId',cid,'at',now_at));
    end if;
    for detail in select distinct value from jsonb_array_elements_text(x->'recommendedTasks') loop
      if not exists(select 1 from spark_pilot.items(s,'tasks') v where v->>'incidentId'=result_id
        and v->>'description'=detail and (v->>'status'<>'done' or v->>'assessmentId'=nid)) then
        s := spark_pilot.append_item(s,'tasks',jsonb_build_object('id',spark_pilot.new_id('TASK'),'incidentId',result_id,
          'cageId',cid,'assessmentId',nid,'description',detail,'status','unassigned','assignee',null,
          'evidence','','notes','[]'::jsonb,'dueAt',now_at+interval '1 hour'));
      end if;
    end loop;
    s := spark_pilot.log_item(s,'incident',result_id,actor,now_at,'ประเมินและเชื่อมงานดูแล');
    s := spark_pilot.notify(s,c->>'ownerId',now_at,'มีงานดูแลกระชัง '||cid,'tasks.html?incident='||result_id);
  when 'TASK_UPDATE' then
    x := spark_pilot.need(s,'tasks',a->>'taskId'); cid := x->>'cageId';
    c := spark_pilot.need(s,'cages',cid); perform spark_pilot.owner_ok(c,role_name,actor);
    status_name := a->>'status';
    perform spark_pilot.ensure(status_name=any(case x->>'status'
      when 'unassigned' then array['assigned'] when 'assigned' then array['working','followup']
      when 'working' then array['followup','done'] when 'followup' then array['working','done'] else '{}'::text[] end),'ลำดับสถานะงานไม่ถูกต้อง');
    detail := spark_pilot.t(a,'evidence',status_name in ('followup','done'));
    member := x->>'assignee';
    if status_name='assigned' then
      member := uid;
      x := x||jsonb_build_object('acceptedAt',now_at);
    end if;
    if nullif(a->>'assignee','') is not null then
      member := a->>'assignee';
      perform spark_pilot.ensure(role_name='coordinator' and exists(select 1 from spark_pilot.members m where
        m.group_id=workspace and m.user_id::text=member and (m.role='coordinator' or m.user_id::text=c->>'ownerId')),
        'เลือกเจ้าของกระชังหรือผู้ประสานในกลุ่ม','42501');
    end if;
    x := x||jsonb_build_object('status',status_name,'assignee',member,'evidence',coalesce(nullif(detail,''),x->>'evidence'),
      'notes',(x->'notes')||jsonb_build_array(jsonb_build_object('at',now_at,'actorId',actor,'text',coalesce(nullif(detail,''),status_name))));
    s := spark_pilot.put(s,'tasks',x);
    s := spark_pilot.log_item(s,'incident',x->>'incidentId',actor,now_at,'อัปเดตงานดูแล · '||status_name);
  when 'CLOSE_INCIDENT' then
    i := spark_pilot.need(s,'incidents',a->>'incidentId'); c := spark_pilot.need(s,'cages',i->>'cageId');
    perform spark_pilot.owner_ok(c,role_name,actor);
    perform spark_pilot.ensure(i->>'status'<>'closed' and not exists(select 1 from spark_pilot.items(s,'tasks') v
      where v->>'incidentId'=i->>'id' and v->>'status'<>'done'),'ตรวจงานให้เสร็จพร้อมหลักฐานก่อนปิดเหตุ');
    s := spark_pilot.put(s,'incidents',i||jsonb_build_object('status','closed','reasonClosed',spark_pilot.t(a,'reason',true),
      'followup',spark_pilot.t(a,'followup',true)));
    s := spark_pilot.log_item(s,'incident',i->>'id',actor,now_at,'ปิดเหตุหลังติดตามงาน');
  when 'CREATE_ORDER' then
    perform spark_pilot.ensure(role_name='buyer','ใช้บัญชีผู้ซื้อเพื่อส่งคำขอ','42501');
    prod := spark_pilot.need(s,'products',a->>'productId'); amount := round(spark_pilot.n(a,'kg',0.001),3);
    perform spark_pilot.ensure(amount<=spark_pilot.product_available(s,prod->>'id',now_at),'เกินปริมาณที่เปิดขายหรือสินค้าปิดรับแล้ว');
    date_value := spark_pilot.day(a->>'receiveDate');
    perform spark_pilot.ensure(date_value>=today,'เลือกวันที่รับวันนี้หรือหลังจากนี้');
    if a->'optin'='true'::jsonb then
      x := spark_pilot.need(s,'products',coalesce(nullif(a->>'offerProductId',''),prod->>'id'));
      update spark_pilot.members m set preferences=jsonb_build_object(
        'optin',true,'species',x->'species','offerProductIds',jsonb_build_array(x->'id'),
        'maxKg',spark_pilot.n(a,'extraKg',0.001),'offerDate',spark_pilot.day(a->>'extraDate'),
        'offerWindow',spark_pilot.t(a,'extraWindow',true),'offerChannel',spark_pilot.t(a,'channel',true))
      where m.group_id=workspace and m.user_id=actor;
    end if;
    result_id := spark_pilot.new_id('ORD');
    o := jsonb_build_object('id',result_id,'buyerId',actor,'productId',prod->'id','priceSatang',prod->'priceSatang',
      'requestedKg',amount,'allocatedKg',0,'acceptedKg',0,'buyerConfirmed',false,'farmerConfirmed',false,
      'farmerConfirmations','[]'::jsonb,'collected',false,'status','requested','planId',null,
      'receiveDate',date_value,'place',spark_pilot.t(a,'place',true),'window',spark_pilot.t(a,'window',true),
      'note',spark_pilot.t(a,'note'),'createdAt',now_at);
    s := spark_pilot.append_item(s,'orders',o);
    s := spark_pilot.log_item(s,'order',result_id,actor,now_at,'ส่งคำขอซื้อ รอผู้ประสาน');
    for member in select m.user_id::text from spark_pilot.members m where m.group_id=workspace and m.role='coordinator' loop
      s := spark_pilot.notify(s,member,now_at,'มีคำขอซื้อใหม่','order-detail.html?id='||result_id);
    end loop;
  when 'ALLOCATE' then
    o := spark_pilot.need(s,'orders',a->>'orderId'); oid := o->>'id';
    c := spark_pilot.need(s,'cages',a->>'cageId'); cid := c->>'id';
    lid := nullif(a->>'lotId',''); amount := round(spark_pilot.n(a,'kg',0.001),3);
    detail := spark_pilot.t(a,'reason',true); keep := coalesce(a->'append'='true'::jsonb,false);
    perform spark_pilot.ensure(o->>'status' in ('requested','allocated') and c->>'productId'=o->>'productId',
      'ออเดอร์ไม่พร้อมจัดสรรหรือชนิดและขนาดปลาไม่ตรง');
    total := 0;
    for r in select v from spark_pilot.items(s,'reservations') v where v->>'orderId'=oid and spark_pilot.active(v,now_at) loop
      if keep then
        perform spark_pilot.ensure(lid is not null and r->>'lotId' is not null,'เพิ่มหลายแหล่งได้เฉพาะล็อตหลังจับ');
        total := total+(r->>'kg')::numeric;
      else s := spark_pilot.put(s,'reservations',r||'{"status":"released"}');
      end if;
    end loop;
    perform spark_pilot.ensure(total+amount<=(o->>'requestedKg')::numeric,'จัดสรรรวมเกินคำขอ');
    if lid is not null then
      l := spark_pilot.need(s,'lots',lid);
      select coalesce(sum((v->>'kg')::numeric),0) into bound from spark_pilot.items(s,'reservations') v
        where v->>'lotId'=lid and spark_pilot.active(v,now_at);
      perform spark_pilot.ensure(l->>'quality'='passed' and l->>'cageId'=cid and amount<=spark_pilot.lot_remaining(s,l)-bound,
        'ล็อตไม่ตรงกระชัง ไม่ผ่านคุณภาพ หรือมีปริมาณว่างไม่พอ');
      pid := case when keep then o->>'planId' else l->>'planId' end;
    else
      perform spark_pilot.ensure(amount<=spark_pilot.cage_available(s,c,now_at),'ปลาว่างไม่พอ');
      select v->>'id' into pid from spark_pilot.items(s,'plans') v where v->>'cageId'=cid and v->>'status'='draft';
    end if;
    s := spark_pilot.append_item(s,'reservations',jsonb_build_object('id',spark_pilot.new_id('RES'),
      'orderId',oid,'cageId',cid,'lotId',lid,'kg',amount,'status','active'));
    select jsonb_agg(distinct v->'cageId') into refs from spark_pilot.items(s,'reservations') v where v->>'orderId'=oid and spark_pilot.active(v,now_at);
    o := o||jsonb_build_object('planId',pid,'cageId',cid,'cageIds',refs,'allocatedKg',total+amount,'allocationReason',detail,
      'harvested',lid is not null,'fromLots',lid is not null,'weighedKg',case when lid is null then 0 else total+amount end,
      'buyerConfirmed',false,'farmerConfirmed',false,'farmerConfirmations','[]'::jsonb,'status','allocated');
    s := spark_pilot.put(s,'orders',o);
    s := spark_pilot.log_item(s,'order',oid,actor,now_at,'จัดสรรปลาให้ออเดอร์');
    s := spark_pilot.notify(s,c->>'ownerId',now_at,'มีออเดอร์รอผู้เลี้ยงยืนยัน','order-detail.html?id='||oid);
    s := spark_pilot.notify(s,o->>'buyerId',now_at,'มีออเดอร์รอผู้ซื้อยืนยัน','order-detail.html?id='||oid);
  when 'CONFIRM_ORDER' then
    o := spark_pilot.need(s,'orders',a->>'orderId'); oid := o->>'id';
    if role_name='buyer' then
      perform spark_pilot.buyer_ok(o,role_name,actor);
      o := o||'{"buyerConfirmed":true}';
    else
      select jsonb_agg(distinct v->'ownerId') into refs from spark_pilot.items(s,'cages') v where o->'cageIds' ? (v->>'id');
      perform spark_pilot.ensure(role_name='farmer' and refs ? uid,'ให้เจ้าของกระชังยืนยัน','42501');
      already := coalesce(o->'farmerConfirmations','[]');
      if not (already ? uid) then already := already||to_jsonb(uid); end if;
      o := o||jsonb_build_object('farmerConfirmations',already,'farmerConfirmed',refs <@ already);
    end if;
    perform spark_pilot.ensure(o->>'status' in ('allocated','waiting','confirmed'),'ออเดอร์ยังไม่พร้อมยืนยัน');
    status_name := case when o->'buyerConfirmed'='true'::jsonb and o->'farmerConfirmed'='true'::jsonb then 'confirmed' else 'waiting' end;
    s := spark_pilot.put(s,'orders',o||jsonb_build_object('status',status_name));
    s := spark_pilot.log_item(s,'order',oid,actor,now_at,case role_name when 'farmer' then 'ผู้เลี้ยงยืนยัน' else 'ผู้ซื้อยืนยัน' end);
  when 'CANCEL_ORDER' then
    o := spark_pilot.need(s,'orders',a->>'orderId'); oid := o->>'id';
    if role_name<>'coordinator' then perform spark_pilot.buyer_ok(o,role_name,actor); end if;
    perform spark_pilot.ensure((coalesce(o->'harvested','false')='false'::jsonb or o->'fromLots'='true'::jsonb)
      and o->>'status' not in ('sent','received','partial','closed','cancelled')
      and not exists(select 1 from spark_pilot.items(s,'deliveries') v where v->>'orderId'=oid),'มีรอบส่งหรือจับปลาแล้ว ให้แจ้งปัญหาแทน');
    s := spark_pilot.put(s,'orders',o||'{"status":"cancelled"}');
    for r in select v from spark_pilot.items(s,'reservations') v where v->>'orderId'=oid loop
      s := spark_pilot.put(s,'reservations',r||'{"status":"released"}');
    end loop;
    for x in select v from spark_pilot.items(s,'offers') v where v->>'orderId'=oid loop
      s := spark_pilot.put(s,'offers',x||'{"status":"cancelled"}');
    end loop;
    s := spark_pilot.log_item(s,'order',oid,actor,now_at,'ยกเลิก · '||spark_pilot.t(a,'reason',true));
  when 'CREATE_PLAN' then
    c := spark_pilot.need(s,'cages',a->>'cageId'); cid := c->>'id'; perform spark_pilot.owner_ok(c,role_name,actor);
    perform spark_pilot.ensure(not exists(select 1 from spark_pilot.items(s,'plans') v
      where v->>'cageId'=cid and v->>'status' in ('draft','approved')),'กระชังนี้มีแผนที่ยังดำเนินการอยู่');
    amount := round(spark_pilot.n(a,'kg',0.001),3); cold := round(spark_pilot.n(a,'coldKg'),3);
    perform spark_pilot.ensure(amount<=(c->>'liveKg')::numeric and cold<=amount,'ปริมาณเกินปลาในกระชังหรือเกินแผน');
    select v->>'id' into nid from spark_pilot.items(s,'incidents') v where v->>'cageId'=cid and v->>'status'<>'closed' limit 1;
    result_id := spark_pilot.new_id('PLAN');
    date_value := coalesce(spark_pilot.day(coalesce(nullif(a->>'date',''),today::text)),today);
    perform spark_pilot.ensure(date_value>=today,'วันจับอยู่ในอดีต');
    costs := '{"pack":25000,"transport":50000,"group":25000}';
    s := spark_pilot.append_item(s,'plans',jsonb_build_object('id',result_id,'cageId',cid,'incidentId',nid,
      'proposedKg',amount,'coldKg',cold,'status','draft','quality','pending','vehicleConfirmed',false,'coldConfirmed',false,
      'transportKg',amount,'reason',spark_pilot.t(a,'reason',true),'date',date_value,'createdAt',now_at,
      'remainingCare',coalesce(nullif(spark_pilot.t(a,'remainingCare'),''),'เจ้าของดูแลต่อ ตรวจอาการและบันทึกซ้ำ'),
      'responsibleId',c->'ownerId','costs',costs));
    for o in select v from spark_pilot.items(s,'orders') v where v->>'cageId'=cid
      and v->>'planId' is null and v->>'status' in ('allocated','waiting','confirmed') loop
      s := spark_pilot.put(s,'orders',o||jsonb_build_object('planId',result_id));
    end loop;
    s := spark_pilot.log_item(s,'plan',result_id,actor,now_at,'สร้างร่างแผนจับ');
  when 'CHECK_PLAN' then
    p := spark_pilot.need(s,'plans',a->>'planId'); pid := p->>'id'; status_name := a->>'quality';
    perform spark_pilot.ensure(p->>'status'='draft' and status_name in ('pending','passed','rejected'),'ตรวจได้เฉพาะแผนร่าง');
    detail := spark_pilot.t(a,'inspector',true);
    cold := round(spark_pilot.n(a,'coldKg',0,70),3); amount := round(spark_pilot.n(a,'transportKg'),3);
    p := p||jsonb_build_object('quality',status_name,'inspector',detail,'coldKg',cold,'transportKg',amount,
      'vehicleConfirmed',coalesce(a->'vehicleConfirmed'='true'::jsonb,false),'coldConfirmed',coalesce(a->'coldConfirmed'='true'::jsonb,false));
    s := spark_pilot.put(s,'plans',p);
    s := spark_pilot.append_item(s,'qualityChecks',jsonb_build_object('id',spark_pilot.new_id('QC'),'planId',pid,'status',status_name,'inspector',detail,'at',now_at));
    s := spark_pilot.log_item(s,'plan',pid,actor,now_at,'บันทึกผลตรวจและกำลังรองรับ');
  when 'APPROVE_PLAN' then
    p := spark_pilot.need(s,'plans',a->>'planId'); pid := p->>'id'; c := spark_pilot.need(s,'cages',p->>'cageId'); cid := c->>'id';
    perform spark_pilot.ensure(p->>'status'='draft' and p->>'quality'='passed' and p->>'inspector' is not null,'ต้องตรวจคุณภาพผ่านก่อนอนุมัติ');
    perform spark_pilot.ensure(not exists(select 1 from spark_pilot.plan_orders(s,pid) v where
      v->'buyerConfirmed'<>'true'::jsonb or v->'farmerConfirmed'<>'true'::jsonb),'ผู้ซื้อและผู้เลี้ยงต้องยืนยันทุกออเดอร์');
    select coalesce(sum((v->>'allocatedKg')::numeric),0) into accepted from spark_pilot.plan_orders(s,pid) v;
    cold := (p->>'coldKg')::numeric;
    perform spark_pilot.ensure(accepted+cold=(p->>'proposedKg')::numeric,'ออเดอร์ที่ยืนยันและพักเย็นต้องรองรับครบตามแผน');
    perform spark_pilot.ensure(p->'vehicleConfirmed'='true'::jsonb and (p->>'transportKg')::numeric>=accepted,'ยืนยันรถและกำลังรองรับรอบส่ง');
    if cold>0 then
      select coalesce(sum((v->>'coldKg')::numeric),0) into bound from spark_pilot.items(s,'plans') v where v->>'status'='approved';
      select bound+coalesce(sum(spark_pilot.lot_remaining(s,v)),0) into bound from spark_pilot.items(s,'lots') v where v->>'storage'='cold';
      perform spark_pilot.ensure(p->'coldConfirmed'='true'::jsonb and bound+cold<=70 and cold<=spark_pilot.cage_available(s,c,now_at),'ต้องยืนยันพื้นที่เย็นและมีปลาว่างเพียงพอ');
      s := spark_pilot.append_item(s,'reservations',jsonb_build_object('id',spark_pilot.new_id('RES'),'cageId',cid,
        'planId',pid,'kind','cold','kg',cold,'status','active'));
    end if;
    s := spark_pilot.put(s,'plans',p||jsonb_build_object('status','approved','approverId',actor));
    s := spark_pilot.log_item(s,'plan',pid,actor,now_at,'อนุมัติแผนจับ');
  when 'CANCEL_PLAN' then
    p := spark_pilot.need(s,'plans',a->>'planId'); pid := p->>'id';
    perform spark_pilot.ensure(p->>'status' in ('draft','approved') and p->>'harvestId' is null,'ยกเลิกได้ก่อนชั่งจริง');
    s := spark_pilot.put(s,'plans',p||'{"status":"cancelled"}');
    for o in select v from spark_pilot.items(s,'orders') v where v->>'planId'=pid loop
      s := spark_pilot.put(s,'orders',o||'{"status":"cancelled"}');
    end loop;
    for x in select v from spark_pilot.items(s,'offers') v where v->>'planId'=pid loop
      s := spark_pilot.put(s,'offers',x||'{"status":"cancelled"}');
    end loop;
    for r in select v from spark_pilot.items(s,'reservations') v where v->>'planId'=pid or
      (spark_pilot.item(s,'orders',v->>'orderId')->>'planId'=pid) or
      (spark_pilot.item(s,'offers',v->>'offerId')->>'planId'=pid) loop
      s := spark_pilot.put(s,'reservations',r||'{"status":"released"}');
    end loop;
    s := spark_pilot.log_item(s,'plan',pid,actor,now_at,'ยกเลิกแผน · '||spark_pilot.t(a,'reason',true));
  when 'HARVEST' then
    p := spark_pilot.need(s,'plans',a->>'planId'); pid := p->>'id';
    c := spark_pilot.need(s,'cages',p->>'cageId'); cid := c->>'id'; perform spark_pilot.owner_ok(c,role_name,actor);
    perform spark_pilot.ensure(p->>'status'='approved' and p->>'harvestId' is null,'ต้องอนุมัติแผนและชั่งจริงได้หนึ่งครั้ง');
    amount := round(spark_pilot.n(a,'actualKg',0.001),3);
    select coalesce(sum((v->>'allocatedKg')::numeric),0) into accepted from spark_pilot.plan_orders(s,pid) v;
    cold := amount-accepted;
    perform spark_pilot.ensure(cold>=0 and cold<=(p->>'coldKg')::numeric
      and amount<=least((p->>'proposedKg')::numeric,(c->>'liveKg')::numeric),'น้ำหนักจริงไม่อยู่ในช่วงที่แผนและออเดอร์รองรับ');
    result_id := spark_pilot.new_id('HR');
    s := spark_pilot.append_item(s,'harvests',jsonb_build_object('id',result_id,'planId',pid,'cageId',cid,'actualKg',amount,'at',now_at,'recorderId',actor));
    s := spark_pilot.put(s,'plans',p||jsonb_build_object('harvestId',result_id,'actualKg',amount,'status','harvested'));
    s := spark_pilot.put(s,'cages',c||jsonb_build_object('liveKg',(c->>'liveKg')::numeric-amount,
      'offerKg',greatest(0,(c->>'offerKg')::numeric-amount)));
    l := jsonb_build_object('cageId',cid,'ownerId',c->'ownerId','planId',pid,'harvestId',result_id,
      'quality',p->'quality','inspector',p->'inspector','at',now_at,'productId',c->'productId');
    if accepted>0 then
      lid := spark_pilot.new_id('LOT');
      s := spark_pilot.append_item(s,'lots',l||jsonb_build_object('id',lid,'kg',accepted,'storage','dispatch'));
    end if;
    if cold>0 then
      s := spark_pilot.append_item(s,'lots',l||jsonb_build_object('id',spark_pilot.new_id('LOT'),'kg',cold,'storage','cold'));
    end if;
    for o in select v from spark_pilot.plan_orders(s,pid) v loop
      s := spark_pilot.put(s,'orders',o||jsonb_build_object('harvested',true,'status','preparing','weighedKg',o->'allocatedKg'));
      for r in select v from spark_pilot.items(s,'reservations') v where v->>'orderId'=o->>'id' and spark_pilot.active(v,now_at) loop
        s := spark_pilot.put(s,'reservations',r||jsonb_build_object('lotId',lid));
      end loop;
    end loop;
    for r in select v from spark_pilot.items(s,'reservations') v where v->>'planId'=pid and v->>'kind'='cold' loop
      s := spark_pilot.put(s,'reservations',r||'{"status":"converted"}');
    end loop;
    for k in select jsonb_object_keys(p->'costs') loop
      s := spark_pilot.append_item(s,'financialEntries',jsonb_build_object('id',spark_pilot.new_id('FIN'),
        'type','cost','kind',k,'planId',pid,'amountSatang',p->'costs'->k,'at',now_at));
    end loop;
    s := spark_pilot.log_item(s,'plan',pid,actor,now_at,'ชั่งจริง '||amount||' กก. และสร้างล็อต');
  when 'DRAFT_OFFER' then
    p := spark_pilot.need(s,'plans',a->>'planId'); pid := p->>'id'; c := spark_pilot.need(s,'cages',p->>'cageId');
    prod := spark_pilot.need(s,'products',c->>'productId');
    member := a->>'buyerId';
    select m.preferences into x from spark_pilot.members m where m.group_id=workspace and m.role='buyer' and m.user_id::text=member;
    detail := spark_pilot.t(a,'receiveWindow',true);
    perform spark_pilot.ensure(p->>'status'='draft' and x->'optin'='true'::jsonb and x->'offerProductIds' ? (prod->>'id')
      and x->>'offerDate'=p->>'date' and x->>'offerWindow'=detail,'เลือกแผนร่างและเงื่อนไขที่ผู้ซื้อสมัครใจ');
    amount := round(spark_pilot.n(a,'kg',0.001),3);
    perform spark_pilot.ensure(amount<=least((x->>'maxKg')::numeric,(p->>'proposedKg')::numeric),'เกินปริมาณตามแผนหรือที่ผู้ซื้อรับได้');
    result_id := spark_pilot.new_id('OFR');
    s := spark_pilot.append_item(s,'offers',jsonb_build_object('id',result_id,'planId',pid,'buyerId',member,
      'productId',prod->'id','kg',amount,'priceSatang',prod->'priceSatang','status','draft','expiresAt',now_at+interval '6 hours',
      'date',p->'date','place',coalesce(nullif(spark_pilot.t(a,'place'),''),'นัดจุดรับกับผู้ประสาน'),
      'window',detail,'qualityCondition','ตรวจคุณภาพและกำลังรองรับก่อนอนุมัติจับ'));
  when 'SEND_OFFER' then
    x := spark_pilot.need(s,'offers',a->>'offerId'); nid := x->>'id';
    p := spark_pilot.need(s,'plans',x->>'planId'); pid := p->>'id';
    c := spark_pilot.need(s,'cages',p->>'cageId'); cid := c->>'id';
    amount := (x->>'kg')::numeric;
    select coalesce(sum((v->>'kg')::numeric),0) into total from spark_pilot.items(s,'offers') v
      where v->>'planId'=pid and v->>'status'='sent' and (v->>'expiresAt')::timestamptz>now_at;
    select total+coalesce(sum((v->>'allocatedKg')::numeric),0) into total from spark_pilot.plan_orders(s,pid) v
      where v->'buyerConfirmed'='true'::jsonb;
    perform spark_pilot.ensure(p->>'status'='draft' and x->>'status'='draft' and (x->>'expiresAt')::timestamptz>now_at
      and amount+total<=(p->>'proposedKg')::numeric and amount<=spark_pilot.cage_available(s,c,now_at),'ข้อเสนอหมดอายุ หรือกำลังรองรับไม่พอ');
    s := spark_pilot.put(s,'offers',x||'{"status":"sent"}');
    s := spark_pilot.append_item(s,'reservations',jsonb_build_object('id',spark_pilot.new_id('RES'),'cageId',cid,
      'offerId',nid,'kg',amount,'status','active','expiresAt',x->'expiresAt'));
    s := spark_pilot.notify(s,x->>'buyerId',now_at,'มีข้อเสนอปลาใหม่','offers.html');
  when 'RESPOND_OFFER' then
    x := spark_pilot.need(s,'offers',a->>'offerId'); nid := x->>'id'; perform spark_pilot.buyer_ok(x,role_name,actor);
    perform spark_pilot.ensure(x->>'status'='sent' and (x->>'expiresAt')::timestamptz>now_at,'ข้อเสนอหมดอายุหรือไม่ได้รอคำตอบ');
    p := spark_pilot.need(s,'plans',x->>'planId'); pid := p->>'id'; cid := p->>'cageId';
    perform spark_pilot.ensure(p->>'status'='draft','แผนนี้ไม่ได้อยู่ระหว่างร่าง');
    select v into r from spark_pilot.items(s,'reservations') v where v->>'offerId'=nid and spark_pilot.active(v,now_at);
    perform spark_pilot.ensure(r is not null,'ไม่พบการกันปลา');
    if a->>'response'='decline' then
      s := spark_pilot.put(s,'offers',x||'{"status":"rejected"}');
      s := spark_pilot.put(s,'reservations',r||'{"status":"released"}');
    else
      perform spark_pilot.ensure(a->>'response'='accept','เลือกคำตอบของข้อเสนอ');
      amount := round(spark_pilot.n(a,'kg',0.001),3);
      perform spark_pilot.ensure(amount<=(x->>'kg')::numeric,'ตอบรับเกินข้อเสนอ');
      result_id := spark_pilot.new_id('ORD');
      s := spark_pilot.put(s,'offers',x||jsonb_build_object('status',case when amount=(x->>'kg')::numeric then 'accepted' else 'partial' end,
        'acceptedKg',amount,'orderId',result_id));
      s := spark_pilot.put(s,'reservations',r||jsonb_build_object('orderId',result_id,'kg',amount,'expiresAt',null));
      s := spark_pilot.append_item(s,'orders',jsonb_build_object('id',result_id,'buyerId',actor,'productId',x->'productId',
        'priceSatang',x->'priceSatang','requestedKg',amount,'allocatedKg',amount,'acceptedKg',0,'cageId',cid,
        'cageIds',jsonb_build_array(cid),'planId',pid,'offerId',nid,'buyerConfirmed',true,'farmerConfirmed',false,
        'farmerConfirmations','[]'::jsonb,'collected',false,'status','waiting','receiveDate',x->'date',
        'place',x->'place','window',x->'window','createdAt',now_at));
      c := spark_pilot.need(s,'cages',cid);
      s := spark_pilot.notify(s,c->>'ownerId',now_at,'มีออเดอร์จากข้อเสนอรอยืนยัน','order-detail.html?id='||result_id);
    end if;
  when 'CANCEL_OFFER','EXPIRE_OFFER' then
    x := spark_pilot.need(s,'offers',a->>'offerId'); nid := x->>'id';
    perform spark_pilot.ensure(x->>'status' in ('draft','sent','expired','cancelled','rejected'),'ตอบรับแล้ว ให้ดูออเดอร์ที่เชื่อมกัน');
    if x->>'status' in ('draft','sent') then
      perform spark_pilot.ensure(cmd='CANCEL_OFFER' or (x->>'expiresAt')::timestamptz<=now_at,'ข้อเสนอยังไม่หมดอายุ');
      s := spark_pilot.put(s,'offers',x||jsonb_build_object('status',case cmd when 'CANCEL_OFFER' then 'cancelled' else 'expired' end));
      for r in select v from spark_pilot.items(s,'reservations') v where v->>'offerId'=nid and v->>'status'='active' loop
        s := spark_pilot.put(s,'reservations',r||'{"status":"released"}');
      end loop;
    end if;
  when 'CREATE_DELIVERY' then
    o := spark_pilot.need(s,'orders',a->>'orderId'); oid := o->>'id';
    perform spark_pilot.ensure(o->>'status' in ('confirmed','preparing') and o->'harvested'='true'::jsonb and
      o->'buyerConfirmed'='true'::jsonb and o->'farmerConfirmed'='true'::jsonb and
      not exists(select 1 from spark_pilot.items(s,'deliveries') v where v->>'orderId'=oid),'ต้องชั่งจริง ยืนยันครบ และสร้างได้หนึ่งรอบ');
    weights := '{}'; lots := '[]'; total := 0;
    for r in select v from spark_pilot.items(s,'reservations') v where v->>'orderId'=oid and spark_pilot.active(v,now_at) loop
      lid := r->>'lotId'; l := spark_pilot.need(s,'lots',lid);
      perform spark_pilot.ensure(l->>'quality'='passed','ล็อตต้องผ่านการตรวจคุณภาพ');
      amount := (r->>'kg')::numeric;
      if not (lots ? lid) then lots := lots||to_jsonb(lid); end if;
      weights := weights||jsonb_build_object(lid,amount+coalesce((weights->>lid)::numeric,0));
      total := total+amount;
    end loop;
    perform spark_pilot.ensure(total>0,'ไม่พบล็อตพร้อมส่ง');
    result_id := spark_pilot.new_id('DEL');
    s := spark_pilot.append_item(s,'deliveries',jsonb_build_object('id',result_id,'orderId',oid,'planId',o->'planId',
      'lotIds',lots,'lotUse',weights,'kg',total,'status','scheduled','vehicle',coalesce(nullif(spark_pilot.t(a,'vehicle'),''),'รถกลุ่ม'),
      'appointment',(o->>'receiveDate')||' '||(o->>'window'),'at',now_at));
    s := spark_pilot.log_item(s,'order',oid,actor,now_at,'จัดรอบส่งปลา');
  when 'DISPATCH' then
    d := spark_pilot.need(s,'deliveries',a->>'deliveryId'); oid := d->>'orderId'; o := spark_pilot.need(s,'orders',oid);
    perform spark_pilot.ensure(d->>'status'='scheduled' and o->>'status' in ('confirmed','preparing'),'รอบส่งไม่ได้อยู่ในสถานะนัดส่ง');
    s := spark_pilot.put(s,'deliveries',d||'{"status":"sent"}');
    s := spark_pilot.put(s,'orders',o||'{"status":"sent"}');
    s := spark_pilot.log_item(s,'order',oid,actor,now_at,'บันทึกส่งปลาแล้ว');
    s := spark_pilot.notify(s,o->>'buyerId',now_at,'ส่งปลาแล้ว รอยืนยันน้ำหนักรับจริง','delivery.html');
  when 'RECEIVE' then
    d := spark_pilot.need(s,'deliveries',a->>'deliveryId'); oid := d->>'orderId'; o := spark_pilot.need(s,'orders',oid);
    perform spark_pilot.buyer_ok(o,role_name,actor);
    perform spark_pilot.ensure(d->>'status'='sent' and o->>'status'='sent','ต้องส่งปลาแล้วและรับมอบได้ครั้งเดียว');
    amount := round(spark_pilot.n(a,'acceptedKg',0,(d->>'kg')::numeric),3);
    total := (d->>'kg')::numeric; remainder := total-amount;
    detail := spark_pilot.t(a,'issue',remainder>0);
    status_name := case when remainder=0 then 'received' else 'partial' end;
    o := o||jsonb_build_object('acceptedKg',amount,'status',status_name);
    s := spark_pilot.put(s,'orders',o);
    s := spark_pilot.put(s,'deliveries',d||jsonb_build_object('status','received','acceptedKg',amount,'issue',detail));
    for r in select v from spark_pilot.items(s,'reservations') v where v->>'orderId'=oid and v->>'status'='active' loop
      s := spark_pilot.put(s,'reservations',r||'{"status":"fulfilled"}');
    end loop;
    if remainder>0 then
      bound := 0;
      for lid in select value from jsonb_array_elements_text(d->'lotIds') loop
        l := spark_pilot.need(s,'lots',lid);
        part := case when lid=d->'lotIds'->>-1 then remainder-bound else round(remainder*(d->'lotUse'->>lid)::numeric/total,3) end;
        bound := bound+part;
        if part>0 then
          s := spark_pilot.append_item(s,'lots',l||jsonb_build_object('id',spark_pilot.new_id('LOT'),
            'kg',part,'storage','hold','quality','pending','returnOf',d->'id','at',now_at));
        end if;
      end loop;
    end if;
    shares := spark_pilot.order_shares(s,o);
    s := spark_pilot.append_item(s,'financialEntries',jsonb_build_object('id',spark_pilot.new_id('FIN'),'type','sale',
      'orderId',oid,'planId',o->'planId','amountSatang',round(amount*(o->>'priceSatang')::numeric),'shares',shares,'at',now_at));
    s := spark_pilot.log_item(s,'order',oid,actor,now_at,'รับจริง '||amount||' กก.');
  when 'REPORT_ISSUE' then
    o := spark_pilot.need(s,'orders',a->>'orderId'); oid := o->>'id';
    if role_name<>'coordinator' then perform spark_pilot.buyer_ok(o,role_name,actor); end if;
    s := spark_pilot.put(s,'orders',o||jsonb_build_object('issue',spark_pilot.t(a,'issue',true)));
    s := spark_pilot.log_item(s,'order',oid,actor,now_at,'บันทึกปัญหาออเดอร์');
  when 'SET_COSTS' then
    p := spark_pilot.need(s,'plans',a->>'planId'); pid := p->>'id';
    perform spark_pilot.ensure(not exists(select 1 from spark_pilot.items(s,'financialEntries') v
      where v->>'planId'=pid and v->>'type'='payout'),'บันทึกจ่ายแล้ว จึงแก้ค่าใช้จ่ายย้อนหลังไม่ได้');
    costs := '{}';
    foreach k in array array['pack','transport','group'] loop
      costs := costs||jsonb_build_object(k,round(spark_pilot.n(a,k)*100));
    end loop;
    s := spark_pilot.put(s,'plans',p||jsonb_build_object('costs',costs));
    for x in select v from spark_pilot.items(s,'financialEntries') v where v->>'planId'=pid and v->>'type'='cost' loop
      s := spark_pilot.put(s,'financialEntries',x||jsonb_build_object('amountSatang',costs->(x->>'kind')));
    end loop;
    s := spark_pilot.log_item(s,'plan',pid,actor,now_at,'บันทึกค่าใช้จ่ายของแผน');
  when 'COLLECT' then
    o := spark_pilot.need(s,'orders',a->>'orderId'); oid := o->>'id';
    perform spark_pilot.ensure(o->>'status' in ('received','partial') and o->'collected'='false'::jsonb,'ต้องรับมอบแล้วและบันทึกชำระได้ครั้งเดียว');
    s := spark_pilot.put(s,'orders',o||'{"collected":true}');
    s := spark_pilot.append_item(s,'financialEntries',jsonb_build_object('id',spark_pilot.new_id('FIN'),'type','collection',
      'orderId',oid,'planId',o->'planId','amountSatang',round((o->>'acceptedKg')::numeric*(o->>'priceSatang')::numeric),'at',now_at));
    s := spark_pilot.log_item(s,'order',oid,actor,now_at,'บันทึกการรับชำระ');
  when 'PAYOUT' then
    p := spark_pilot.need(s,'plans',a->>'planId'); pid := p->>'id';
    c := spark_pilot.need(s,'cages',p->>'cageId');
    perform spark_pilot.ensure(p->>'harvestId' is not null and exists(select 1 from spark_pilot.plan_orders(s,pid)) and
      not exists(select 1 from spark_pilot.plan_orders(s,pid) v where v->'collected'<>'true'::jsonb or v->>'status' not in ('received','partial','closed')),
      'ต้องรับมอบและเก็บเงินครบก่อนจ่าย');
    select coalesce(sum((v->>'amountSatang')::numeric),0) into sales
      from spark_pilot.plan_orders(s,pid) o1 cross join lateral jsonb_array_elements(spark_pilot.order_shares(s,o1)) v
      where v->>'planId'=pid;
    select coalesce(sum((v->>'amountSatang')::numeric),0) into paid
      from spark_pilot.items(s,'financialEntries') v where v->>'planId'=pid and v->>'type'='payout';
    select sum(value::numeric) into cost_amount from jsonb_each_text(p->'costs');
    amount := sales-cost_amount-paid;
    perform spark_pilot.ensure(amount>0,'ไม่มีเงินค้างจ่าย');
    s := spark_pilot.append_item(s,'financialEntries',jsonb_build_object('id',spark_pilot.new_id('FIN'),'type','payout',
      'planId',pid,'ownerId',c->'ownerId','amountSatang',amount,'at',now_at));
    s := spark_pilot.log_item(s,'plan',pid,actor,now_at,'บันทึกจ่ายผู้เลี้ยง');
  when 'CLOSE_ORDER' then
    o := spark_pilot.need(s,'orders',a->>'orderId'); oid := o->>'id';
    perform spark_pilot.ensure(o->'collected'='true'::jsonb and o->>'status' in ('received','partial'),'ปิดออเดอร์หลังรับมอบและชำระ');
    s := spark_pilot.put(s,'orders',o||'{"status":"closed"}');
    s := spark_pilot.log_item(s,'order',oid,actor,now_at,'ปิดออเดอร์');
  when 'READ_NOTIFICATION' then
    x := spark_pilot.need(s,'notifications',a->>'id');
    perform spark_pilot.ensure(x->>'userId'=uid,'แจ้งเตือนของบัญชีอื่น','42501');
    s := spark_pilot.put(s,'notifications',x||'{"read":true}');
  else raise exception 'โหมดกลุ่มไม่รองรับรายการนี้';
  end case;
  return jsonb_build_object('state',s,'resultId',result_id);
end
$$;

-- Select and redact records before they are serialized for a browser.
create or replace function spark_pilot.project(
  workspace text, group_title text, rev bigint, s jsonb, actor uuid, role_name text, now_at timestamptz
) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  result jsonb := s;
  uid text := actor::text;
  cages text[]; orders text[]; plans text[]; lots text[]; incidents text[]; counterparts text[];
  collection text;
begin
  result := result||jsonb_build_object('groupName',group_title,'revision',rev,'currentUserId',uid,'demoNow',now_at,
    'products',coalesce((select jsonb_agg(x||jsonb_build_object('availableKg',spark_pilot.product_available(s,x->>'id',now_at)))
      from spark_pilot.items(s,'products') x),'[]'),
    'notifications',coalesce((select jsonb_agg(x) from spark_pilot.items(s,'notifications') x where x->>'userId'=uid),'[]'));
  if role_name='coordinator' then
    return result||jsonb_build_object('users',coalesce((select jsonb_agg(
      jsonb_build_object('id',m.user_id,'name',m.display_name,'role',m.role)||m.preferences order by m.display_name)
      from spark_pilot.members m where m.group_id=workspace),'[]'));
  end if;

  cages := array(select x->>'id' from spark_pilot.items(s,'cages') x where role_name='farmer' and x->>'ownerId'=uid);
  plans := array(select x->>'id' from spark_pilot.items(s,'plans') x where x->>'cageId'=any(cages));
  incidents := array(select x->>'id' from spark_pilot.items(s,'incidents') x where x->>'cageId'=any(cages));
  orders := array(select x->>'id' from spark_pilot.items(s,'orders') x where
    (role_name='buyer' and x->>'buyerId'=uid) or (role_name='farmer' and coalesce(x->'cageIds','[]') ?| cages));
  lots := array(select distinct x->>'id' from spark_pilot.items(s,'lots') x where x->>'cageId'=any(cages) or
    (role_name='buyer' and exists(select 1 from spark_pilot.items(s,'reservations') v where
      v->>'orderId'=any(orders) and v->>'lotId'=x->>'id' and v->>'status' in ('active','fulfilled'))));
  counterparts := array(select distinct x->>'buyerId' from spark_pilot.items(s,'orders') x where x->>'id'=any(orders));

  foreach collection in array array['cages','observations','assessments','incidents','tasks','plans','harvests'] loop
    result := jsonb_set(result,array[collection],coalesce((select jsonb_agg(x) from spark_pilot.items(s,collection) x
      where (case collection when 'cages' then x->>'id' else x->>'cageId' end)=any(cages)),'[]'));
  end loop;
  result := result||jsonb_build_object(
    'users',coalesce((select jsonb_agg(jsonb_build_object('id',m.user_id,'name',m.display_name,'role',m.role)||
      case when m.user_id=actor then m.preferences else '{}'::jsonb end)
      from spark_pilot.members m where m.group_id=workspace and
      (m.user_id=actor or (role_name='farmer' and (m.role='coordinator' or m.user_id::text=any(counterparts))))),'[]'),
    'orders',coalesce((select jsonb_agg(case role_name when 'buyer' then
      x - array['cageId','cageIds','planId','farmerConfirmations','allocationReason']
      else (x - array['cageId','cageIds','planId','farmerConfirmations']) || jsonb_build_object(
        'cageId', (select value from jsonb_array_elements_text(coalesce(x->'cageIds','[]')) where value=any(cages) limit 1),
        'cageIds', (select coalesce(jsonb_agg(value),'[]') from jsonb_array_elements_text(coalesce(x->'cageIds','[]')) where value=any(cages)),
        'planId', case when x->>'planId'=any(plans) then x->>'planId' end,
        'farmerConfirmations',case when coalesce(x->'farmerConfirmations','[]') ? uid then jsonb_build_array(uid) else '[]' end,
        'shares',(select coalesce(jsonb_agg(y),'[]') from jsonb_array_elements(spark_pilot.order_shares(s,x)) y where y->>'planId'=any(plans)))
      end) from spark_pilot.items(s,'orders') x where x->>'id'=any(orders)),'[]'),
    'lots',coalesce((select jsonb_agg(case role_name when 'buyer' then jsonb_build_object('id',x->'id',
      'quality',x->'quality','productId',x->'productId','at',x->'at','kg',(
        select coalesce(sum((v->>'kg')::numeric),0) from spark_pilot.items(s,'reservations') v where
          v->>'lotId'=x->>'id' and v->>'orderId'=any(orders) and v->>'status' in ('active','fulfilled')))
      else x end) from spark_pilot.items(s,'lots') x where x->>'id'=any(lots)),'[]'),
    'reservations',coalesce((select jsonb_agg(case when role_name='buyer' then x-array['cageId','planId'] else x end)
      from spark_pilot.items(s,'reservations') x where x->>'cageId'=any(cages) or
      (role_name='buyer' and x->>'orderId'=any(orders) and x->>'status' in ('active','fulfilled'))),'[]'),
    'deliveries',coalesce((select jsonb_agg((x-array['planId','lotUse','lotIds'])||
      jsonb_build_object('lotIds',(select coalesce(jsonb_agg(value),'[]') from jsonb_array_elements_text(x->'lotIds') where value=any(lots)),
      'lotUse',(select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(x->'lotUse') where key=any(lots))))
      from spark_pilot.items(s,'deliveries') x where x->>'orderId'=any(orders)),'[]'),
    'offers',coalesce((select jsonb_agg(x-'planId') from spark_pilot.items(s,'offers') x
      where role_name='buyer' and x->>'buyerId'=uid and x->>'status'<>'draft'),'[]'),
    'qualityChecks',coalesce((select jsonb_agg(x) from spark_pilot.items(s,'qualityChecks') x where x->>'planId'=any(plans)),'[]'),
    'financialEntries',coalesce((select jsonb_agg(x) from spark_pilot.items(s,'financialEntries') x
      where x->>'planId'=any(plans) and x->>'type' in ('cost','payout')),'[]'),
    'audit',coalesce((select jsonb_agg(x) from spark_pilot.items(s,'audit') x where x->>'entityId'=any(cages||plans||incidents)
      or (x->>'entityId'=any(orders) and x->>'actorId'=uid)),'[]')
  );
  return result;
end
$$;

create or replace function public.spark_pilot_read(p_workspace text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  role_name text;
  g spark_pilot.groups%rowtype;
begin
  select m.role into role_name from spark_pilot.members m where m.group_id=p_workspace and m.user_id=me;
  perform spark_pilot.ensure(role_name is not null,'ต้องเป็นสมาชิกกลุ่ม','42501');
  select * into g from spark_pilot.groups where id=p_workspace;
  return spark_pilot.project(g.id,g.title,g.revision,g.state,me,role_name,statement_timestamp());
end
$$;

create or replace function public.spark_pilot_apply(
  p_workspace text, p_revision bigint, p_request uuid, p_action jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  member spark_pilot.members%rowtype;
  g spark_pilot.groups%rowtype;
  previous spark_pilot.requests%rowtype;
  next_state jsonb;
  result_id text;
  now_at timestamptz;
begin
  perform spark_pilot.ensure(exists(select 1 from spark_pilot.members m where m.group_id=p_workspace and m.user_id=me),
    'ต้องเป็นสมาชิกกลุ่ม','42501');
  select * into g from spark_pilot.groups where id=p_workspace for update;
  select * into member from spark_pilot.members m where m.group_id=g.id and m.user_id=me for update;
  perform spark_pilot.ensure(member.role is not null,'ต้องเป็นสมาชิกกลุ่ม','42501');
  perform spark_pilot.ensure(p_request is not null and jsonb_typeof(p_action)='object'
    and pg_column_size(p_action)<=16000,'รายการบันทึกไม่ถูกต้อง');
  now_at := clock_timestamp();
  select * into previous from spark_pilot.requests r where r.group_id=g.id and r.actor_id=me and r.request_id=p_request;
  if found then
    perform spark_pilot.ensure(previous.command=p_action,'รหัสบันทึกนี้ถูกใช้กับข้อมูลอื่นแล้ว');
    result_id := previous.result_id;
  else
    perform spark_pilot.ensure(p_revision=g.revision,'ข้อมูลกลุ่มเปลี่ยนแล้ว','40001');
    next_state := spark_pilot.apply_action(g.state,p_action,g.id,me,member.role,member.display_name,now_at);
    result_id := next_state->>'resultId';
    g.state := next_state->'state';
    g.revision := g.revision+1;
    update spark_pilot.groups set state=g.state, revision=g.revision where id=g.id;
    insert into spark_pilot.requests(group_id,actor_id,request_id,command,result_id) values(g.id,me,p_request,p_action,result_id);
  end if;
  return jsonb_build_object('resultId',result_id,'state',spark_pilot.project(g.id,g.title,g.revision,g.state,me,member.role,now_at));
end
$$;

revoke all on all functions in schema spark_pilot from public, anon, authenticated;
revoke all on function public.spark_pilot_read(text), public.spark_pilot_apply(text,bigint,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.spark_pilot_read(text), public.spark_pilot_apply(text,bigint,uuid,jsonb) to authenticated;
notify pgrst, 'reload schema';
commit;
