// Drafts and request IDs stay in this tab. Scope group drafts to the signed-in user.
(function (S) {
  const prefix = 'spark-prototype:draft:';
  const memory = new Map();
  const scope = () => S.cloud.enabled
    ? 'group:' + S.databaseConfig.url + ':' + S.databaseConfig.workspace + ':' + S.ui.user().id
    : 'demo:' + S.config.storageKey + ':' + (S.store.get().demoRunId || 'first');
  const key = (type, id) => prefix + scope() + ':' + type + ':' + id;
  const read = k => {
    if (memory.has(k)) return memory.get(k);
    try { return JSON.parse(sessionStorage.getItem(k) || 'null'); }
    catch (_) { return null; }
  };
  const write = (k, value) => {
    memory.set(k, value);
    try { sessionStorage.setItem(k, JSON.stringify(value)); }
    catch (_) { /* The current page keeps the draft in memory. */ }
  };
  const remove = k => {
    memory.delete(k);
    try { sessionStorage.removeItem(k); } catch (_) { /* Storage may be blocked. */ }
  };
  const selector = form => [...form.attributes]
    .filter(a => a.name === 'id' || a.name.startsWith('data-'))
    .map(a => a.name + '=' + a.value).join('&');
  const formKey = form => key('form', location.pathname + new URLSearchParams([...new URLSearchParams(location.search)].filter(([k]) => k !== 'mode')).toString() + ':' + selector(form));
  function fields(form) {
    return [...form.elements].filter(el => el.name && !el.disabled && !['password', 'file', 'button', 'submit'].includes(el.type));
  }
  function capture(form) {
    write(formKey(form), fields(form).map(el => [el.name, el.type, el.value, el.checked]));
  }
  function restore(form) {
    const values = read(formKey(form));
    if (!values) return;
    for (const el of fields(form)) {
      if (['checkbox', 'radio'].includes(el.type)) {
        const saved = values.find(([name, type, value]) => name === el.name && type === el.type && value === el.value);
        if (saved) el.checked = saved[3];
      } else {
        const saved = values.find(([name, type]) => name === el.name && type === el.type);
        if (saved && (el.tagName !== 'SELECT' || [...el.options].some(option => option.value === saved[2]))) el.value = saved[2];
      }
    }
    if (form.closest('details')) form.closest('details').open = true;
  }
  function requestKey(command) {
    const stringify = value => value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.keys(value).sort().map(k => [k, stringify(value[k])])) : value;
    return key('request', JSON.stringify(stringify(command)));
  }
  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, n => n.toString(16).padStart(2, '0')).join('');
    return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
  }
  S.retry = {
    capture, restore,
    clearForm: form => remove(formKey(form)),
    request(command) {
      const k = requestKey(command);
      const id = read(k) || uuid();
      write(k, id);
      return id;
    },
    finish: command => remove(requestKey(command)),
    clear() {
      const start = S.cloud.enabled ? prefix + scope() + ':' : prefix + 'demo:' + S.config.storageKey + ':';
      for (const k of memory.keys()) if (k.startsWith(start)) memory.delete(k);
      try {
        for (let i = sessionStorage.length - 1; i >= 0; i--) {
          const k = sessionStorage.key(i);
          if (k.startsWith(start)) sessionStorage.removeItem(k);
        }
      } catch (_) { /* No persisted draft to clear. */ }
    }
  };
})(SPARK);
