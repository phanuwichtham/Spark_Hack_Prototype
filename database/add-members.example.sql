-- Run this in the Supabase SQL Editor after creating confirmed Auth users.
-- Replace the example addresses and display names. Passwords belong in Auth only.
begin;
insert into spark_pilot.groups(id,title) values ('sala-hum-pilot','บ้านศาลาหุม')
on conflict (id) do nothing;

do $$
declare item record; account uuid;
begin
  for item in select * from (values
    ('coordinator@example.invalid','coordinator','ผู้ประสานทดสอบ'),
    ('farmer-a@example.invalid','farmer','ผู้เลี้ยง A ทดสอบ'),
    ('farmer-b@example.invalid','farmer','ผู้เลี้ยง B ทดสอบ'),
    ('buyer-a@example.invalid','buyer','ร้าน A ทดสอบ'),
    ('buyer-b@example.invalid','buyer','ร้าน B ทดสอบ')
  ) as roster(email,role,display_name) loop
    select u.id into account from auth.users u where lower(u.email)=lower(item.email);
    if account is null then raise exception 'สร้างบัญชี Auth และแก้อีเมลในไฟล์ก่อน: %',item.email; end if;
    insert into spark_pilot.members(group_id,user_id,role,display_name)
    values ('sala-hum-pilot',account,item.role,item.display_name)
    on conflict (group_id,user_id) do update set role=excluded.role,display_name=excluded.display_name;
  end loop;
end
$$;
commit;
