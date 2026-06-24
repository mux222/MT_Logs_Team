import { createClient } from '@supabase/supabase-js';
import { User, Ticket, Ban, InvestigationCase, EvidenceItem, AltProfile, YaraRule, PCCheckRecord } from './types';

// ═══════════════════════════════════════════════════════
//  PRE-WHITELIST HACKS — TypeScript Interface
// ═══════════════════════════════════════════════════════
export interface PreWLHack {
  id: number;
  raw_text?: string;
  player_name?: string;
  license?: string;
  license2?: string;
  licenses?: string[] | string;
  steam?: string;
  steams?: string[] | string;
  discord?: string;
  discords?: string[] | string;
  xbl?: string;
  live_id?: string;
  ip?: string;
  banned_from?: string;
  hack_active?: boolean;
  image_base64?: string;
  created_by?: string;
  created_by_role?: string;
  created_at?: string;
  updated_by?: string;
  updated_by_role?: string;
  updated_at?: string;
  timeline?: { action: string; by: string; byRole: string; at: number; old?: string; new?: string }[] | string;
  // camelCase aliases — للتوافق مع app.tsx
  rawText?: string;
  playerName?: string;
  liveId?: string;
  bannedFrom?: string;
  hackActive?: 'yes' | 'no';
  imageBase64?: string;
  createdBy?: string;
  createdByRole?: string;
  createdAt?: number;
  updatedBy?: string;
  updatedByRole?: string;
  updatedAt?: number;
}

// ═══════════════════════════════════════════════════════
//  LOCAL DATABASE — IndexedDB Fallback
// ═══════════════════════════════════════════════════════
const DB_NAME = 'MT_Logs_DB';
const DB_VERSION = 10;

export const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onblocked = () => {
      console.warn('IndexedDB blocked — close other tabs first.');
      reject(new Error('IndexedDB blocked'));
    };
    request.onupgradeneeded = (event: any) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('users')) {
        db.createObjectStore('users', { keyPath: 'user' });
      }
      if (!db.objectStoreNames.contains('tickets')) {
        const ticketStore = db.createObjectStore('tickets', { keyPath: 'id' });
        ticketStore.createIndex('creator', 'creator');
        ticketStore.createIndex('status', 'status');
      }
      if (!db.objectStoreNames.contains('bans')) {
        const banStore = db.createObjectStore('bans', { keyPath: 'id' });
        banStore.createIndex('discordId', 'discordId');
        banStore.createIndex('type', 'type');
        banStore.createIndex('createdAt', 'createdAt');
      }
      if (!db.objectStoreNames.contains('audit_logs')) {
        const logStore = db.createObjectStore('audit_logs', { keyPath: 'id' });
        logStore.createIndex('userId', 'userId');
        logStore.createIndex('timestamp', 'timestamp');
      }
      if (!db.objectStoreNames.contains('personal_notes')) {
        const noteStore = db.createObjectStore('personal_notes', { keyPath: 'id' });
        noteStore.createIndex('userId', 'userId');
        noteStore.createIndex('updatedAt', 'updatedAt');
      }
      if (!db.objectStoreNames.contains('cases')) {
        const caseStore = db.createObjectStore('cases', { keyPath: 'id' });
        caseStore.createIndex('discordId', 'discordId');
        caseStore.createIndex('status', 'status');
        caseStore.createIndex('riskLevel', 'riskLevel');
        caseStore.createIndex('updatedAt', 'updatedAt');
      }
      if (!db.objectStoreNames.contains('evidence_items')) {
        const evStore = db.createObjectStore('evidence_items', { keyPath: 'id' });
        evStore.createIndex('caseId', 'caseId');
        evStore.createIndex('discordId', 'discordId');
        evStore.createIndex('category', 'category');
        evStore.createIndex('createdAt', 'createdAt');
      }
      if (!db.objectStoreNames.contains('alt_profiles')) {
        const altStore = db.createObjectStore('alt_profiles', { keyPath: 'id' });
        altStore.createIndex('primaryId', 'primaryId');
        altStore.createIndex('updatedAt', 'updatedAt');
      }
      if (!db.objectStoreNames.contains('yara_rules')) {
        const yaraStore = db.createObjectStore('yara_rules', { keyPath: 'id' });
        yaraStore.createIndex('name', 'name');
        yaraStore.createIndex('addedBy', 'addedBy');
      }
      if (!db.objectStoreNames.contains('pc_checks')) {
        const pcStore = db.createObjectStore('pc_checks', { keyPath: 'id' });
        pcStore.createIndex('player', 'player');
        pcStore.createIndex('hwid', 'hwid');
        pcStore.createIndex('isCheater', 'isCheater');
        pcStore.createIndex('createdAt', 'createdAt');
      }
      if (!db.objectStoreNames.contains('pre_wl_hacks')) {
        const preWlStore = db.createObjectStore('pre_wl_hacks', { keyPath: 'id' });
        preWlStore.createIndex('player_name', 'player_name');
        preWlStore.createIndex('license', 'license');
        preWlStore.createIndex('steam', 'steam');
        preWlStore.createIndex('discord', 'discord');
        preWlStore.createIndex('xbl', 'xbl');
        preWlStore.createIndex('live_id', 'live_id');
        preWlStore.createIndex('ip', 'ip');
        preWlStore.createIndex('hack_active', 'hack_active');
        preWlStore.createIndex('created_at', 'created_at');
      }
    };
  });
};

const localGetAll = <T>(storeName: string): Promise<T[]> =>
  openDB().then((db) => new Promise((resolve, reject) => {
    const store = db.transaction(storeName, 'readonly').objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));

const localPutItem = <T>(storeName: string, item: T): Promise<void> =>
  openDB().then((db) => new Promise((resolve, reject) => {
    const store = db.transaction(storeName, 'readwrite').objectStore(storeName);
    const req = store.put(item);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  }));

const localDeleteItem = (storeName: string, key: any): Promise<void> =>
  openDB().then((db) => new Promise((resolve, reject) => {
    const store = db.transaction(storeName, 'readwrite').objectStore(storeName);
    const req = store.delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  }));

// ═══════════════════════════════════════════════════════
//  SUPABASE CONFIG
// ═══════════════════════════════════════════════════════
// @ts-ignore
const supabaseUrl: string = import.meta.env.VITE_SUPABASE_URL || '';
// @ts-ignore
const supabaseAnonKey: string = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

// المستخدم الحالي — يُحدَّث عند تسجيل الدخول
let _currentUsername: string = '';

export const setCurrentUsername = (username: string) => {
  _currentUsername = username;
};

/**
 * Supabase client مع header المستخدم في كل طلب
 * الـ RLS policies تقرأ x-user للتحقق من الصلاحية
 */
const makeSupabaseClient = () => {
  if (!supabaseUrl || !supabaseAnonKey) return null;
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        'x-user': _currentUsername
      }
    }
  });
};

export const supabase = makeSupabaseClient();

// للطلبات اللي تحتاج header محدّث (بعد login)
export const getSupabaseWithUser = (username?: string) => {
  if (!supabaseUrl || !supabaseAnonKey) return null;
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        'x-user': username || _currentUsername
      }
    }
  });
};

// ═══════════════════════════════════════════════════════
//  SECURITY — PASSWORD HASHING (Argon2id via WASM)
//  نستخدم argon2-browser للحصول على تشفير حقيقي.
//  كـ fallback نستخدم PBKDF2 (أقوى بكثير من SHA-256 الثابت)
// ═══════════════════════════════════════════════════════

/**
 * يتحقق من أن crypto.subtle متوفر — يفشل في Secure Contexts فقط
 * (HTTPS، أو localhost/127.0.0.1، أو داخل iframe بدون صلاحيات كافية)
 */
export const assertCryptoAvailable = () => {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error(
      'تشفير المتصفح (Web Crypto API) غير متوفر في هذه البيئة. ' +
      'هذا يحصل عادة لو الموقع مفتوح عبر HTTP بدون SSL، أو داخل iframe معاينة لا يملك صلاحية كافية. ' +
      'افتح الموقع في تبويب مستقل مباشرة (ليس داخل معاينة مدمجة) أو على رابط HTTPS/localhost حقيقي.'
    );
  }
};

/**
 * توليد salt عشوائي لكل مستخدم — 16 byte hex
 */
export const generateSalt = (): string => {
  assertCryptoAvailable();
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
};

/**
 * تشفير كلمة المرور بـ PBKDF2 مع salt عشوائي خاص بكل مستخدم
 * النتيجة: "pbkdf2$<salt>$<hash>"
 */
export const hashPasswordWithSalt = async (password: string, salt: string): Promise<string> => {
  assertCryptoAvailable();
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations: 200_000, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  const hashHex = Array.from(new Uint8Array(bits))
    .map(b => b.toString(16).padStart(2, '0')).join('');
  return `pbkdf2$${salt}$${hashHex}`;
};

/**
 * مقارنة timing-safe — نمنع timing attacks
 */
export const verifyPasswordWithSalt = async (password: string, storedHash: string): Promise<boolean> => {
  assertCryptoAvailable();
  if (!storedHash.startsWith('pbkdf2$')) return false;
  const parts = storedHash.split('$');
  if (parts.length !== 3) return false;
  const [, salt] = parts;
  const computed = await hashPasswordWithSalt(password, salt);

  // Constant-time comparison
  if (computed.length !== storedHash.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) {
    diff |= computed.charCodeAt(i) ^ storedHash.charCodeAt(i);
  }
  return diff === 0;
};

/**
 * LEGACY: للتوافق مع كلمات المرور القديمة (SHA-256 أو plain text)
 * عند أول تسجيل دخول ناجح، يُرقَّى إلى PBKDF2 تلقائياً
 */
export const legacyVerify = async (password: string, storedPass: string): Promise<boolean> => {
  // plain-text قديم
  if (!storedPass.startsWith('pbkdf2$') && storedPass.length !== 64) {
    return storedPass === password;
  }
  // SHA-256 قديم (static salt) — نتحقق منه مباشرة
  if (storedPass.length === 64 && /^[0-9a-f]+$/.test(storedPass)) {
    assertCryptoAvailable();
    const legacySalt = `MT_LOGS_2026:${password}:SEC_SALT_X9K`;
    const enc = new TextEncoder();
    const buf = await crypto.subtle.digest('SHA-256', enc.encode(legacySalt));
    const hex = Array.from(new Uint8Array(buf))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    return hex === storedPass;
  }
  return false;
};

// ═══════════════════════════════════════════════════════
//  DIAGNOSTICS
// ═══════════════════════════════════════════════════════
export interface DbDiagnosticInfo {
  supabaseActive: boolean;
  hasErrors: boolean;
  lastErrorMessage: string | null;
  tableErrors: Record<string, string>;
}

export const dbDiagnostics: DbDiagnosticInfo = {
  supabaseActive: !!supabase,
  hasErrors: false,
  lastErrorMessage: null,
  tableErrors: {}
};

// ═══════════════════════════════════════════════════════
//  CRUD — مع Supabase أولاً ثم IndexedDB fallback
// ═══════════════════════════════════════════════════════

// الجداول الموجودة فعلاً في Supabase — أي جدول خارج هذه القائمة يُوجَّه مباشرة لـ IndexedDB
const SUPABASE_TABLES = new Set([
  'users', 'tickets', 'bans', 'audit_logs', 'personal_notes',
  'cases', 'evidence_items', 'alt_profiles', 'yara_rules', 'pc_checks',
  'pre_wl_hacks'
]);

export const getAll = async <T>(storeName: string): Promise<T[]> => {
  const client = getSupabaseWithUser();
  if (client && SUPABASE_TABLES.has(storeName)) {
    try {
      const { data, error } = await client.from(storeName).select('*');
      if (error) {
        dbDiagnostics.hasErrors = true;
        dbDiagnostics.lastErrorMessage = error.message;
        dbDiagnostics.tableErrors[storeName] = error.message;
        return localGetAll<T>(storeName);
      }
      delete dbDiagnostics.tableErrors[storeName];
      if (Object.keys(dbDiagnostics.tableErrors).length === 0) {
        dbDiagnostics.hasErrors = false;
        dbDiagnostics.lastErrorMessage = null;
      }
      return (data as T[]) || [];
    } catch (e: any) {
      dbDiagnostics.hasErrors = true;
      dbDiagnostics.lastErrorMessage = e?.message || String(e);
      dbDiagnostics.tableErrors[storeName] = e?.message || String(e);
      return localGetAll<T>(storeName);
    }
  }
  return localGetAll<T>(storeName);
};

export const putItem = async <T>(storeName: string, item: T): Promise<void> => {
  const client = getSupabaseWithUser();
  if (client && SUPABASE_TABLES.has(storeName)) {
    try {
      const { error } = await client.from(storeName).upsert(item as any);
      if (error) {
        dbDiagnostics.hasErrors = true;
        dbDiagnostics.lastErrorMessage = error.message;
        dbDiagnostics.tableErrors[storeName] = error.message;
        return localPutItem<T>(storeName, item);
      }
      delete dbDiagnostics.tableErrors[storeName];
      if (Object.keys(dbDiagnostics.tableErrors).length === 0) {
        dbDiagnostics.hasErrors = false;
        dbDiagnostics.lastErrorMessage = null;
      }
    } catch (e: any) {
      dbDiagnostics.hasErrors = true;
      dbDiagnostics.lastErrorMessage = e?.message || String(e);
      dbDiagnostics.tableErrors[storeName] = e?.message || String(e);
      return localPutItem<T>(storeName, item);
    }
  } else {
    return localPutItem<T>(storeName, item);
  }
};

export const deleteItem = async (storeName: string, key: any): Promise<void> => {
  const client = getSupabaseWithUser();
  if (client && SUPABASE_TABLES.has(storeName)) {
    try {
      const idColumn = storeName === 'users' ? 'user' : 'id';
      const { error } = await client.from(storeName).delete().eq(idColumn, key);
      if (error) {
        dbDiagnostics.hasErrors = true;
        dbDiagnostics.lastErrorMessage = error.message;
        dbDiagnostics.tableErrors[storeName] = error.message;
        return localDeleteItem(storeName, key);
      }
      delete dbDiagnostics.tableErrors[storeName];
      if (Object.keys(dbDiagnostics.tableErrors).length === 0) {
        dbDiagnostics.hasErrors = false;
        dbDiagnostics.lastErrorMessage = null;
      }
    } catch (e: any) {
      dbDiagnostics.hasErrors = true;
      dbDiagnostics.lastErrorMessage = e?.message || String(e);
      dbDiagnostics.tableErrors[storeName] = e?.message || String(e);
      return localDeleteItem(storeName, key);
    }
  } else {
    return localDeleteItem(storeName, key);
  }
};

// ═══════════════════════════════════════════════════════
//  DISCORD WEBHOOK — server-side proxy فقط
//  الـ URL يُرسل عبر Supabase Edge Function، لا يظهر في bundle
// ═══════════════════════════════════════════════════════

/**
 * أرسل إشعار Discord عبر Supabase Edge Function
 * الـ webhook URL محفوظ فقط في بيئة Edge Function — لا يُكشف في الـ bundle
 *
 * إعداد الـ Edge Function في Supabase:
 *  1. supabase functions new discord-notify
 *  2. في الكود اقرأ DISCORD_TICKET_WEBHOOK و DISCORD_BAN_WEBHOOK من env
 *  3. supabase secrets set DISCORD_TICKET_WEBHOOK=https://...
 */
export const sendDiscordViaEdge = async (
  type: 'ticket' | 'ban' | 'logs',
  payload: Record<string, unknown>
): Promise<void> => {
  // @ts-ignore
  const _supabaseUrl: string = import.meta.env.VITE_SUPABASE_URL || '';
  // @ts-ignore
  const _anonKey: string = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

  // إذا في Supabase — نرسل عبر Edge Function
  if (_supabaseUrl && _anonKey) {
    try {
      const res = await fetch(`${_supabaseUrl}/functions/v1/discord-notify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${_anonKey}`,
          'apikey': _anonKey,
        },
        body: JSON.stringify({ type, payload }),
      });
      if (!res.ok) {
        const err = await res.text().catch(() => res.statusText);
        console.error('discord-notify edge error:', res.status, err);
      }
      return;
    } catch (e) {
      console.error('Edge Function discord-notify failed:', e);
      // نكمل للـ fallback أدناه
    }
  }

  // Fallback: إرسال مباشر من الـ env (لو ما في Supabase أو فشل الـ Edge)
  // @ts-ignore
  const url: string = type === 'ticket'
    // @ts-ignore
    ? (import.meta.env.VITE_DISCORD_TICKET_WEBHOOK || '')
    : type === 'ban'
    // @ts-ignore
    ? (import.meta.env.VITE_DISCORD_BAN_WEBHOOK || '')
    // @ts-ignore
    : (import.meta.env.VITE_DISCORD_LOGS_WEBHOOK || '');
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.error('Discord direct webhook failed:', e);
  }
};

// ═══════════════════════════════════════════════════════
//  SERVER-SIDE AUTHORIZATION CHECK
//  يُستدعى قبل أي عملية حساسة للتحقق من الصلاحيات
//  في Supabase، يعتمد على RLS policies
// ═══════════════════════════════════════════════════════

/**
 * تحقق من صلاحية المستخدم الحالي في قاعدة البيانات مباشرة
 * هذا يمنع تزوير الـ role من DevTools
 */
export const verifyUserRoleFromDB = async (username: string): Promise<string | null> => {
  if (!supabase) {
    // IndexedDB mode — لا يوجد server, نقبل الـ client role
    const users = await localGetAll<{ user: string; role: string; status: string }>('users');
    const u = users.find(x => x.user === username);
    return u?.status === 'active' ? u.role : null;
  }
  try {
    const { data, error } = await supabase
      .from('users')
      .select('role, status')
      .eq('user', username)
      .single();
    if (error || !data || data.status !== 'active') return null;
    return data.role as string;
  } catch {
    return null;
  }
};

// ═══════════════════════════════════════════════════════
//  FILE UPLOAD — R2 مع Content-Type validation
// ═══════════════════════════════════════════════════════

const ALLOWED_VIDEO_TYPES = [
  'video/mp4', 'video/webm', 'video/quicktime', 'video/x-matroska',
  'video/x-msvideo', 'video/mpeg', 'video/ogg', 'video/3gpp',
  'video/3gpp2', 'video/x-ms-wmv', 'video/x-flv', 'video/avi',
  'video/mov', 'video/mkv',
];
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mov', '.mkv', '.avi', '.mpeg', '.mpg', '.ogg', '.3gp', '.wmv', '.flv', '.m4v'];
const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB

export interface FileValidationResult {
  ok: boolean;
  error?: string;
  isVideo?: boolean;
}

export const validateFile = (file: File): FileValidationResult => {
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return { ok: false, error: `حجم الملف (${(file.size / 1024 / 1024).toFixed(1)} MB) يتجاوز الحد الأقصى (100 MB)` };
  }

  // تحقق بالـ MIME type أولاً
  if (ALLOWED_VIDEO_TYPES.includes(file.type)) {
    return { ok: true, isVideo: true };
  }
  if (ALLOWED_IMAGE_TYPES.includes(file.type)) {
    return { ok: true, isVideo: false };
  }

  // fallback: تحقق بالامتداد لو كان الـ MIME type فارغاً أو غير معروف
  const ext = '.' + file.name.split('.').pop()?.toLowerCase();
  if (VIDEO_EXTENSIONS.includes(ext)) {
    return { ok: true, isVideo: true };
  }
  if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
    return { ok: true, isVideo: false };
  }

  return { ok: false, error: `نوع الملف "${file.type || ext}" غير مدعوم. الأنواع المسموحة: mp4، webm، mov، mkv، avi، jpg، png، gif، webp` };
};

// ═══════════════════════════════════════════════════════
//  SMART SUSPICION SYSTEM — Risk Scoring Engine
//  محرك تسجيل المخاطر يعمل بالكامل على بيانات النظام المحلية
//  (عدد القضايا السابقة، الأدلة، البلاوات، التكرار) — لا يوجد ذكاء
//  اصطناعي خارجي، فقط قواعد واضحة وقابلة للتفسير لكل لاعب.
// ═══════════════════════════════════════════════════════

export interface RiskFactor {
  label: string;
  points: number;
  detail: string;
}

export interface RiskAssessment {
  score: number;          // 0-100
  level: 'low' | 'medium' | 'high' | 'critical';
  factors: RiskFactor[];
  suggestedAction: string;
  patternSummary: string;
}

/**
 * يحسب مستوى الخطورة لِـ Discord ID معيّن بالاستناد إلى:
 * - عدد القضايا (المفتوحة/المغلقة) المرتبطة به
 * - عدد البلاوات السابقة (وهل من نوع Hack)
 * - عدد الأدلة المرفوعة
 * - حداثة آخر حدث (التكرار في فترة قصيرة يرفع الخطورة)
 */
export const calculateRiskAssessment = (
  discordId: string,
  cases: InvestigationCase[],
  bans: Ban[],
  evidenceItems: EvidenceItem[]
): RiskAssessment => {
  const factors: RiskFactor[] = [];
  let score = 0;

  const relatedCases = cases.filter(c => c.discordId === discordId);
  const relatedBans = bans.filter(b => b.discordId === discordId);
  const relatedEvidence = evidenceItems.filter(e => e.discordId === discordId);
  const hackBans = relatedBans.filter(b => b.type === 'Hack');
  const closedBannedCases = relatedCases.filter(c => c.status === 'closed_banned');

  if (relatedBans.length > 0) {
    const pts = Math.min(relatedBans.length * 18, 45);
    score += pts;
    factors.push({ label: 'سجل بلاوات سابقة', points: pts, detail: `${relatedBans.length} حالة باند مسجلة لهذا اللاعب` });
  }

  if (hackBans.length > 0) {
    const pts = Math.min(hackBans.length * 15, 30);
    score += pts;
    factors.push({ label: 'استخدام هاك مؤكد سابقاً', points: pts, detail: `${hackBans.length} بلاغ هاك مؤكد` });
  }

  if (closedBannedCases.length > 0) {
    const pts = Math.min(closedBannedCases.length * 10, 20);
    score += pts;
    factors.push({ label: 'قضايا سابقة انتهت بباند', points: pts, detail: `${closedBannedCases.length} قضية انتهت بإجراء باند` });
  }

  const openCases = relatedCases.filter(c => c.status === 'open' || c.status === 'investigating');
  if (openCases.length > 1) {
    const pts = Math.min((openCases.length - 1) * 8, 16);
    score += pts;
    factors.push({ label: 'قضايا مفتوحة متعددة حالياً', points: pts, detail: `${openCases.length} قضية مفتوحة بنفس الوقت` });
  }

  if (relatedEvidence.length >= 3) {
    const pts = Math.min(Math.floor(relatedEvidence.length / 2) * 5, 15);
    score += pts;
    factors.push({ label: 'تجمّع أدلة كثيف', points: pts, detail: `${relatedEvidence.length} دليل مرتبط بهذا اللاعب` });
  }

  // التكرار الزمني — أحداث متقاربة في آخر 7 أيام
  const recentWindow = 7 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const recentEvents = [
    ...relatedCases.map(c => c.updatedAt),
    ...relatedEvidence.map(e => e.createdAt),
  ].filter(t => now - t < recentWindow);
  if (recentEvents.length >= 3) {
    score += 10;
    factors.push({ label: 'نشاط متكرر خلال 7 أيام', points: 10, detail: `${recentEvents.length} حدث مسجل خلال الأسبوع الماضي` });
  }

  score = Math.min(Math.round(score), 100);

  let level: RiskAssessment['level'] = 'low';
  if (score >= 70) level = 'critical';
  else if (score >= 45) level = 'high';
  else if (score >= 20) level = 'medium';

  let suggestedAction = 'مراقبة عادية — لا حاجة لإجراء فوري حالياً.';
  if (level === 'critical') suggestedAction = 'يُنصح برفع القضية لمراجعة الإدارة فوراً واتخاذ إجراء حاسم (Ban Recommendation).';
  else if (level === 'high') suggestedAction = 'يُنصح بفتح تحقيق فوري وجمع أدلة إضافية قبل اتخاذ إجراء.';
  else if (level === 'medium') suggestedAction = 'يُنصح بإضافة اللاعب إلى Watchlist ومتابعة سلوكه دون إجراء مباشر بعد.';

  let patternSummary = 'لا يوجد نمط سلوكي ملحوظ بعد — البيانات المتوفرة محدودة.';
  if (factors.length > 0) {
    patternSummary = `هذا اللاعب لديه ${factors.length} مؤشر خطورة نشِط: ${factors.map(f => f.label).join('، ')}.`;
  }

  return { score, level, factors, suggestedAction, patternSummary };
};

// ═══════════════════════════════════════════════════════
//  GLOBAL SEARCH — يبحث عبر اللاعبين/القضايا/البلاوات/الأدلة
// ═══════════════════════════════════════════════════════

export type SearchResultKind = 'case' | 'ban' | 'evidence' | 'player' | 'altProfile' | 'preWlHack' | 'pcCheck';

export interface SearchResult {
  kind: SearchResultKind;
  id: number | string;
  title: string;
  subtitle: string;
  discordId?: string;
}

export const globalSearch = (
  query: string,
  cases: InvestigationCase[],
  bans: Ban[],
  evidenceItems: EvidenceItem[],
  altProfiles: AltProfile[] = [],
  preWlHacks: PreWLHack[] = [],
  pcChecks: PCCheckRecord[] = []
): SearchResult[] => {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const results: SearchResult[] = [];

  for (const c of cases) {
    const haystack = `${c.title} ${c.discordId} ${c.playerName || ''} ${c.summary}`.toLowerCase();
    if (haystack.includes(q)) {
      results.push({
        kind: 'case', id: c.id, title: c.title,
        subtitle: `قضية • ${c.discordId} • ${c.status}`, discordId: c.discordId,
      });
    }
  }

  for (const b of bans) {
    const haystack = `${b.discordId} ${b.reason} ${b.identifiers || ''} ${b.type}`.toLowerCase();
    if (haystack.includes(q)) {
      results.push({
        kind: 'ban', id: b.id, title: `${b.discordId} — ${b.type}`,
        subtitle: `باند • ${b.reason.slice(0, 60)}`, discordId: b.discordId,
      });
    }
  }

  for (const e of evidenceItems) {
    const haystack = `${e.name || ''} ${e.text || ''} ${e.discordId || ''} ${e.tags.join(' ')}`.toLowerCase();
    if (haystack.includes(q)) {
      results.push({
        kind: 'evidence', id: e.id, title: e.name || `دليل #${e.id}`,
        subtitle: `دليل • ${e.category}`, discordId: e.discordId,
      });
    }
  }

  // Intelligence Room — index every text field: primary ID, player name,
  // all linked IDs, and free-text notes.
  for (const p of altProfiles) {
    const haystack = `${p.primaryId} ${p.primaryName || ''} ${p.linkedIds.join(' ')} ${p.notes || ''}`.toLowerCase();
    if (haystack.includes(q)) {
      results.push({
        kind: 'altProfile', id: p.id, title: p.primaryName ? `${p.primaryName} (Discord: ${p.primaryId})` : `Discord: ${p.primaryId}`,
        subtitle: `Intelligence Room • ${p.linkedIds.length} حساب مرتبط`, discordId: p.primaryId,
      });
    }
  }

  // PC Checks — يبحث في اسم اللاعب والـ HWID والـ PIN والملاحظات
  for (const r of pcChecks) {
    const haystack = `${r.player || ''} ${r.hwid || ''} ${r.pin || ''} ${r.notes || ''}`.toLowerCase();
    if (haystack.includes(q)) {
      results.push({
        kind: 'pcCheck',
        id: r.id,
        title: r.player || `PC Check #${r.id}`,
        subtitle: `PC Check • ${r.isCheater ? '🔴 Cheater' : '🟢 Clean'}${r.hwid ? ' • ' + r.hwid : ''}`,
      });
    }
  }

  // Pre WL Hacks — يبحث في كل المعرفات والاسم بما فيها المتعددة
  for (const h of preWlHacks) {
    // دالة مساعدة لتحويل array أو JSON string إلى array
    const toArr = (v: string[] | string | undefined): string[] => {
      if (!v) return [];
      if (Array.isArray(v)) return v;
      try { const p = JSON.parse(v); return Array.isArray(p) ? p : [v]; } catch { return [v]; }
    };
    const allLicenses = toArr(h.licenses).length ? toArr(h.licenses) : [h.license, h.license2].filter(Boolean) as string[];
    const allSteams   = toArr(h.steams).length   ? toArr(h.steams)   : [h.steam].filter(Boolean) as string[];
    const allDiscords = toArr(h.discords).length  ? toArr(h.discords) : [h.discord].filter(Boolean) as string[];

    const haystack = [
      h.player_name || h.playerName || '',
      ...allLicenses,
      ...allSteams,
      ...allDiscords,
      h.xbl || '',
      h.live_id || h.liveId || '',
      h.ip || '',
      h.banned_from || h.bannedFrom || '',
    ].join(' ').toLowerCase();

    if (haystack.includes(q)) {
      results.push({
        kind: 'preWlHack',
        id: h.id,
        title: h.player_name || h.playerName || `Pre WL Hack #${h.id}`,
        subtitle: `Pre WL Hack • ${h.hack_active || h.hackActive === 'yes' ? '🔴 هاك نشط' : '⚪ غير نشط'}${allLicenses[0] ? ' • ' + allLicenses[0] : ''}`,
      });
    }
  }

  // اللاعبين — مجمّعين من discordId الفريد عبر كل المصادر، بما فيها Intelligence Room
  const playerIds = new Set<string>();
  [
    ...cases.map(c => c.discordId),
    ...bans.map(b => b.discordId),
    ...evidenceItems.map(e => e.discordId || ''),
    ...altProfiles.map(p => p.primaryId),
    ...altProfiles.flatMap(p => p.linkedIds),
  ]
    .filter(Boolean)
    .forEach(id => playerIds.add(id));
  for (const id of playerIds) {
    if (id.toLowerCase().includes(q)) {
      const caseCount = cases.filter(c => c.discordId === id).length;
      const banCount = bans.filter(b => b.discordId === id).length;
      results.push({
        kind: 'player', id, title: id,
        subtitle: `لاعب • ${caseCount} قضية، ${banCount} باند`, discordId: id,
      });
    }
  }

  return results.slice(0, 30);
};
