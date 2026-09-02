// SFEXPRESS DATABASE — Cloudflare Pages Function (API layer)
// Route: /api/*  — bind D1 database as "DB" in Pages project settings (Functions > D1 database bindings)
//
// Thay thế toàn bộ Firebase Firestore (v4) bằng Cloudflare D1 + Pages Functions (v5).
// Vì D1 không có realtime listener (onSnapshot), client (index.html) sẽ polling định kỳ các endpoint GET dưới đây.

const DEFAULT_WAREHOUSES = [
  { code: 'SGN01S', name: 'Kho SGN01S' },
  { code: 'SGN02S', name: 'Kho SGN02S' },
  { code: 'SGN03S', name: 'Kho SGN03S' },
  { code: 'SGN04S', name: 'Kho SGN04S' }
];
const DEFAULT_REPORT_CATEGORIES = {
  PU: [
    { id: 'pu_sl_xuat', name: 'BC Sản lượng hàng xuất (PU)', columns: ['STT', 'Ngày (dd-mmm-yy)', 'Mã vận đơn (SFxx)', 'ID NV PU', 'Giờ nhập', 'CP Detain'] },
    { id: 'pu_ton', name: 'BC Xuất tồn (PU)', columns: ['STT', 'Mã SP', 'Tên SP', 'Số lượng', 'Đơn vị', 'Ghi chú'] },
    { id: 'pu_ns', name: 'BC Nhân sự khai thác kho (PU)', columns: ['STT', 'Mã NV', 'Tên NV', 'Ca làm', 'Số giờ', 'Ghi chú'] }
  ],
  DE: [
    { id: 'de_sl_nhap', name: 'BC Sản lượng hàng nhập (DE)', columns: ['STT', 'Ngày (dd-mmm-yy)', 'Mã vận đơn (SFxx)', 'ID NV nhập', 'Giờ nhập', 'CP Detain'] },
    { id: 'de_ton', name: 'BC Nhập tồn (DE)', columns: ['STT', 'Mã SP', 'Tên SP', 'Số lượng', 'Đơn vị', 'Ghi chú'] }
  ],
  TC: [
    { id: 'tc_lich_trinh', name: 'BC Lịch trình xe trung chuyển', columns: ['STT', 'Biển số', 'Tuyến', 'Giờ xuất', 'Giờ nhập', 'Ghi chú'] }
  ]
};
const DEFAULT_EMPLOYEES = [
  { empId: 'WA001', name: 'Nguyễn Văn An', role: 'WA', warehouse: 'SGN01S', password: '12345', status: 'active', startDate: '2024-01-15', leaveDate: '', zone: '' },
  { empId: 'SSM001', name: 'Trần Thị Bình', role: 'SSM', warehouse: 'SGN01S', password: '12345', status: 'active', startDate: '2023-06-01', leaveDate: '', zone: '' },
  { empId: 'WA002', name: 'Lê Thị Sang', role: 'WA', warehouse: 'SGN02S', password: '12345', status: 'active', startDate: '2024-03-10', leaveDate: '', zone: '' },
  { empId: 'SSM002', name: 'Phạm Văn Bảo', role: 'SSM', warehouse: 'SGN03S', password: '12345', status: 'active', startDate: '2022-09-01', leaveDate: '', zone: '' },
  { empId: 'VAN001', name: 'Lê Văn Cường', role: 'VAN', warehouse: 'SGN02S', password: '', status: 'active', startDate: '2022-03-10', leaveDate: '', zone: 'Quận 1, Quận 3' },
  { empId: 'BA001', name: 'Phạm Thị Duyên', role: 'BA', warehouse: 'SGN03S', password: '', status: 'active', startDate: '2021-11-20', leaveDate: '', zone: 'Bình Thạnh, Thủ Đức' }
];
const DEFAULT_SGNSS = { username: 'SGNSS', password: '67890' };
const DEFAULT_CONFIG = { maxAdjustMinutes: 60, penalty: 15, approval: 'Tự động chấp nhận trong thời hạn', deadlines: {}, grace: {} };

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}
function badRequest(msg) { return json({ error: msg }, 400); }
function notFound(msg = 'Not found') { return json({ error: msg }, 404); }
function serverError(e) { return json({ error: (e && e.message) || String(e) }, 500); }
function newId() {
  return (crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2)));
}

async function ensureSchema(db) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS employees (
      empId TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL, warehouse TEXT,
      password TEXT DEFAULT '', status TEXT DEFAULT 'active', startDate TEXT,
      leaveDate TEXT DEFAULT '', zone TEXT DEFAULT ''
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS records (
      id TEXT PRIMARY KEY, date TEXT NOT NULL, warehouse TEXT NOT NULL, category TEXT NOT NULL,
      reportType TEXT NOT NULL, empId TEXT NOT NULL, empName TEXT NOT NULL,
      values_json TEXT NOT NULL, status TEXT DEFAULT 'Đã nộp', submittedAt TEXT NOT NULL,
      adjustments_json TEXT DEFAULT '[]', edits_json TEXT DEFAULT '[]'
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_records_wh ON records(warehouse)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_records_wh_rt ON records(warehouse, reportType)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_records_submittedAt ON records(submittedAt)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS staff_log (
      id TEXT PRIMARY KEY, ssm INTEGER DEFAULT 0, wa INTEGER DEFAULT 0, van INTEGER DEFAULT 0,
      ba INTEGER DEFAULT 0, leave TEXT DEFAULT '', anomaly TEXT DEFAULT ''
    )`)
  ]);
}

async function ensureSeed(db) {
  const wh = await db.prepare('SELECT value FROM meta WHERE key = ?').bind('warehouses').first();
  if (!wh) {
    await db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').bind('warehouses', JSON.stringify({ list: DEFAULT_WAREHOUSES })).run();
  }
  const rc = await db.prepare('SELECT value FROM meta WHERE key = ?').bind('reportCategories').first();
  if (!rc) {
    await db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').bind('reportCategories', JSON.stringify(DEFAULT_REPORT_CATEGORIES)).run();
  }
  const cfg = await db.prepare('SELECT value FROM meta WHERE key = ?').bind('config').first();
  if (!cfg) {
    await db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').bind('config', JSON.stringify(DEFAULT_CONFIG)).run();
  }
  const sg = await db.prepare('SELECT value FROM meta WHERE key = ?').bind('sgnss').first();
  if (!sg) {
    await db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').bind('sgnss', JSON.stringify(DEFAULT_SGNSS)).run();
  }
  const empCount = await db.prepare('SELECT COUNT(*) AS c FROM employees').first();
  if (!empCount || empCount.c === 0) {
    const stmts = DEFAULT_EMPLOYEES.map(e => db.prepare(
      `INSERT INTO employees (empId,name,role,warehouse,password,status,startDate,leaveDate,zone) VALUES (?,?,?,?,?,?,?,?,?)`
    ).bind(e.empId, e.name, e.role, e.warehouse, e.password, e.status, e.startDate, e.leaveDate, e.zone));
    await db.batch(stmts);
  }
}

async function getMetaValue(db, key, fallback) {
  const row = await db.prepare('SELECT value FROM meta WHERE key = ?').bind(key).first();
  if (!row) return fallback;
  try { return JSON.parse(row.value); } catch (e) { return fallback; }
}
async function setMetaValue(db, key, value) {
  await db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(key, JSON.stringify(value)).run();
}

function rowToRecord(row) {
  return {
    id: row.id,
    date: row.date,
    warehouse: row.warehouse,
    category: row.category,
    reportType: row.reportType,
    empId: row.empId,
    empName: row.empName,
    values: JSON.parse(row.values_json || '[]'),
    status: row.status,
    submittedAt: row.submittedAt,
    adjustments: JSON.parse(row.adjustments_json || '[]'),
    edits: JSON.parse(row.edits_json || '[]')
  };
}

export async function onRequest(context) {
  const { request, env } = context;
  const db = env.DB;
  if (!db) return serverError(new Error('Thiếu D1 binding "DB" — vào Cloudflare Pages > Settings > Functions > D1 database bindings để gán.'));

  const url = new URL(request.url);
  const parts = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
  const method = request.method;

  try {
    await ensureSchema(db);
    await ensureSeed(db);

    // ---------- GET /api/meta ----------
    if (parts.length === 1 && parts[0] === 'meta' && method === 'GET') {
      const [warehousesMeta, reportCategories, config, sgnss, employeesResult] = await Promise.all([
        getMetaValue(db, 'warehouses', { list: DEFAULT_WAREHOUSES }),
        getMetaValue(db, 'reportCategories', DEFAULT_REPORT_CATEGORIES),
        getMetaValue(db, 'config', DEFAULT_CONFIG),
        getMetaValue(db, 'sgnss', DEFAULT_SGNSS),
        db.prepare('SELECT * FROM employees').all()
      ]);
      return json({
        warehouses: warehousesMeta.list || [],
        reportCategories,
        config,
        sgnss,
        employees: employeesResult.results || []
      });
    }

    // ---------- PUT /api/meta/warehouses ----------
    if (parts.length === 2 && parts[0] === 'meta' && parts[1] === 'warehouses' && method === 'PUT') {
      const body = await request.json();
      if (!body || !Array.isArray(body.list) || !body.list.length) return badRequest('Danh sách kho không hợp lệ');
      await setMetaValue(db, 'warehouses', { list: body.list });
      return json({ ok: true });
    }

    // ---------- PUT /api/meta/reportCategories ----------
    if (parts.length === 2 && parts[0] === 'meta' && parts[1] === 'reportCategories' && method === 'PUT') {
      const body = await request.json();
      if (!body || !body.PU || !body.DE || !body.TC) return badRequest('Cấu hình báo cáo không hợp lệ');
      await setMetaValue(db, 'reportCategories', { PU: body.PU, DE: body.DE, TC: body.TC });
      return json({ ok: true });
    }

    // ---------- PUT /api/meta/config?mode=replace ----------
    if (parts.length === 2 && parts[0] === 'meta' && parts[1] === 'config' && method === 'PUT') {
      const body = await request.json();
      const mode = url.searchParams.get('mode');
      if (mode === 'replace') {
        await setMetaValue(db, 'config', body);
      } else {
        const current = await getMetaValue(db, 'config', DEFAULT_CONFIG);
        await setMetaValue(db, 'config', { ...current, ...body });
      }
      return json({ ok: true });
    }

    // ---------- PUT /api/meta/sgnss ----------
    if (parts.length === 2 && parts[0] === 'meta' && parts[1] === 'sgnss' && method === 'PUT') {
      const body = await request.json();
      if (!body || !body.password) return badRequest('Thiếu mật khẩu SGNSS');
      await setMetaValue(db, 'sgnss', { username: body.username || 'SGNSS', password: body.password });
      return json({ ok: true });
    }

    // ---------- GET /api/employees ----------
    if (parts.length === 1 && parts[0] === 'employees' && method === 'GET') {
      const result = await db.prepare('SELECT * FROM employees').all();
      return json({ employees: result.results || [] });
    }

    // ---------- POST /api/employees ----------
    if (parts.length === 1 && parts[0] === 'employees' && method === 'POST') {
      const e = await request.json();
      if (!e || !e.empId || !e.name || !e.role) return badRequest('Thiếu thông tin nhân sự bắt buộc');
      const existing = await db.prepare('SELECT empId FROM employees WHERE empId = ?').bind(e.empId).first();
      if (existing) return json({ error: 'Mã NV đã tồn tại' }, 409);
      await db.prepare(
        `INSERT INTO employees (empId,name,role,warehouse,password,status,startDate,leaveDate,zone) VALUES (?,?,?,?,?,?,?,?,?)`
      ).bind(e.empId, e.name, e.role, e.warehouse || '', e.password || '', e.status || 'active', e.startDate || '', e.leaveDate || '', e.zone || '').run();
      return json({ ok: true });
    }

    // ---------- PUT /api/employees/:id ----------
    if (parts.length === 2 && parts[0] === 'employees' && method === 'PUT') {
      const empId = decodeURIComponent(parts[1]);
      const body = await request.json();
      const current = await db.prepare('SELECT * FROM employees WHERE empId = ?').bind(empId).first();
      if (!current) return notFound('Không tìm thấy nhân sự');
      const merged = { ...current, ...body };
      await db.prepare(
        `UPDATE employees SET name=?, role=?, warehouse=?, password=?, status=?, startDate=?, leaveDate=?, zone=? WHERE empId=?`
      ).bind(merged.name, merged.role, merged.warehouse, merged.password, merged.status, merged.startDate, merged.leaveDate, merged.zone, empId).run();
      return json({ ok: true });
    }

    // ---------- DELETE /api/employees/:id ----------
    if (parts.length === 2 && parts[0] === 'employees' && method === 'DELETE') {
      const empId = decodeURIComponent(parts[1]);
      await db.prepare('DELETE FROM employees WHERE empId = ?').bind(empId).run();
      return json({ ok: true });
    }

    // ---------- GET /api/staffLog/:id ----------
    if (parts.length === 2 && parts[0] === 'staffLog' && method === 'GET') {
      const id = decodeURIComponent(parts[1]);
      const row = await db.prepare('SELECT * FROM staff_log WHERE id = ?').bind(id).first();
      if (!row) return json({ ssm: 0, wa: 0, van: 0, ba: 0, leave: '', anomaly: 'Không có bất thường' });
      return json(row);
    }

    // ---------- PUT /api/staffLog/:id ----------
    if (parts.length === 2 && parts[0] === 'staffLog' && method === 'PUT') {
      const id = decodeURIComponent(parts[1]);
      const b = await request.json();
      await db.prepare(
        `INSERT INTO staff_log (id, ssm, wa, van, ba, leave, anomaly) VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET ssm=excluded.ssm, wa=excluded.wa, van=excluded.van, ba=excluded.ba, leave=excluded.leave, anomaly=excluded.anomaly`
      ).bind(id, b.ssm || 0, b.wa || 0, b.van || 0, b.ba || 0, b.leave || '', b.anomaly || '').run();
      return json({ ok: true });
    }

    // ---------- GET /api/records ----------
    if (parts.length === 1 && parts[0] === 'records' && method === 'GET') {
      const warehouse = url.searchParams.get('warehouse');
      const reportType = url.searchParams.get('reportType');
      const before = url.searchParams.get('before');
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10) || 100, 1000);
      let sql = 'SELECT * FROM records WHERE 1=1';
      const params = [];
      if (warehouse && warehouse !== 'ALL') { sql += ' AND warehouse = ?'; params.push(warehouse); }
      if (reportType && reportType !== 'ALL') { sql += ' AND reportType = ?'; params.push(reportType); }
      if (before) { sql += ' AND submittedAt < ?'; params.push(before); }
      sql += ' ORDER BY submittedAt DESC LIMIT ?';
      params.push(limit + 1); // fetch 1 extra to know if hasMore
      const stmt = db.prepare(sql).bind(...params);
      const result = await stmt.all();
      const rows = (result.results || []).map(rowToRecord);
      const hasMore = rows.length > limit;
      if (hasMore) rows.length = limit;
      return json({ rows, hasMore });
    }

    // ---------- POST /api/records/batch ----------
    if (parts.length === 2 && parts[0] === 'records' && parts[1] === 'batch' && method === 'POST') {
      const b = await request.json();
      if (!b || !b.warehouse || !b.reportType || !Array.isArray(b.rows) || !b.rows.length) return badRequest('Dữ liệu nộp báo cáo không hợp lệ');
      const submittedAt = new Date().toISOString();
      const stmts = b.rows.map(values => db.prepare(
        `INSERT INTO records (id,date,warehouse,category,reportType,empId,empName,values_json,status,submittedAt,adjustments_json,edits_json)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(newId(), b.date, b.warehouse, b.category, b.reportType, b.empId, b.empName, JSON.stringify(values), 'Đã nộp', submittedAt, '[]', '[]'));
      await db.batch(stmts);
      return json({ ok: true, inserted: stmts.length });
    }

    // ---------- POST /api/records/:id/resubmit ----------
    if (parts.length === 3 && parts[0] === 'records' && parts[2] === 'resubmit' && method === 'POST') {
      const id = decodeURIComponent(parts[1]);
      const b = await request.json();
      const row = await db.prepare('SELECT adjustments_json FROM records WHERE id = ?').bind(id).first();
      if (!row) return notFound('Không tìm thấy bản ghi');
      const adjustments = JSON.parse(row.adjustments_json || '[]');
      adjustments.push({ reason: b.reason, requestedAt: new Date().toISOString(), elapsed: b.elapsed, within: b.within });
      await db.prepare('UPDATE records SET adjustments_json = ? WHERE id = ?').bind(JSON.stringify(adjustments), id).run();
      return json({ ok: true });
    }

    // ---------- PUT /api/records/:id ----------
    if (parts.length === 2 && parts[0] === 'records' && method === 'PUT') {
      const id = decodeURIComponent(parts[1]);
      const b = await request.json();
      const row = await db.prepare('SELECT edits_json FROM records WHERE id = ?').bind(id).first();
      if (!row) return notFound('Không tìm thấy bản ghi');
      const edits = JSON.parse(row.edits_json || '[]');
      edits.push({ user: b.user, timestamp: new Date().toISOString(), reason: b.reason, oldValues: b.oldValues || [] });
      await db.prepare('UPDATE records SET values_json = ?, edits_json = ? WHERE id = ?')
        .bind(JSON.stringify(b.values || []), JSON.stringify(edits), id).run();
      return json({ ok: true });
    }

    return notFound('Route không tồn tại: ' + method + ' /' + parts.join('/'));
  } catch (e) {
    return serverError(e);
  }
}
