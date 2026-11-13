// Exercises the extracted HTML and page handlers in a browser, using only fictional data.
const frame = document.querySelector('#app');
const output = document.querySelector('#result');
const report = text => { output.textContent += text + '\n'; };
const app = () => frame.contentWindow;
const doc = () => frame.contentDocument;
const find = selector => doc().querySelector(selector);
const state = () => app().SPARK.store.get();
const assert = (condition, label) => { if (!condition) throw Error(label); };
const contains = (selector, text) => find(selector)?.textContent.includes(text);

async function until(predicate, label) {
  const end = performance.now() + 5500;
  while (performance.now() < end) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw Error(label);
}
const page = name => () => doc().body?.dataset.page === name && doc().readyState === 'complete';
async function go(href) {
  const loaded = new Promise(resolve => frame.addEventListener('load', resolve, { once:true }));
  frame.src = '../' + href;
  await loaded;
  assert(find('h1'), 'ไม่มีหัวข้อ ' + href);
}
async function next(name) {
  const button = find('#demo-next');
  assert(button, 'ไม่มีปุ่มขั้นถัดไป');
  const before = doc();
  button.click();
  await until(() => doc() !== before && page(name)(), 'เปิดขั้น ' + name);
}
function input(selector, value) {
  const field = find(selector);
  assert(field, 'ไม่พบช่อง ' + selector);
  if (field.type === 'checkbox') field.checked = value;
  else field.value = value;
  field.dispatchEvent(new (app().Event)('input', { bubbles:true }));
  field.dispatchEvent(new (app().Event)('change', { bubbles:true }));
}
function click(selector) {
  const button = find(selector);
  assert(button, 'ไม่พบปุ่ม ' + selector);
  button.click();
}
async function reload() {
  const loaded = new Promise(resolve => frame.addEventListener('load', resolve, { once:true }));
  app().location.reload();
  await loaded;
}

async function workflow() {
  await go('index.html');
  const key = 'spark-fish-prototype-v2:' + new URL('../',location.href).pathname;
  assert(localStorage.getItem(key) === null, 'ใช้หน้าต่างไม่ระบุตัวตนหรือโฟลเดอร์ทดสอบใหม่');
  click('[href="dashboard.html?mode=demo"]');
  await until(page('dashboard'), 'เปิดเดโม');
  await next('record-water');
  input('[value="กินอาหารลดลง"]', true);
  input('#note', 'กินอาหารลดลงตอนเช้า');
  const original = app().Storage.prototype.setItem;
  app().Storage.prototype.setItem = function(k, value) {
    if (this === app().localStorage && k === key) throw Error('QuotaExceeded');
    return original.call(this, k, value);
  };
  click('#water-form button[type=submit]');
  await until(() => !find('#water-form .form-error').hidden, 'แสดงข้อผิดพลาดบันทึก');
  assert(find('#note').value==='กินอาหารลดลงตอนเช้า', 'ร่างหายหลังบันทึกล้มเหลว');
  await reload();
  assert(find('#note').value==='กินอาหารลดลงตอนเช้า' && find('[value="กินอาหารลดลง"]').checked, 'ร่างหายหลังโหลดใหม่');
  click('#water-form button[type=submit]');
  await until(page('risk'), 'บันทึกค่าน้ำ');
  assert(contains('#risk-reasons','ยังประเมินออกซิเจนไม่ได้'), 'ไม่แจ้งค่าน้ำที่ขาด');
  assert(contains('#risk-evidence','กินอาหารลดลงตอนเช้า'), 'ไม่แสดงสิ่งที่สังเกตหลังบันทึก');
  const water = state().observations.filter(o=>o.note==='กินอาหารลดลงตอนเช้า');
  assert(water.length===1 && Object.values(water[0].values).every(v=>v===null), 'บันทึกซ้ำหรือค่าน้ำว่างกลายเป็นตัวเลข');
  click('#create-care');
  await until(page('tasks'), 'สร้างงาน');
  click('[data-task] button');
  await until(() => find('[data-task] [name=status]')?.value==='working', 'รับงาน');
  click('[data-task] button');
  await until(() => find('[data-task] [name=status]')?.value==='followup', 'เริ่มงาน');
  report('ผ่าน บันทึกอาการโดยเว้นค่าน้ำ ร่างอยู่หลังบันทึกล้มเหลวและโหลดใหม่ รับงานและเริ่มทำ');

  for (const kg of [20,30]) {
    await next('order');
    click('#order-next');
    input('#kg',kg);
    click('#order-next');
    click('#order-submit');
    await until(page('order-detail'), 'ส่งคำขอซื้อ '+kg+' กก.');
  }
  for (const kg of [20,30]) {
    await next('allocation');
    assert(Number(find('#kg').value)===kg, 'ปริมาณจัดสรร '+kg);
    const current = find('#demo-next');
    click('#allocation-form button:not([type=button])');
    await until(()=>!current.isConnected && state().orders.some(o=>o.allocatedKg===kg), 'จัดสรร '+kg);
  }
  for (let index=0; index<4; index++) {
    await next('order-detail');
    const prev = state().revision;
    click('#confirm-order');
    await until(()=>state().revision>prev && !find('#confirm-order'), 'ยืนยันออเดอร์ '+index);
  }
  await next('harvest');
  click('#plan-form button:not([type=button])');
  await until(()=>find('[data-plan-check]'), 'สร้างร่างแผน');
  click('#demo-next');
  input('[data-plan-check] [name=quality]', 'passed');
  input('[data-plan-check] [name=inspector]', 'ผู้ตรวจทดสอบ');
  input('[data-plan-check] [name=vehicleConfirmed]', true);
  click('[data-plan-check] button');
  await until(()=>contains('#demo-steps','อนุมัติแผนจับ'), 'ตรวจคุณภาพ');
  click('[data-approve]');
  await until(()=>contains('#demo-steps','ชั่งจริง 50'), 'อนุมัติแผน');
  await next('harvest');
  click('[data-harvest] button');
  await until(()=>contains('#harvest-plans','ชั่งจริง 50 กก.'), 'ชั่งจริง');
  await next('lots');
  assert(contains('#lot-list','50 กก.'), 'ล็อตไม่ตรงน้ำหนักจับ');
  for (const kg of [20,30]) {
    await next('delivery');
    click('[data-delivery-create]');
    await until(()=>find('[data-dispatch]'), 'สร้างรอบส่ง');
    click('[data-dispatch]');
    await until(()=>contains('#demo-steps','รับจริง '+kg), 'ส่งปลา '+kg);
    await next('delivery');
    assert(Number(find('[data-receive] [name=acceptedKg]').value)===kg, 'น้ำหนักรับจริง');
    click('[data-receive] button');
    await until(()=>!find('[data-receive]'), 'ยืนยันรับมอบ');
  }
  await next('finance');
  assert(contains('#finance-metrics','รับจริง 50 กก.') && contains('#finance-metrics','17,000 บาท')
    && contains('.net-card','16,000 บาท'), 'ยอดขายหรือเงินสุทธิไม่ตรง');
  await reload();
  assert(contains('.net-card','16,000 บาท') && state().orders.length===2 && state().lots.length===1
    && state().incidents.some(i=>i.status==='open'), 'ข้อมูลหลังโหลดใหม่ไม่ตรง');
  report('ผ่าน ออเดอร์ 20 + 30 กก. → ล็อต 50 กก. → รับจริง 50 กก. → ยอดขาย 17,000 บาท → สุทธิ 16,000 บาทก่อนต้นทุนเลี้ยง');

  sessionStorage.setItem('spark-zip-test-other-key','keep');
  click('#demo-steps a[href="guide.html"]');
  await until(page('guide'), 'เปิดคู่มือ');
  click('#reset-demo');
  click('#confirm-yes');
  await until(page('dashboard'), 'เริ่มเดโมใหม่');
  assert(state().orders.length===0 && sessionStorage.getItem('spark-zip-test-other-key')==='keep','รีเซ็ตไม่ตรงขอบเขต');
  sessionStorage.removeItem('spark-zip-test-other-key');
  report('ผ่าน เริ่มเดโมใหม่ล้างเฉพาะรายการทดลองของเว็บนี้');

  await go('dashboard.html?mode=group');
  await until(()=>contains('#cloud-login-error','ยังไม่ได้เชื่อม Supabase'), 'หน้าเข้ากลุ่มที่ยังไม่ตั้งค่า');
  await go('dashboard.html?mode=demo');
}
async function resources() {
  const pages = ['allocation','cage-detail','cages','dashboard','delivery','finance','guide','harvest','index',
    'lot-detail','lots','marketplace','offers','order-detail','order','orders','record-water','reset-password','risk','tasks'];
  const params = {'cage-detail':'?id=C01','harvest':'?cage=C01','record-water':'?cage=C01','risk':'?cage=C01','order':'?product=P01'};
  const buyerPages = ['order','orders','order-detail','marketplace'];
  for (const width of [360,768,1440]) {
    frame.style.width = width + 'px';
    for (const name of pages) {
      await app().SPARK?.domain?.dispatch({type:'SET_USER',userId:buyerPages.includes(name)?'R01':'CO01'});
      await go(name + '.html' + (params[name]||''));
      const imgs = [...doc().images];
      imgs.forEach(image=>image.loading='eager');
      await Promise.all(imgs.map(image=>image.decode().catch(()=>{throw Error('รูปไม่โหลด '+image.src);})));
      assert(doc().documentElement.scrollWidth <= app().innerWidth + 1, 'หน้าล้น '+name+' '+width+' px');
      assert(find('main') && (['index','reset-password'].includes(name)||find('#app-header').textContent.trim()), 'โหลดสคริปต์ไม่ครบ '+name);
      if (['index','reset-password'].includes(name)) await go('dashboard.html?mode=demo');
    }
  }
  report('ผ่าน เปิดครบ 20 หน้า รูปโหลดได้ และไม่ล้นจอที่ 360, 768 และ 1440 พิกเซล');
}
document.querySelector('#run').onclick = async event => {
  event.target.disabled = true;
  output.textContent = '';
  try { await workflow(); await resources(); report('PASS — ตรวจจากเว็บใน ZIP ครบแล้ว'); }
  catch (error) { report('FAIL — ' + error.message); }
  finally { event.target.disabled = false; }
};
