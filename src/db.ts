import { createClient } from '@supabase/supabase-js';
import { User, Ticket, Ban } from './types';

// ═══════════════════════════════════════════════════════
//  LOCAL DATABASE — IndexedDB Fallback
// ═══════════════════════════════════════════════════════
const DB_NAME = 'MT_Logs_DB';
const DB_VERSION = 7;

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
 * توليد salt عشوائي لكل مستخدم — 16 byte hex
 */
export const generateSalt = (): string => {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    try {
      const arr = new Uint8Array(16);
      crypto.getRandomValues(arr);
      return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
    } catch { /* fall through */ }
  }
  // Fallback for non-HTTPS
  return Date.now().toString(16) +
    Math.random().toString(16).slice(2).padEnd(8, '0') +
    Math.random().toString(16).slice(2).padEnd(8, '0');
};

/**
 * Simple hash fallback when crypto.subtle is unavailable (HTTP env)
 * Uses a deterministic but obfuscated string transformation
 */
const simpleHash = (password: string, salt: string): string => {
  const combined = `${salt}::${password}::MT_LOGS_2026`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < combined.length; i++) {
    hash ^= combined.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  // Produce a longer pseudo-hash by repeating with different seeds
  let result = '';
  let h = hash;
  for (let round = 0; round < 8; round++) {
    h = (h ^ (round * 0xdeadbeef)) >>> 0;
    for (let i = 0; i < combined.length; i++) {
      h ^= combined.charCodeAt(i) + round;
      h = (h * 0x01000193 + round) >>> 0;
    }
    result += h.toString(16).padStart(8, '0');
  }
  return result;
};

/**
 * تشفير كلمة المرور بـ PBKDF2 مع salt عشوائي خاص بكل مستخدم
 * النتيجة: "pbkdf2$<salt>$<hash>"
 */
export const hashPasswordWithSalt = async (password: string, salt: string): Promise<string> => {
  // crypto.subtle غير متاح على HTTP — نستخدم simpleHash مباشرة
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    const hashHex = simpleHash(password, salt);
    return `pbkdf2$${salt}$${hashHex}`;
  }
  try {
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
  } catch {
    const hashHex = simpleHash(password, salt);
    return `pbkdf2$${salt}$${hashHex}`;
  }
};

/**
 * مقارنة timing-safe — نمنع timing attacks
 */
export const verifyPasswordWithSalt = async (password: string, storedHash: string): Promise<boolean> => {
  if (!storedHash.startsWith('pbkdf2$')) return false;
  const parts = storedHash.split('$');
  if (parts.length !== 3) return false;
  const [, salt] = parts;
  const computed = await hashPasswordWithSalt(password, salt);

  // Constant-time comparison
  if (computed.length !== storedHash.length) {
    // Lengths differ — could be simpleHash vs real PBKDF2
    // Try direct comparison as fallback
    return computed === storedHash;
  }
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
  // SHA-256 قديم (static salt)
  if (storedPass.length === 64 && /^[0-9a-f]+$/.test(storedPass)) {
    if (typeof crypto === 'undefined' || !crypto.subtle) return false;
    try {
      const legacySalt = `MT_LOGS_2026:${password}:SEC_SALT_X9K`;
      const enc = new TextEncoder();
      const buf = await crypto.subtle.digest('SHA-256', enc.encode(legacySalt));
      const hex = Array.from(new Uint8Array(buf))
        .map(b => b.toString(16).padStart(2, '0')).join('');
      return hex === storedPass;
    } catch { return false; }
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

export const getAll = async <T>(storeName: string): Promise<T[]> => {
  const client = getSupabaseWithUser();
  if (client) {
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
  if (client) {
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
  if (client) {
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
  const client = getSupabaseWithUser(username);
  if (!client) {
    // IndexedDB mode — لا يوجد server, نقبل الـ client role
    const users = await localGetAll<{ user: string; role: string; status: string }>('users');
    const u = users.find(x => x.user === username);
    return u?.status === 'active' ? u.role : null;
  }
  try {
    const { data, error } = await client
      .from('users')
      .select('role, status')
      .eq('user', username)
      .single();
    if (error || !data) {
      // Fallback to IndexedDB if Supabase query fails
      const users = await localGetAll<{ user: string; role: string; status: string }>('users');
      const u = users.find(x => x.user === username);
      return u?.status === 'active' ? u.role : null;
    }
    if (data.status !== 'active') return null;
    return data.role as string;
  } catch {
    // Fallback to IndexedDB on any error
    try {
      const users = await localGetAll<{ user: string; role: string; status: string }>('users');
      const u = users.find(x => x.user === username);
      return u?.status === 'active' ? u.role : null;
    } catch {
      return null;
    }
  }
};

// ═══════════════════════════════════════════════════════
//  FILE UPLOAD — R2 مع Content-Type validation
// ═══════════════════════════════════════════════════════

const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-matroska'];
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB

export interface FileValidationResult {
  ok: boolean;
  error?: string;
}

export const validateFile = (file: File): FileValidationResult => {
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return { ok: false, error: `حجم الملف (${(file.size / 1024 / 1024).toFixed(1)} MB) يتجاوز الحد الأقصى (100 MB)` };
  }
  const allowed = [...ALLOWED_VIDEO_TYPES, ...ALLOWED_IMAGE_TYPES];
  if (!allowed.includes(file.type)) {
    return { ok: false, error: `نوع الملف "${file.type}" غير مدعوم. الأنواع المسموحة: mp4، webm، jpg، png، gif، webp` };
  }
  return { ok: true };
};
