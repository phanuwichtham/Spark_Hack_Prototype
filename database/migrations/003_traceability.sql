-- Run after 001 and 002. Additive; keeps all memberships, orders and farm records.
begin;
do $$ begin
  if to_regprocedure('spark_pilot.apply_action_v2(jsonb,jsonb,text,uuid,text,text,timestamptz)') is null then
    alter function spark_pilot.apply_action(jsonb,jsonb,text,uuid,text,text,timestamptz) rename to apply_action_v2;
  end if;
  if to_regprocedure('spark_pilot.project_v2(text,text,bigint,jsonb,uuid,text,timestamptz)') is null then
    alter function spark_pilot.project(text,text,bigint,jsonb,uuid,text,timestamptz) rename to project_v2;
  end if;
end $$;

create or replace function spark_pilot.trace_pick(x jsonb,fields text[]) returns jsonb
language sql immutable set search_path='' as $$
  select coalesce(jsonb_object_agg(k,coalesce(x->k,'null'::jsonb)),'{}') from unnest(fields) k
$$;

create or replace function spark_pilot.trace_url(v text) returns text
language plpgsql immutable set search_path='' as $$
declare authority text; host text;
begin
  if coalesce(v,'')='' then return ''; end if;
  perform spark_pilot.ensure(length(v)<=1000 and v ~* '^https://[a-z0-9][a-z0-9.-]*\.[a-z0-9-]+([/:?#]|$)' and v !~ '[[:space:][:cntrl:]]','ใช้ลิงก์หลักฐาน HTTPS ที่เปิดตรวจได้');
  authority:=split_part(split_part(split_part(substr(v,9),'/',1),'?',1),'#',1);
  host:=lower(split_part(authority,':',1));
  perform spark_pilot.ensure(position('@' in authority)=0 and host !~ '^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2[0-9]|3[01])\.)' and host !~ '\.local$','ใช้ลิงก์หลักฐาน HTTPS ที่เปิดตรวจได้');
  return v;
end $$;

create or replace function spark_pilot.trace_public(s jsonb,lot_id text) returns jsonb
language plpgsql stable set search_path='' as $$
declare share jsonb; history jsonb; standards jsonb; missing integer;
begin
  select v into share from spark_pilot.items(s,'traceShares') with ordinality z(v,n) where v->>'lotId'=lot_id order by n desc limit 1;
  if share is null or share->>'status'<>'shared' then return null; end if;
  select coalesce(jsonb_agg(spark_pilot.trace_pick(v,array['id','kind','fromDate','toDate','description','productName','batchRef','quantityKg','treatmentStatus','withdrawalUntil','withdrawalNote','documentUrl','sourceName','channel','recorderName','recordedAt']) order by n),'[]') into history
    from spark_pilot.items(s,'husbandryRecords') with ordinality z(v,n) where (share->'historyIds') ? (v->>'id') and v->>'voidedAt' is null;
  select coalesce(jsonb_agg(spark_pilot.trace_pick(v,array['id','standardName','certificateNo','issuer','issuedOn','expiresOn','scope','documentUrl','reviewStatus','reviewerName','reviewedAt','reviewNote','sourceName','recorderName','recordedAt'])||
    jsonb_build_object('documentUrl',case when v->>'reviewStatus'='rejected' then '' else v->>'documentUrl' end) order by n),'[]') into standards
    from spark_pilot.items(s,'standardRecords') with ordinality z(v,n) where (share->'evidenceIds') ? (v->>'id') and v->>'voidedAt' is null;
  missing:=jsonb_array_length(share->'historyIds')+jsonb_array_length(share->'evidenceIds')-jsonb_array_length(history)-jsonb_array_length(standards);
  return spark_pilot.trace_pick(share,array['id','lotId','producerLabel','area','methodSummary','sharedAt','recorderName'])||jsonb_build_object('history',history,'standards',standards,'withdrawnCount',missing);
end $$;

create or replace function spark_pilot.apply_action(
  s jsonb,a jsonb,workspace text,actor uuid,role_name text,actor_name text,now_at timestamptz
) returns jsonb language plpgsql volatile set search_path='' as $$
declare
  cmd text:=a->>'type'; k text; key_name text; x jsonb; c jsonb; lot jsonb; rec jsonb; ref text; result_id text; changed boolean:=false;
  first_day date; last_day date; issued date; expires date; harvest_day date; current_day date:=(now_at at time zone 'Asia/Bangkok')::date;
  history_ids jsonb; evidence_ids jsonb; provenance jsonb; amount numeric;
begin
  if cmd not in ('RECORD_HUSBANDRY','ADD_STANDARD','REVIEW_STANDARD','VOID_TRACE_RECORD','SHARE_LOT_TRACE','REVOKE_LOT_TRACE') then
    return spark_pilot.apply_action_v2(s,a,workspace,actor,role_name,actor_name,now_at);
  end if;
  perform spark_pilot.ensure(role_name in ('farmer','coordinator'),'ผู้ซื้อแก้ไขประวัติฟาร์มไม่ได้','42501');
  foreach k in array array['husbandryRecords','standardRecords','traceShares'] loop
    s:=jsonb_set(s,array[k],coalesce(s->k,'[]'));
  end loop;
  provenance:=jsonb_build_object('sourceName',coalesce(nullif(spark_pilot.t(a,'sourceName'),''),actor_name),
    'channel',coalesce(nullif(spark_pilot.t(a,'channel'),''),'self'),'recorderId',actor,'recorderName',actor_name,'recordedAt',now_at);
  if cmd in ('RECORD_HUSBANDRY','ADD_STANDARD') then
    c:=spark_pilot.need(s,'cages',a->>'cageId');perform spark_pilot.owner_ok(c,role_name,actor);
  end if;
  case cmd
  when 'RECORD_HUSBANDRY' then
    perform spark_pilot.ensure(a->>'kind' in ('method','feed','treatment'),'เลือกประเภทประวัติ');
    first_day:=spark_pilot.day(a->>'fromDate');last_day:=spark_pilot.day(a->>'toDate');
    perform spark_pilot.ensure(first_day<=last_day and last_day<=current_day,'ช่วงบันทึกต้องเรียงถูกต้องและไม่อยู่ในอนาคต');
    result_id:=spark_pilot.new_id('FARM');key_name:='husbandryRecords';
    if a->>'kind'='treatment' then perform spark_pilot.ensure(a->>'treatmentStatus' in ('used','reported-none','unknown'),'ระบุสถานะการใช้ยา'); end if;
    if a->>'kind'='feed' and coalesce(a->>'quantityKg','')<>'' then amount:=spark_pilot.n(a,'quantityKg',0.000001,1000000); end if;
    x:=jsonb_build_object('id',result_id,'cageId',c->'id','kind',a->'kind','fromDate',first_day,'toDate',last_day,
      'description',spark_pilot.t(a,'description',true),'productName',spark_pilot.t(a,'productName',a->>'kind'='feed' or (a->>'kind'='treatment' and a->>'treatmentStatus'='used')),
      'batchRef',spark_pilot.t(a,'batchRef'),'quantityKg',amount,'treatmentStatus',case when a->>'kind'='treatment' then a->>'treatmentStatus' else null end,
      'withdrawalUntil','','withdrawalNote',spark_pilot.t(a,'withdrawalNote',a->>'kind'='treatment' and a->>'treatmentStatus'='used'),
      'documentUrl',spark_pilot.trace_url(a->>'documentUrl'))||provenance;
    if a->>'kind'='treatment' and a->>'treatmentStatus'='used' and coalesce(a->>'withdrawalUntil','')<>'' then
      expires:=spark_pilot.day(a->>'withdrawalUntil');perform spark_pilot.ensure(expires>=last_day,'วันหยุดยาต้องไม่ก่อนวันสิ้นสุดการใช้');x:=x||jsonb_build_object('withdrawalUntil',expires);
    end if;
  when 'ADD_STANDARD' then
    if coalesce(a->>'lotId','')<>'' then lot:=spark_pilot.need(s,'lots',a->>'lotId');perform spark_pilot.ensure(lot->>'cageId'=c->>'id','หลักฐานต้องตรงกระชังและล็อต'); end if;
    issued:=spark_pilot.day(a->>'issuedOn');
    if coalesce(a->>'expiresOn','')<>'' then expires:=spark_pilot.day(a->>'expiresOn'); end if;
    perform spark_pilot.ensure(issued<=current_day and (expires is null or expires>=issued),'ตรวจวันออกเอกสารและวันหมดอายุ');
    result_id:=spark_pilot.new_id('CERT');key_name:='standardRecords';
    x:=jsonb_build_object('id',result_id,'cageId',c->'id','lotId',coalesce(a->>'lotId',''),'standardName',spark_pilot.t(a,'standardName',true),
      'certificateNo',spark_pilot.t(a,'certificateNo',true),'issuer',spark_pilot.t(a,'issuer',true),'issuedOn',issued,'expiresOn',coalesce(expires::text,''),
      'scope',spark_pilot.t(a,'scope',true),'documentUrl',spark_pilot.trace_url(spark_pilot.t(a,'documentUrl',true)),'reviewStatus','recorded')||provenance;
  when 'REVIEW_STANDARD' then
    perform spark_pilot.ensure(role_name='coordinator','ให้ผู้ประสานตรวจเอกสาร','42501');
    x:=spark_pilot.need(s,'standardRecords',a->>'id');perform spark_pilot.ensure(x->>'voidedAt' is null,'หลักฐานถูกยกเลิกแล้ว');
    perform spark_pilot.ensure(a->>'reviewStatus' in ('checked','rejected'),'เลือกผลตรวจเอกสาร');
    x:=x||jsonb_build_object('reviewStatus',a->>'reviewStatus','reviewNote',spark_pilot.t(a,'reviewNote',true),'reviewerName',actor_name,'reviewedAt',now_at,'reviewerId',actor);
    key_name:='standardRecords';changed:=true;
  when 'VOID_TRACE_RECORD' then
    key_name:=a->>'collection';perform spark_pilot.ensure(key_name in ('husbandryRecords','standardRecords'),'ประเภทบันทึกไม่ถูกต้อง');
    x:=spark_pilot.need(s,key_name,a->>'id');c:=spark_pilot.need(s,'cages',x->>'cageId');perform spark_pilot.owner_ok(c,role_name,actor);
    perform spark_pilot.ensure(x->>'voidedAt' is null,'บันทึกถูกยกเลิกแล้ว');
    x:=x||jsonb_build_object('voidedAt',now_at,'voidedBy',actor,'voidReason',spark_pilot.t(a,'reason',true));changed:=true;
  else
    lot:=spark_pilot.need(s,'lots',a->>'lotId');c:=spark_pilot.need(s,'cages',lot->>'cageId');perform spark_pilot.owner_ok(c,role_name,actor);key_name:='traceShares';
    if cmd='REVOKE_LOT_TRACE' then
      select v into x from spark_pilot.items(s,'traceShares') with ordinality z(v,n) where v->>'lotId'=lot->>'id' order by n desc limit 1;
      perform spark_pilot.ensure(x is not null and x->>'status'='shared','ล็อตนี้ยังไม่ได้แชร์');
      x:=x||jsonb_build_object('status','revoked','revokedAt',now_at,'revokedBy',actor,'reason',spark_pilot.t(a,'reason',true));changed:=true;
    else
      perform spark_pilot.ensure(a->'ownerConsent'='true'::jsonb,'ยืนยันว่าเจ้าของอนุญาตให้แชร์ข้อมูลที่เลือก');
      history_ids:=a->'historyIds';evidence_ids:=a->'evidenceIds';
      perform spark_pilot.ensure(jsonb_typeof(history_ids)='array' and jsonb_typeof(evidence_ids)='array','ตรวจรายการหลักฐาน');
      perform spark_pilot.ensure(jsonb_array_length(history_ids) between 1 and 100 and jsonb_array_length(evidence_ids)<=100,'เลือกประวัติอย่างน้อยหนึ่งรายการและไม่เกิน 100 รายการ');
      perform spark_pilot.ensure(not exists(select 1 from jsonb_array_elements(history_ids||evidence_ids) v where jsonb_typeof(v)<>'string'),'ตรวจรายการหลักฐาน');
      perform spark_pilot.ensure((select count(distinct v) from jsonb_array_elements(history_ids) v)=jsonb_array_length(history_ids) and (select count(distinct v) from jsonb_array_elements(evidence_ids) v)=jsonb_array_length(evidence_ids),'ไม่เลือกบันทึกซ้ำ');
      rec:=spark_pilot.need(s,'harvests',lot->>'harvestId');harvest_day:=((rec->>'at')::timestamptz at time zone 'Asia/Bangkok')::date;
      for ref in select jsonb_array_elements_text(history_ids) loop
        rec:=spark_pilot.need(s,'husbandryRecords',ref);
        perform spark_pilot.ensure(rec->>'cageId'=c->>'id' and rec->>'voidedAt' is null and (rec->>'toDate')::date<=harvest_day,'ประวัติต้องตรงกระชัง ไม่ถูกยกเลิก และไม่หลังวันจับ');
      end loop;
      for ref in select jsonb_array_elements_text(evidence_ids) loop
        rec:=spark_pilot.need(s,'standardRecords',ref);
        perform spark_pilot.ensure(rec->>'cageId'=c->>'id' and (coalesce(rec->>'lotId','')='' or rec->>'lotId'=lot->>'id') and rec->>'voidedAt' is null and rec->>'reviewStatus'<>'rejected','เอกสารต้องตรงกระชัง / ล็อต และไม่ถูกยกเลิกหรือปฏิเสธ');
      end loop;
      result_id:=spark_pilot.new_id('TRACE');
      x:=jsonb_build_object('id',result_id,'lotId',lot->'id','cageId',c->'id','producerLabel',spark_pilot.t(a,'producerLabel',true),'area',spark_pilot.t(a,'area',true),
        'methodSummary',spark_pilot.t(a,'methodSummary',true),'historyIds',history_ids,'evidenceIds',evidence_ids,'consentByOwnerId',c->'ownerId',
        'consentEvidence',spark_pilot.t(a,'consentEvidence',role_name='coordinator'),'consentChannel',coalesce(nullif(spark_pilot.t(a,'consentChannel'),''),'self'),
        'recorderId',actor,'recorderName',actor_name,'sharedAt',now_at,'status','shared');
    end if;
  end case;
  result_id:=x->>'id';
  if changed then s:=spark_pilot.put(s,key_name,x); else s:=spark_pilot.append_item(s,key_name,x); end if;
  s:=spark_pilot.log_item(s,cmd,coalesce(x->>'lotId',x->>'cageId',result_id),actor,now_at,cmd||' '||result_id||coalesce(': '||(x->>'voidReason'),''));
  return jsonb_build_object('state',s,'resultId',result_id);
end $$;

create or replace function spark_pilot.project(
  workspace text,group_title text,rev bigint,s jsonb,actor uuid,role_name text,now_at timestamptz
) returns jsonb language plpgsql stable set search_path='' as $$
declare result jsonb; k text; ids text[]; lot jsonb; trace jsonb; shared jsonb:='[]';
begin
  result:=spark_pilot.project_v2(workspace,group_title,rev,s,actor,role_name,now_at);
  ids:=array(select v->>'id' from spark_pilot.items(result,'cages') v);
  foreach k in array array['husbandryRecords','standardRecords','traceShares'] loop
    result:=jsonb_set(result,array[k],coalesce((select jsonb_agg(v) from spark_pilot.items(s,k) v where role_name='coordinator' or (role_name='farmer' and v->>'cageId'=any(ids))),'[]'));
  end loop;
  for lot in select v from spark_pilot.items(result,'lots') v loop
    trace:=spark_pilot.trace_public(s,lot->>'id');if trace is not null then shared:=shared||jsonb_build_array(trace); end if;
  end loop;
  return result||jsonb_build_object('traceabilityVersion',1,'sharedLotTraces',shared);
end $$;

revoke all on all functions in schema spark_pilot from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
