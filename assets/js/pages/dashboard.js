SPARK.page=function(){
  const S=SPARK,U=S.ui,s=U.state(),u=U.user(),e=U.e,cages=U.allowedCages(s),orders=U.allowedOrders(s),plans=U.allowedPlans(s);
  const tasks=s.tasks.filter(t=>t.status!=='done'&&(cages.some(c=>c.id===t.cageId)||t.assignee===u.id));
  const metric=(href,label,value,sub,icon)=>'<a class="card metric-card link-card" href="'+href+'">'+U.icon(icon)+'<span class="metric-label">'+label+'</span><strong class="metric">'+value+'</strong><small class="muted">'+sub+'</small></a>';
  const action=(href,title,copy,icon,cls='')=>'<a class="quick-action '+cls+'" href="'+href+'">'+U.icon(icon)+'<strong>'+title+'</strong><span>'+copy+'</span></a>';
  let actions='',attention='';
  const nextLink=document.querySelector('#dashboard-next')?.closest('.split')?.previousElementSibling?.querySelector('a');
  if(nextLink&&u.role==='buyer'){nextLink.textContent='ดูรายการซื้อของร้าน';nextLink.href='orders.html';}
  if(u.role==='farmer'){
    actions=action('record-water.html','จดการดูแลวันนี้','จดสิ่งที่ตรวจพบในกระชัง','task')+action('record-water.html?intent=alert','แจ้งปลาผิดปกติ','กินน้อย ลอยหัว หรือมีอาการอื่น','bell','alert')+action('harvest.html','ดูนัดจับปลา','ดูวันจับและรายการขาย','fish')+action('finance.html','ดูเงินของฉัน','ดูยอดที่ได้และที่ยังไม่ได้รับ','money');
    const waiting=orders.filter(o=>['allocated','waiting','confirmed'].includes(o.status)&&!(o.farmerConfirmations||[]).includes(u.id));
    const urgent=cages.filter(c=>U.risk(s,c).urgency==='urgent');
    if(waiting.length)attention+='<p><strong>มีรายการขายรอคำตอบ '+waiting.length+' รายการ</strong></p><div class="actions">'+U.link('order-detail.html?id='+waiting[0].id,'เปิดรายการที่รอคำตอบ','btn')+'</div>';
    if(urgent.length)attention+='<p style="margin-top:14px"><strong>กระชัง '+urgent.map(c=>e(c.id)).join(', ')+' มีเรื่องที่ควรรีบตรวจ</strong></p><div class="actions">'+U.link('risk.html?cage='+urgent[0].id,'ดูสิ่งที่ควรทำต่อ')+U.link('help.html?cage='+urgent[0].id,'ให้ผู้ประสานช่วย')+'</div>';
    U.html('#dashboard-metrics','');
    document.querySelector('#dashboard-section-title').textContent='กระชังของฉัน';
    U.html('#dashboard-cages',cages.map(c=>U.cageCard(s,c)).join('')||U.empty('ยังไม่มีกระชังในบัญชีนี้','ให้ผู้ประสานช่วยเพิ่มข้อมูลกระชังให้ก่อนเริ่มใช้งาน','help.html','ให้ผู้ประสานช่วย'));
  }else if(u.role==='buyer'){
    actions=action('marketplace.html','เลือกซื้อปลา','เลือกชนิด ขนาด และวันรับ','shop')+action('orders.html','ดูรายการซื้อของร้าน','ดูสถานะและตอบยืนยัน','order')+action('delivery.html','ดูนัดรับปลา','ดูวันส่งและบันทึกน้ำหนักรับ','truck')+action('help.html','ติดต่อผู้ประสาน','ขอความช่วยเหลือเรื่องรายการซื้อ','help');
    U.html('#dashboard-metrics',metric('orders.html','รายการซื้อของร้าน',orders.length,'เฉพาะร้านของคุณ','order')+metric('offers.html','ข้อเสนอรอคำตอบ',s.offers.filter(o=>o.buyerId===u.id&&o.status==='sent').length,'เปิดเพื่อตรวจและตอบรับ','offer')+metric('delivery.html','นัดส่งที่เกี่ยวข้อง',s.deliveries.filter(d=>orders.some(o=>o.id===d.orderId)).length,'ตรวจนัดและน้ำหนักรับจริง','truck')+metric('marketplace.html','ปลาที่เปิดเสนอขาย',S.util.kg(s.products.reduce((kg,p)=>kg+S.calc.offerAvailable(s,p.id),0)),'ส่งคำขอให้ผู้ประสานตรวจ','fish'));
    document.querySelector('#dashboard-section-title').textContent='รายการซื้อของร้านล่าสุด';
    document.querySelector('#dashboard-section-title').nextElementSibling.textContent='ดูรายการซื้อทั้งหมด';document.querySelector('#dashboard-section-title').nextElementSibling.href='orders.html';
    U.html('#dashboard-cages',orders.slice(-4).reverse().map(o=>U.orderCard(s,o)).join('')||U.empty('ยังไม่มีคำขอซื้อ','เริ่มจากเลือกปลาที่ร้านต้องการ','marketplace.html','เลือกซื้อปลา'));
  }else{
    actions=action('tasks.html','ติดตามงานดูแลปลา','ดูเหตุที่รอตรวจและงานที่ยังไม่เสร็จ','task')+action('orders.html','จัดการคำขอซื้อ','แบ่งปลาและติดตามคำยืนยัน','order')+action('harvest.html','วางนัดจับและส่งปลา','ตรวจปริมาณ นัดหมาย และความพร้อม','truck')+action('finance.html','รับเงินและจ่ายเงิน','ตรวจยอดก่อนลงบันทึกเงินจริง','money');
    U.html('#dashboard-metrics',metric('cages.html','กระชังที่ควรรีบตรวจ',cages.filter(c=>U.risk(s,c).urgency==='urgent').length,'เปิดดูสิ่งที่ตรวจพบ','water')+metric('tasks.html','งานที่ยังไม่เสร็จ',tasks.length,'ดูผู้รับผิดชอบและผลติดตาม','task')+metric('orders.html','คำขอซื้อที่ยังรอแบ่งปลา',orders.filter(o=>o.status==='requested').length,'ตรวจสเปกและปริมาณ','order')+metric('finance.html','ยอดยังไม่ได้จ่ายผู้เลี้ยง',S.util.money(plans.reduce((n,p)=>n+S.calc.finance(s,p.id).unpaid,0)),'แยกจากยอดที่จ่ายแล้ว','money'));
    U.html('#dashboard-cages',cages.slice().sort((a,b)=>(U.risk(s,a).urgency==='urgent'?-1:1)-(U.risk(s,b).urgency==='urgent'?-1:1)).slice(0,4).map(c=>U.cageCard(s,c)).join('')||U.empty('ยังไม่มีกระชังในกลุ่ม','เพิ่มกระชังและเลือกเจ้าของที่ถูกต้อง','cages.html','เพิ่มข้อมูลกระชัง'));
  }
  U.html('#dashboard-greeting','<section class="friendly-home"><h2>วันนี้อยากทำอะไร?</h2><p>เลือกงานที่ต้องการจากปุ่มด้านล่างได้เลย</p><div class="quick-actions">'+actions+'</div>'+(attention?'<div class="friendly-attention">'+attention+'</div>':'')+'</section>');
  U.html('#dashboard-next',tasks.slice(0,3).map(t=>'<a class="card link-card" href="tasks.html?incident='+e(t.incidentId)+'"><div class="card-head"><h3>'+e(t.description)+'</h3>'+U.tag(t.status)+'</div><p>'+e(t.cageId)+' · นัดติดตาม '+e(S.util.date(t.dueAt))+'</p></a>').join('')+orders.filter(o=>['requested','allocated','waiting'].includes(o.status)).slice(0,3).map(o=>'<a class="card link-card" href="order-detail.html?id='+e(o.id)+'"><h3>รายการ '+e(o.id)+'</h3><p>'+e(U.label(o.status))+' · '+S.util.kg(o.requestedKg)+'</p><p class="small">เปิดดูราคา นัดหมาย และสิ่งที่ต้องตอบ</p></a>').join('')||U.empty('ยังไม่มีงานรอในตอนนี้',u.role==='buyer'?'ส่งคำขอซื้อปลาได้จากปุ่มเลือกซื้อปลา':'จดสิ่งที่ตรวจพบในกระชังได้จากปุ่มจดการดูแลวันนี้',u.role==='buyer'?'marketplace.html':'record-water.html',u.role==='buyer'?'เลือกซื้อปลา':'จดการดูแลวันนี้'));
  document.querySelector('#dashboard-next')?.parentElement.querySelector('aside')?.classList.add('dashboard-promo');
};
