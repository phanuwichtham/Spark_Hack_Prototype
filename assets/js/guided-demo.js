// Each step is derived from the current demo records. Switching roles keeps the records.
(function (S) {
  const water = 'record-water.html', harvest = 'harvest.html', delivery = 'delivery.html';
  const farm = 'F01', coord = 'CO01';
  function steps(s) {
    const urgent = s.scenario === 'urgent';
    const cage = urgent ? 'C03' : 'C01';
    const query = '?cage=' + cage;
    const original = urgent ? 'OBS-05' : 'OBS-03';
    const observation = s.observations.some(o => o.cageId === cage && o.id !== original &&
      (urgent || !['OBS-01', 'OBS-02'].includes(o.id)));
    const incident = s.incidents.find(i => i.cageId === cage);
    const tasks = s.tasks.filter(t => t.incidentId === incident?.id);
    const plan = s.plans.find(p => p.cageId === cage && p.status !== 'cancelled');
    const order = buyer => s.orders.find(o => o.buyerId === buyer && o.productId === 'P01' && o.status !== 'cancelled');
    const a = order('R01'), b = order('R02');
    const offer = s.offers.find(o => o.planId === plan?.id && !['expired', 'cancelled', 'rejected'].includes(o.status));
    const orderPage = o => 'order-detail.html?id=' + o.id;
    const step = (n, user, href, action, help = '') => ({ n, user, href, action, help });
    if (s.scenario === 'missing') {
      const updated = s.observations.some(o => o.cageId === 'C04' && o.id !== 'OBS-06');
      return updated
        ? step(2, 'F03', 'risk.html?cage=C04', 'ดูผลหลังเพิ่มข้อมูล', 'เทียบข้อมูลที่กรอกกับสิ่งที่ยังขาด')
        : step(1, 'F03', 'risk.html?cage=C04', 'ดูผลกระชัง C04', 'ลองดูผลเมื่อไม่มีค่าออกซิเจน แล้วกดเพิ่มข้อมูลที่วัดได้');
    }
    if (!observation) return step(1, farm, water + query, 'บันทึกสิ่งที่พบ', urgent ?
      'ลองกรอก DO 3.2 อุณหภูมิ 31 ความเค็ม 18 เลือกลอยหัว และเว้น pH' :
      'ลองเลือก “กินอาหารลดลง” แล้วบันทึก ช่องค่าน้ำเว้นว่างได้');
    if (!incident) return step(2, farm, 'risk.html' + query, 'ดูผลและสร้างงานดูแล', 'เปิดผลล่าสุด แล้วกด “สร้างงานดูแล”');
    if (!tasks.some(t => ['working', 'followup', 'done'].includes(t.status)))
      return step(2, farm, 'tasks.html?incident=' + incident.id, 'รับงานและเริ่มดูแล', 'เลือกหนึ่งงาน บันทึกรับงาน แล้วบันทึกสถานะ “กำลังทำ”');
    if (urgent) {
      if (!plan) return step(3, farm, harvest + query, 'ร่างแผนจับ 50 กก.', 'ระบุพักเย็น 20 กก. และงานดูแลปลาที่เหลือ');
      if (!offer || offer.status === 'draft') return step(3, coord, 'offers.html', 'ส่งข้อเสนอให้ร้าน A', 'เสนอ 30 กก. ในช่วง 09:00–12:00 แล้วกดส่งข้อเสนอ');
      if (!a) return step(3, 'R01', 'offers.html', 'ตอบรับข้อเสนอ 30 กก.');
      if (!a.farmerConfirmed) return step(3, farm, orderPage(a), 'ผู้เลี้ยงยืนยันออเดอร์');
    } else {
      if (!a) return step(3, 'R01', 'order.html?product=P01', 'ร้าน A ขอซื้อ 20 กก.', 'เลือกปลาที่แสดง กรอกน้ำหนัก แล้วกดส่งคำขอ');
      if (!b) return step(3, 'R02', 'order.html?product=P01', 'ร้าน B ขอซื้อ 30 กก.', 'เปลี่ยนปริมาณเป็น 30 กก. แล้วกดส่งคำขอ');
      for (const [o, name] of [[a, 'A'], [b, 'B']]) {
        if (!o.allocatedKg) return step(3, coord, 'allocation.html?order=' + o.id, 'จัดสรรปลาให้ร้าน ' + name, 'เลือกกระชัง C01 แล้วบันทึก');
      }
      for (const [o, name] of [[a, 'A'], [b, 'B']]) {
        if (!o.farmerConfirmed) return step(3, farm, orderPage(o), 'ผู้เลี้ยงยืนยันร้าน ' + name);
        if (!o.buyerConfirmed) return step(3, o.buyerId, orderPage(o), 'ร้าน ' + name + ' ยืนยันออเดอร์');
      }
      if (!plan) return step(3, coord, harvest + query, 'ร่างแผนจับ 50 กก.', 'ร้าน A และ B ยืนยันรวม 50 กก. ใช้พักเย็น 0 กก.');
    }
    if (plan.status === 'draft') {
      const checked = plan.quality === 'passed' && plan.vehicleConfirmed && (!plan.coldKg || plan.coldConfirmed);
      return step(3, coord, harvest + query + (checked ? '' : '#check-plan'), checked ? 'อนุมัติแผนจับ' : 'ตรวจคุณภาพและกำลังรถ',
        checked ? '' : 'เลือก “ผ่านการตรวจคุณภาพ” ใส่ชื่อผู้ตรวจ ยืนยันรถ' + (urgent ? 'และพื้นที่เย็น' : '') + ' แล้วบันทึกผลตรวจ');
    }
    if (plan.status === 'approved') return step(4, farm, harvest + query, 'ชั่งจริง ' + (urgent ? '47' : '50') + ' กก. และสร้างล็อต');
    const viewedLot = S.util.query('id') && s.lots.find(l => l.id === S.util.query('id'));
    const lot = s.lots.find(l => l.planId === plan.id && l.storage === 'dispatch');
    if (lot && !s.deliveries.some(d => d.planId === plan.id) && !viewedLot &&
        !['lots', 'delivery'].includes(document.body.dataset.page))
      return step(4, farm, 'lots.html', 'ตรวจล็อตที่สร้างแล้ว');
    for (const [o, name] of (urgent ? [[a, 'A']] : [[a, 'A'], [b, 'B']])) {
      const round = s.deliveries.find(d => d.orderId === o.id);
      if (!round || round.status === 'scheduled')
        return step(5, coord, delivery, 'สร้างรอบและบันทึกส่งร้าน ' + name);
      if (round.status === 'sent') return step(5, o.buyerId, delivery, 'ร้าน ' + name + ' ยืนยันรับจริง ' + round.kg + ' กก.');
    }
    return step(6, farm, 'finance.html', 'ดูเงินรับสุทธิก่อนต้นทุนเลี้ยง', 'คำนวณจากน้ำหนักที่ร้านรับจริงและค่าใช้จ่ายของแผน');
  }
  function samePage(href) {
    const destination = new URL(href, location.href);
    const current = new URL(location.href);
    current.searchParams.delete('mode');
    return destination.pathname === current.pathname && destination.search === current.search;
  }

  S.guidedDemo = {
    mount(state) {
      const main = document.querySelector('main');
      if (!main || S.cloud.enabled || document.body.dataset.page === 'guide') return;
      let region = document.querySelector('#demo-steps');
      if (!region) {
        region = document.createElement('section');
        region.id = 'demo-steps';
        region.className = 'demo-steps';
        region.setAttribute('aria-label', 'ขั้นถัดไปในเดโม');
        const before = document.querySelector('#role-gate');
        if (before) before.after(region);
        else main.prepend(region);
      }
      const next = steps(state);
      const actor = state.users.find(user => user.id === next.user);
      if (!actor) return;
      const here = state.currentUserId === next.user && samePage(next.href);
      const title = state.scenario === 'urgent' ? 'ติดตามอาการกระชัง C03' : state.scenario === 'missing' ? 'ข้อมูลไม่ครบ C04' : 'ขายปลาให้สองร้าน';
      const count = state.scenario === 'missing' ? 2 : 6;
      const demoDone = next.n === count && here;
      const target = new URL(next.href, location.href);
      const e = S.util.esc;
      region.innerHTML = '<div class="demo-step-copy"><p class="demo-step-caption">' + e(title) +
        ' · ขั้น ' + next.n + ' จาก ' + count + '</p><h2>' + e(demoDone ? 'ดูผลการทดลองด้านล่าง' : next.action) + '</h2>' +
        (next.help ? '<p class="small muted">' + e(next.help) + '</p>' : '') +
        '</div><div class="demo-step-actions">' + (demoDone ? '' : '<button class="btn" id="demo-next">' +
        (state.currentUserId === next.user ? (here ? 'ไปยังปุ่มทำรายการ' : 'ทำขั้นนี้') : 'ทำขั้นนี้ · ' + e(S.config.roleNames[actor.role])) +
        '</button>') + '<button class="btn secondary" id="demo-switch" data-role-open>สลับบทบาท</button>' +
        '<a class="small" href="guide.html">เริ่มเดโมใหม่</a></div>';
      const button = region.querySelector('#demo-next');
      if (!button) return;
      button.onclick = async () => {
        if (here) {
          const focus = document.querySelector(target.hash || '#detail-content') || document.querySelector('h1');
          if (focus?.tagName === 'DETAILS') focus.open = true;
          if (focus) focus.scrollIntoView({ block: 'start' });
          return;
        }
        if (state.currentUserId !== next.user) {
          try { await S.domain.dispatch({ type: 'SET_USER', userId: next.user }); }
          catch (error) { S.ui.toast(error.message, true); return; }
        }
        location.href = next.href;
      };
    }
  };
})(SPARK);
