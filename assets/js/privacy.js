(function () {
  'use strict';

  const version = '2026-11-15';
  const root = new URL('../../', document.currentScript.src);
  const key = 'spark-prototype:privacy-notice:' + root.pathname;
  const url = new URL(location.href);
  const review = url.searchParams.get('privacy') === '1';
  const rootElement = document.documentElement;

  function acknowledged() {
    try { return sessionStorage.getItem(key) === version; }
    catch (_) { return false; }
  }

  function mount(continueToSite) {
    const notice = document.createElement('main');
    notice.id = 'privacy-screen';
    notice.className = 'privacy-screen';
    notice.setAttribute('aria-labelledby', 'privacy-title');
    notice.innerHTML = `
      <header class="privacy-brand">
        <img src="assets/images/fish-mark.svg" width="42" height="42" alt="">
        <strong>ปลาศาลาหุม</strong>
      </header>
      <article class="privacy-card">
        <p class="privacy-kicker">แจ้งการใช้ข้อมูลส่วนบุคคล (PDPA)</p>
        <h1 id="privacy-title" tabindex="-1">ก่อนเข้าใช้ปลาศาลาหุม</h1>
        <div data-privacy-content>
          <section class="privacy-demo" aria-labelledby="privacy-demo-title">
            <h2 id="privacy-demo-title">ลองเดโมด้วยข้อมูลสมมติ</h2>
            <p>ไม่ต้องสมัครบัญชี ข้อมูลที่กรอกเก็บอยู่ในเบราว์เซอร์นี้จนกด “เริ่มเดโมใหม่” หรือล้างข้อมูลเว็บไซต์ โปรดใช้ชื่อและข้อมูลสมมติเท่านั้น</p>
          </section>
          <details id="privacy-group">
            <summary>ข้อมูลในโหมดกลุ่มของฉัน</summary>
            <p>เมื่อเปิดโหมดกลุ่ม ระบบใช้อีเมลเพื่อเข้าสู่ระบบและเก็บข้อมูลการทำงานใน Supabase บัญชีที่เกี่ยวข้องกับรายการจึงเห็นข้อมูลตามหน้าที่</p>
            <dl class="privacy-roles">
              <dt>ผู้เลี้ยง</dt><dd>ข้อมูลกระชัง ค่าน้ำ และงานดูแล เพื่อดูแลปลาและติดตามยอดรับ</dd>
              <dt>ผู้ซื้อ</dt><dd>ข้อมูลออเดอร์และการรับปลา เพื่อจัดสรรและส่งมอบตามที่นัด</dd>
              <dt>ผู้ประสาน</dt><dd>บันทึกการจัดสรร อนุมัติ และจัดรอบส่ง เพื่อติดตามงานกลุ่ม</dd>
            </dl>
            <p>ก่อนใช้ข้อมูลจริง ผู้ดูแลโครงการจะแจ้งรายละเอียดการเก็บข้อมูล ระยะเวลา และช่องทางใช้สิทธิ</p>
          </details>
          <p class="privacy-copy">หากทีมขอบันทึกเสียง ภาพ หรือหน้าจอระหว่างทดสอบ คุณเลือกปฏิเสธได้และยังลองเดโมได้</p>
          <p class="privacy-status" id="privacy-error" role="alert" hidden></p>
          <div class="privacy-actions">
            <button type="button" class="btn" id="privacy-accept">รับทราบและไปต่อ</button>
            <button type="button" class="btn secondary" id="privacy-decline">ยังไม่เข้าใช้งาน</button>
          </div>
          <footer class="privacy-foot">
            <p>เว็บจำการรับทราบเฉพาะในแท็บนี้</p>
            <a href="https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages#data-collection" target="_blank" rel="noopener noreferrer">เมื่อเข้าผ่าน GitHub Pages ผู้ให้บริการบันทึก IP เพื่อความปลอดภัย</a>
          </footer>
        </div>
        <section class="privacy-exit" id="privacy-exit" hidden>
          <h2 tabindex="-1">ยังไม่ได้เข้าใช้งาน</h2>
          <p>ปิดหน้านี้ได้เลย หรือกลับไปอ่านเมื่อพร้อม</p>
          <button type="button" class="btn secondary" id="privacy-read-again">กลับไปอ่าน</button>
        </section>
      </article>`;
    document.body.prepend(notice);

    const group = notice.querySelector('#privacy-group');
    try {
      group.open = (url.searchParams.get('mode') || sessionStorage.getItem('spark-prototype:mode')) === 'group';
    } catch (_) { group.open = url.searchParams.get('mode') === 'group'; }
    if (url.pathname.endsWith('/reset-password.html')) group.open = true;
    const contents = notice.querySelector('[data-privacy-content]');
    const exit = notice.querySelector('#privacy-exit');
    const error = notice.querySelector('#privacy-error');
    const title = notice.querySelector('#privacy-title');
    const setExited = stopped => {
      contents.hidden = stopped;
      exit.hidden = !stopped;
      (stopped ? exit.querySelector('h2') : title).focus();
    };
    notice.querySelector('#privacy-decline').onclick = () => {
      try { sessionStorage.removeItem(key); }
      catch (_) { /* No acknowledgement can be read when storage is unavailable. */ }
      setExited(true);
    };
    notice.querySelector('#privacy-read-again').onclick = () => setExited(false);
    notice.querySelector('#privacy-accept').onclick = () => {
      try {
        sessionStorage.setItem(key, version);
        if (!acknowledged()) throw Error('Unavailable storage');
      } catch (_) {
        error.textContent = 'เว็บจำการรับทราบไม่ได้ กรุณาเปิดให้เบราว์เซอร์เก็บข้อมูลเว็บไซต์ แล้วลองใหม่';
        error.hidden = false;
        return;
      }
      if (review) {
        url.searchParams.delete('privacy');
        url.hash = location.hash;
        history.replaceState(history.state, '', url);
      }
      notice.remove();
      rootElement.classList.remove('privacy-pending');
      continueToSite();
      requestAnimationFrame(() => {
        const heading = document.querySelector('main h1');
        if (heading) {
          heading.setAttribute('tabindex', '-1');
          heading.focus();
        }
      });
    };
  }

  const ready = new Promise(resolve => {
    if (!review && acknowledged()) {
      rootElement.classList.remove('privacy-pending');
      resolve();
    } else {
      document.addEventListener('DOMContentLoaded', () => mount(resolve), { once:true });
    }
  });
  function reviewHref() {
    const current = new URL(location.href);
    current.searchParams.set('privacy', '1');
    return current.search + current.hash;
  }

  window.SparkPrivacy = { ready, reviewHref };

  window.addEventListener('pageshow', event => {
    if (event.persisted && !acknowledged() && !rootElement.classList.contains('privacy-pending')) {
      location.reload();
    }
  });
})();
