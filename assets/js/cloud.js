// Supabase Auth + PostgREST. Role and data scope are assigned by the database.
(function (S) {
  'use strict';
  const cfg = S.databaseConfig;
  const requestedMode = S.util.query('mode');
  const modeKey = 'spark-prototype:mode';
  let mode = requestedMode;
  try {
    if (['group', 'demo'].includes(mode)) sessionStorage.setItem(modeKey, mode);
    else mode = sessionStorage.getItem(modeKey);
  } catch (_) { /* Demo can report storage availability on its own. */ }
  const enabled = mode === 'group' && document.body.dataset.page !== 'index';
  const namespace = 'spark-prototype:group:' + cfg.url + ':' + cfg.workspace;
  const authKey = namespace + ':auth';
  let session, state, busy = false, refreshing;
  const message = text => { const box = document.querySelector('#cloud-status'); if (box) box.textContent = text; };

  function configured() {
    return /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(cfg.url) &&
      /^sb_publishable_[A-Za-z0-9_-]+$/.test(cfg.publishableKey) &&
      /^[a-z0-9][a-z0-9-]{0,63}$/.test(cfg.workspace);
  }

  async function request(path, body, token) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 18000);
    try {
      const headers = { apikey: cfg.publishableKey, 'Content-Type': 'application/json' };
      if (token) headers.Authorization = 'Bearer ' + token;
      const response = await fetch(cfg.url.replace(/\/$/, '') + path, {
        method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal, cache: 'no-store'
      });
      const data = response.status === 204 ? null : await response.json().catch(() => null);
      if (response.ok && (response.status === 204 || data !== null)) return data;
      const error = new Error(
        data?.code === '40001' ? 'ข้อมูลกลุ่มเปลี่ยนแล้ว กด “โหลดข้อมูลล่าสุด” แล้วลองบันทึกอีกครั้ง ร่างยังอยู่' :
        data?.code === '42501' || response.status === 403 ? 'บัญชีนี้ไม่มีสิทธิ์ในกลุ่มหรือรายการนี้' :
        path.includes('grant_type=password') ? 'เข้าสู่ระบบไม่สำเร็จ ตรวจอีเมลและรหัสผ่านกับผู้ดูแลกลุ่ม' :
        response.status === 401 ? 'การเข้าสู่ระบบหมดอายุ กรุณาเข้าสู่ระบบใหม่' :
        data?.code === 'P0001' ? data.message : 'เปิดข้อมูลกลุ่มไม่สำเร็จ ตรวจการตั้งค่ากับผู้ดูแลกลุ่ม'
      );
      error.status = response.status;
      throw error;
    } catch (error) {
      if (error.name === 'AbortError' || error instanceof TypeError)
        throw Error('ติดต่อฐานข้อมูลไม่ได้ ร่างยังอยู่ กด “โหลดข้อมูลล่าสุด” ก่อนลองบันทึกอีกครั้ง');
      throw error;
    } finally { clearTimeout(timer); }
  }

  function remember(data) {
    if (!data?.access_token || !data?.refresh_token || !data.user?.id) throw Error('เปิดบัญชีไม่ได้ กรุณาเข้าสู่ระบบใหม่');
    session = { access_token: data.access_token, refresh_token: data.refresh_token, userId: data.user.id,
      expires: data.expires_at || Math.floor(Date.now() / 1000) + data.expires_in };
    sessionStorage.setItem(authKey, JSON.stringify(session));
  }
  async function token(force = false) {
    if (!session) throw Error('กรุณาเข้าสู่ระบบ');
    if (force || session.expires <= Date.now() / 1000 + 45) {
      refreshing ??= request('/auth/v1/token?grant_type=refresh_token', { refresh_token: session.refresh_token })
        .then(remember).finally(() => { refreshing = null; });
      await refreshing;
    }
    return session.access_token;
  }
  async function rpc(name, body = {}) {
    const path = '/rest/v1/rpc/' + name;
    const input = { p_workspace: cfg.workspace, ...body };
    try { return await request(path, input, await token()); }
    catch (error) {
      if (error.status !== 401) throw error;
      return request(path, input, await token(true));
    }
  }

  function authScreen(detail = '') {
    document.body.classList.add('group-login-page');
    document.body.innerHTML = '<main class="cloud-login card"><a href="index.html" class="back-link">← หน้าหลักปลาศาลาหุม</a>' +
      '<h1>เข้ากลุ่มของฉัน</h1><p>ใช้บัญชีที่ผู้ดูแลกลุ่มสร้างให้</p>' +
      '<p id="cloud-login-error" class="notice warning" role="alert" hidden></p>' +
      '<form id="cloud-login-form"><div class="field"><label for="cloud-email">อีเมล</label><input id="cloud-email" name="email" type="email" autocomplete="username" required></div>' +
      '<div class="field"><label for="cloud-password">รหัสผ่าน</label><input id="cloud-password" name="password" type="password" autocomplete="current-password" required></div>' +
      '<button class="btn">เข้าสู่ระบบ</button></form><div class="actions">' +
      '<a id="recover-password" href="reset-password.html">ลืมรหัสผ่าน</a><a href="dashboard.html?mode=demo" class="btn secondary">ลองเดโม</a></div></main>';
    const box = document.querySelector('#cloud-login-error');
    const form = document.querySelector('#cloud-login-form');
    const show = text => { box.textContent = text; box.hidden = false; };
    if (!configured()) {
      form.hidden = true;
      document.querySelector('#recover-password').hidden = true;
      show('ผู้ดูแลยังไม่ได้เชื่อม Supabase สำหรับโหมดกลุ่ม');
      return;
    }
    if (detail) show(detail);
    form.onsubmit = async event => {
      event.preventDefault();
      const button = event.submitter;
      button.disabled = true;
      try {
        const fields = new FormData(form);
        remember(await request('/auth/v1/token?grant_type=password', {
          email: String(fields.get('email')).trim(), password: fields.get('password')
        }));
        location.reload();
      } catch (error) { show(error.message); }
      finally { button.disabled = false; }
    };
  }

  function get() {
    const next = S.util.clone(state);
    next.drafts = {};
    return next;
  }
  function setState(data) {
    if (!data || !data.currentUserId || !Array.isArray(data.users) ||
        !data.users.some(user => user.id === data.currentUserId) || !Number.isSafeInteger(data.revision))
      throw Error('โหลดข้อมูลกลุ่มไม่ได้ ตรวจ migration และสิทธิ์สมาชิกกับผู้ดูแล');
    state = data;
  }
  S.cloud = {
    enabled,
    async init() {
      if (!enabled) return true;
      if (!configured()) { authScreen(); return false; }
      try {
        session = JSON.parse(sessionStorage.getItem(authKey) || 'null');
        if (!session) { authScreen(); return false; }
        setState(await rpc('spark_pilot_read'));
        S.store = { get, issue: () => null };
        S.domain.dispatch = async action => {
          if (busy) throw Error('กำลังบันทึก กรุณารอสักครู่');
          const { actionId, ...command } = action;
          busy = true;
          message('กำลังบันทึกข้อมูลกลุ่ม…');
          try {
            const result = await rpc('spark_pilot_apply', {
              p_revision: state.revision, p_request: actionId, p_action: command
            });
            setState(result.state);
            return { ...get(), lastResultId: result.resultId };
          } catch (error) { message(error.message); throw error; }
          finally { busy = false; }
        };
        return true;
      } catch (error) { authScreen(error.message); return false; }
    },
    mount() {
      if (!enabled) return;
      let bar = document.querySelector('#cloud-bar');
      if (!bar) {
        bar = document.createElement('section');
        bar.id = 'cloud-bar';
        bar.className = 'cloud-bar notice';
        document.querySelector('main')?.prepend(bar);
      }
      bar.innerHTML = '<div><strong>ข้อมูลกลุ่ม</strong><p id="cloud-status" role="status"></p></div>' +
        '<div class="actions"><button class="btn small secondary" id="cloud-refresh">โหลดข้อมูลล่าสุด</button>' +
        '<button class="btn small secondary" id="cloud-logout">ออกจากระบบ</button></div>';
      message(state.groupName + ' · ' + S.config.roleNames[S.util.user(state).role]);
      document.querySelector('#cloud-refresh').onclick = async event => {
        if (busy) return;
        const button = event.currentTarget;
        busy = true;
        button.disabled = true;
        try {
          setState(await rpc('spark_pilot_read'));
          S.ui.render();
          message('โหลดข้อมูลล่าสุดแล้ว · ' + state.groupName);
        } catch (error) { message(error.message); }
        finally { busy = false; button.disabled = false; }
      };
      document.querySelector('#cloud-logout').onclick = async () => {
        if (busy) return;
        busy = true;
        try { await request('/auth/v1/logout?scope=local', {}, session.access_token); }
        catch (_) { /* Local logout still succeeds if offline. */ }
        finally {
          S.retry.clear();
          sessionStorage.removeItem(authKey);
          sessionStorage.removeItem(modeKey);
          location.href = 'index.html';
        }
      };
    }
  };
})(SPARK);
