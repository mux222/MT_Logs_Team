/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

const WORKER_URL = "https://r2-uploader.abotete1.workers.dev";

// ═══════════════════════════════════════════════════════
//  DISCORD NOTIFICATIONS — via Supabase Edge Function
//  الـ webhook URL لا يظهر في bundle أبداً
// ═══════════════════════════════════════════════════════

const sendDiscordTicketNotification = async (subject: string, creator: string, ticketId: number | string) => {
  try {
    const payload = {
      content: '@everyone',
      embeds: [{
        title: '🎫 تذكرة جديدة تم فتحها',
        description: '**يرجى الاطلاع عليها في أقرب وقت**',
        color: 0xFF6A00,
        fields: [
          { name: '📋 الموضوع', value: `\`\`\`${subject}\`\`\``, inline: false },
          { name: '🆔 رقم التذكرة', value: `\`${ticketId}\``, inline: true },
          { name: '👤 بواسطة', value: `\`${creator}\``, inline: true },
          { name: '​', value: '**يرجى فتح لوحة التذاكر والرد في أقرب وقت ممكن**', inline: false },
        ],
        footer: { text: 'MT Logs System • نظام التذاكر' },
        timestamp: new Date().toISOString()
      }]
    };
    await sendDiscordViaEdge('ticket', payload);
  } catch (e) {
    console.error('Discord ticket notification error:', e);
  }
};

const sendDiscordLogsNotification = async (
  action: string,
  details: string,
  userName: string,
  banData?: { discordId: string; type: string; reason: string; identifiers?: string },
  editDiff?: { field: string; from: string; to: string }[],
  mediaChanges?: { added: { type: 'image' | 'video'; url: string; name?: string }[]; removed: { type: 'image' | 'video'; url: string; name?: string }[] }
) => {
  try {
    const actionColors: Record<string, number> = {
      'Add Ban':           0xFF0000,
      'Edit Ban':          0xFF8C00,
      'Delete Ban':        0xAA0000,
      'Close Ticket':      0x00AA55,
      'Claim Ticket':      0x00AAFF,
      'Approve User':      0x00FF88,
      'Delete User':       0xFF4444,
      'Change Role':       0xAA44FF,
      'Remove Evidence':        0xFF4500,
      'Remove Image Evidence':  0xFF4500,
      'Remove Video Evidence':  0xFF6600,
      'Add Image Evidence':     0x00AA88,
      'Add Video Evidence':     0x0088FF,
    };
    const color = actionColors[action] ?? 0x888888;

    // تحديد عنوان ذكي لحذف الأدلة
    let title = '';
    if (['Remove Image Evidence','Remove Video Evidence','Add Image Evidence','Add Video Evidence'].includes(action)) {
      const icons: Record<string,string> = {
        'Remove Image Evidence': '🖼️ تم حذف صورة دليل',
        'Remove Video Evidence': '🎬 تم حذف مقطع دليل',
        'Add Image Evidence':    '🖼️ تم إضافة صورة دليل',
        'Add Video Evidence':    '🎬 تم إضافة مقطع دليل',
      };
      title = icons[action];
    } else {
      const actionIcons: Record<string, string> = {
        'Add Ban':      '🔨 تم إضافة باند',
        'Edit Ban':     '✏️ تم تعديل باند',
        'Delete Ban':   '🗑️ تم حذف باند',
        'Close Ticket': '🎫 تم إغلاق تذكرة',
        'Claim Ticket': '📌 تم المطالبة بتذكرة',
        'Approve User': '✅ تم قبول مستخدم',
        'Delete User':  '❌ تم حذف مستخدم',
        'Change Role':  '🔑 تم تغيير الرتبة',
        'Remove Evidence': '🗑️ تم حذف دليل',
      };
      title = actionIcons[action] ?? `📋 ${action}`;
    }

    const fields: { name: string; value: string; inline: boolean }[] = [];

    if (banData) {
      fields.push({ name: '🆔 Discord ID', value: `\`\`\`${banData.discordId}\`\`\``, inline: false });
      fields.push({ name: '📌 نوع الباند', value: `\`${banData.type}\``, inline: true });
      if (banData.identifiers) {
        fields.push({ name: '🔗 المعرفات', value: `\`${banData.identifiers}\``, inline: true });
      }
      fields.push({ name: '📝 السبب', value: `\`\`\`${banData.reason}\`\`\``, inline: false });
    } else {
      fields.push({ name: '📝 التفاصيل', value: `\`\`\`${details}\`\`\``, inline: false });
    }

    // فروق التعديل
    if (editDiff && editDiff.length > 0) {
      const diffText = editDiff.map(d => `**${d.field}**\n🔴 \`${d.from}\`\n🟢 \`${d.to}\``).join('\n\n');
      fields.push({ name: '🔄 التغييرات', value: diffText, inline: false });
    }

    // الميديا — نص مع نوع واضح
    if (mediaChanges) {
      if (mediaChanges.added.length > 0) {
        const addedText = mediaChanges.added.map(m =>
          `${m.type === 'video' ? '🎬 مقطع' : '🖼️ صورة'}: \`${m.name || 'دليل'}\``
        ).join('\n');
        fields.push({ name: '➕ أدلة مضافة', value: addedText, inline: true });
      }
      if (mediaChanges.removed.length > 0) {
        const removedText = mediaChanges.removed.map(m =>
          `${m.type === 'video' ? '🎬 مقطع' : '🖼️ صورة'}: \`${m.name || 'دليل'}\``
        ).join('\n');
        fields.push({ name: '➖ أدلة محذوفة', value: removedText, inline: true });
      }
    }

    fields.push({ name: '👮 الأدمن المسؤول', value: `\`${userName}\``, inline: false });

    // محاولة إرفاق الصورة في الـ embed
    // الأولوية: R2 URL (http) ← يظهر مباشرة في Discord
    // base64 ← نرسله كـ attachment منفصل
    const removedImages = mediaChanges?.removed.filter(m => m.type === 'image') || [];
    const addedImages = mediaChanges?.added.filter(m => m.type === 'image') || [];
    const allImages = [...removedImages, ...addedImages];

    const httpImage = allImages.find(m => m.url.startsWith('http'));
    const base64Images = allImages.filter(m => m.url.startsWith('data:image'));

    const embeds: any[] = [{
      title,
      color,
      fields,
      footer: { text: 'MT Logs System • Audit Logs' },
      timestamp: new Date().toISOString(),
      ...(httpImage ? { image: { url: httpImage.url } } : {})
    }];

    // لو في صور base64 — أضف embed إضافي لكل صورة (حتى 4)
    base64Images.slice(0, 4).forEach((img, i) => {
      embeds.push({
        title: `🖼️ معاينة الصورة ${base64Images.length > 1 ? i + 1 : ''}`.trim(),
        color,
        image: { url: img.url },
        footer: { text: img.name || 'دليل محذوف' }
      });
    });

    const payload: any = { embeds };
    await sendDiscordViaEdge('logs', payload);
  } catch (e) {
    console.error('Discord logs notification error:', e);
  }
};


const sendDiscordBanNotification = async (discordId: string, banType: string, reason: string, bannedBy: string) => {
  try {
    const payload = {
      content: '@everyone',
      embeds: [{
        title: '🔨 باند جديد تم إضافته',
        description: '**تم تسجيل حالة باند جديدة في النظام**',
        color: 0xFF0000,
        fields: [
          { name: '🆔 Discord ID', value: `\`\`\`${discordId}\`\`\``, inline: false },
          { name: '📌 النوع', value: `\`${banType}\``, inline: true },
          { name: '📝 السبب', value: `\`\`\`${reason}\`\`\``, inline: false },
          { name: '👮 بواسطة', value: `\`${bannedBy}\``, inline: true },
        ],
        footer: { text: 'MT Logs System • نظام الباند' },
        timestamp: new Date().toISOString()
      }]
    };
    await sendDiscordViaEdge('ban', payload);
  } catch (e) {
    console.error('Discord ban notification error:', e);
  }
};

// ═══════════════════════════════════════════════════════
//  PASSWORD HASHING — PBKDF2 (200k iterations, per-user salt)
//  كل المنطق الآن في db.ts لاستخدام الدوال المُصدَّرة
// ═══════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════
//  SESSION MANAGEMENT — sessionStorage only (no localStorage for session)
//  - الجلسة لا تُخزَّن في localStorage إلا عند "تذكرني"
//  - البيانات مشفرة بـ AES-GCM مع مفتاح مشتق من fingerprint الجهاز
//  - لا يوجد مفتاح ثابت في الكود
// ═══════════════════════════════════════════════════════

const SEC = {
  SESSION_KEY:  '__mt_sess__',
  REMEMBER_KEY: '__mt_rmb__',
  CSRF_KEY:     '__mt_csrf__',
  ATTEMPTS_KEY: '__mt_atm__',
  LOCKOUT_KEY:  '__mt_lck__',
  MAX_ATTEMPTS:     5,
  LOCKOUT_DURATION: 15 * 60 * 1000,
  SESSION_DURATION: 2 * 60 * 60 * 1000,
  REMEMBER_DURATION: 30 * 24 * 60 * 60 * 1000,
};

/**
 * يولّد fingerprint للجهاز من خصائص المتصفح
 * هذا يجعل الجلسة مرتبطة بالجهاز — لا تنفع على جهاز آخر
 */
const getDeviceFingerprint = (): string => {
  const nav = window.navigator;
  const parts = [
    nav.userAgent,
    nav.language,
    String(nav.hardwareConcurrency || ''),
    String(screen.width) + 'x' + String(screen.height),
    String(screen.colorDepth),
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  ];
  return parts.join('||');
};

/**
 * يشتق مفتاح AES-GCM من fingerprint الجهاز باستخدام PBKDF2
 * النتيجة: مفتاح مختلف لكل جهاز، ولا يوجد مفتاح ثابت في الكود
 */
const deriveKeyFromFingerprint = async (): Promise<CryptoKey> => {
  assertCryptoAvailable();
  const enc = new TextEncoder();
  const fingerprint = getDeviceFingerprint();
  // salt ثابت لهذا التطبيق — مو سري لكنه يمنع rainbow tables
  const salt = enc.encode('MT_LOGS_SALT_2026_v2');
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(fingerprint), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
};

// cache المفتاح المشتق لتجنب إعادة الاشتقاق في كل عملية
let _derivedKey: CryptoKey | null = null;
const getAesKey = async (): Promise<CryptoKey> => {
  if (_derivedKey) return _derivedKey;
  _derivedKey = await deriveKeyFromFingerprint();
  return _derivedKey;
};

const encryptData = async (plaintext: string): Promise<string> => {
  const key = await getAesKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext));
  const combined = new Uint8Array(iv.byteLength + cipherBuf.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(cipherBuf), iv.byteLength);
  return btoa(String.fromCharCode(...combined));
};

const decryptData = async (b64: string): Promise<string> => {
  const key = await getAesKey();
  const combined = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const cipherBuf = combined.slice(12);
  const decBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipherBuf);
  return new TextDecoder().decode(decBuf);
};

const generateCSRFToken = (): string => {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
};

// ── Rate Limiting ──
// ملاحظة: هذا الـ rate limit هو client-side كطبقة أولى فقط.
// الحماية الحقيقية يجب أن تكون في Supabase Edge Function أو Cloudflare Worker.
const checkRateLimit = (): { blocked: boolean; remaining: number; lockoutLeft: number } => {
  const lockoutStr = sessionStorage.getItem(SEC.LOCKOUT_KEY) || localStorage.getItem(SEC.LOCKOUT_KEY);
  if (lockoutStr) {
    const lockoutUntil = parseInt(lockoutStr);
    const now = Date.now();
    if (now < lockoutUntil) {
      return { blocked: true, remaining: 0, lockoutLeft: Math.ceil((lockoutUntil - now) / 1000) };
    }
    sessionStorage.removeItem(SEC.LOCKOUT_KEY);
    localStorage.removeItem(SEC.LOCKOUT_KEY);
    sessionStorage.removeItem(SEC.ATTEMPTS_KEY);
    localStorage.removeItem(SEC.ATTEMPTS_KEY);
  }
  const attemptsStr = sessionStorage.getItem(SEC.ATTEMPTS_KEY);
  const attempts = attemptsStr ? JSON.parse(attemptsStr) : [];
  const recent = attempts.filter((t: number) => Date.now() - t < 10 * 60 * 1000);
  return { blocked: false, remaining: SEC.MAX_ATTEMPTS - recent.length, lockoutLeft: 0 };
};

const recordFailedAttempt = () => {
  const attemptsStr = sessionStorage.getItem(SEC.ATTEMPTS_KEY);
  const attempts = attemptsStr ? JSON.parse(attemptsStr) : [];
  attempts.push(Date.now());
  const recent = attempts.filter((t: number) => Date.now() - t < 10 * 60 * 1000);
  sessionStorage.setItem(SEC.ATTEMPTS_KEY, JSON.stringify(recent));
  if (recent.length >= SEC.MAX_ATTEMPTS) {
    const lockUntil = String(Date.now() + SEC.LOCKOUT_DURATION);
    sessionStorage.setItem(SEC.LOCKOUT_KEY, lockUntil);
    // نحفظ في localStorage أيضاً عشان Incognito لا يساعد
    localStorage.setItem(SEC.LOCKOUT_KEY, lockUntil);
    localStorage.setItem(SEC.ATTEMPTS_KEY, JSON.stringify(recent));
  }
};

const clearAttempts = () => {
  sessionStorage.removeItem(SEC.ATTEMPTS_KEY);
  sessionStorage.removeItem(SEC.LOCKOUT_KEY);
  localStorage.removeItem(SEC.ATTEMPTS_KEY);
  localStorage.removeItem(SEC.LOCKOUT_KEY);
};

// ── Session Storage ──
const saveSession = async (user: string, role: string, remember: boolean) => {
  const csrf = generateCSRFToken();
  const expiry = Date.now() + (remember ? SEC.REMEMBER_DURATION : SEC.SESSION_DURATION);
  const sessionObj = JSON.stringify({ user, role, csrf, expiry, remember });
  const encrypted = await encryptData(sessionObj);
  const storage = remember ? localStorage : sessionStorage;
  storage.setItem(SEC.SESSION_KEY, encrypted);
  // CSRF يبقى في sessionStorage دائماً — لا يُرسَل تلقائياً مع الطلبات
  sessionStorage.setItem(SEC.CSRF_KEY, csrf);
  if (remember) {
    const encUser = await encryptData(user);
    localStorage.setItem(SEC.REMEMBER_KEY, encUser);
  }
};

const loadSession = async (): Promise<{ user: string; role: string; valid: boolean } | null> => {
  const raw = sessionStorage.getItem(SEC.SESSION_KEY) || localStorage.getItem(SEC.SESSION_KEY);
  if (!raw) return null;
  try {
    const decrypted = await decryptData(raw);
    const data = JSON.parse(decrypted);
    if (!data?.user || !data?.expiry || !data?.role) return null;
    if (Date.now() > data.expiry) { clearSession(); return null; }
    return { user: data.user, role: data.role, valid: true };
  } catch {
    clearSession();
    return null;
  }
};

const clearSession = () => {
  sessionStorage.removeItem(SEC.SESSION_KEY);
  sessionStorage.removeItem(SEC.CSRF_KEY);
  localStorage.removeItem(SEC.SESSION_KEY);
  localStorage.removeItem(SEC.REMEMBER_KEY);
};

const getSavedUsername = async (): Promise<string> => {
  const raw = localStorage.getItem(SEC.REMEMBER_KEY);
  if (!raw) return '';
  try { return await decryptData(raw); } catch { return ''; }
};

// ── File Upload (with validation) ──
const uploadVideoToR2 = async (file: File, fileName: string): Promise<string> => {
  const validation = validateFile(file);
  if (!validation.ok) throw new Error(validation.error);

  // بعض المتصفحات ترسل MIME type فارغ — نحدده من الامتداد كـ fallback
  const ext = file.name.split('.').pop()?.toLowerCase() || 'mp4';
  const mimeMap: Record<string, string> = {
    'mp4': 'video/mp4', 'webm': 'video/webm', 'mov': 'video/quicktime',
    'mkv': 'video/x-matroska', 'avi': 'video/x-msvideo', 'mpeg': 'video/mpeg',
    'mpg': 'video/mpeg', 'ogg': 'video/ogg', '3gp': 'video/3gpp',
    'wmv': 'video/x-ms-wmv', 'flv': 'video/x-flv', 'm4v': 'video/mp4',
  };
  const contentType = file.type && file.type !== 'application/octet-stream'
    ? file.type
    : (mimeMap[ext] || 'video/mp4');

  const response = await fetch(`${WORKER_URL}/${fileName}`, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': contentType },
  });
  if (!response.ok) throw new Error(await response.text());
  const data = await response.json();
  return data.url;
};
import { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  PlusCircle, 
  Search, 
  Settings, 
  Power, 
  Ticket as TicketIcon, 
  ShieldAlert, 
  Users, 
  Target, 
  Home, 
  Gavel, 
  CheckCircle2, 
  XCircle, 
  Image as ImageIcon, 
  Video, 
  Paperclip,
  Trash2,
  ChevronLeft,
  X,
  Clock,
  Terminal,
  BarChart2,
  ShieldCheck,
  Plus,
  LogIn,
  Archive,
  User as UserIcon,
  FileText,
  Eye,
  Shield,
  Copy,
  Star,
  LayoutDashboard,
  StickyNote,
  Trophy,
  Activity,
  History,
  ClipboardList,
  Crosshair,
  AlertTriangle,
  Link2,
  Tag,
  TrendingUp,
  Command,
  ArrowRight,
  CornerDownLeft,
  FolderOpen,
  Fingerprint,
  Layers,
  Sparkles,
  GitBranch,
  MessageSquareWarning,
  ShieldX,
  Lock,
  Bug,
  Network,
  GitMerge,
  Code,
  Users2,
  UserCheck,
  Database,
  FileCode,
  Radio,
  Cpu,
  MonitorCheck,
  Check,
  Pencil,
  Server,
  Upload
} from 'lucide-react';
import { User, UserRole, Ticket, Ban, Message, BanEvidence, AuditLog, PersonalNote, InvestigationCase, EvidenceItem, CaseEvent, CaseStatus, RiskLevel, EvidenceCategory, AltProfile, YaraRule, PCCheckRecord } from './types';
import {
  getAll, putItem, deleteItem, supabase, dbDiagnostics, getSupabaseWithUser,
  hashPasswordWithSalt, verifyPasswordWithSalt, legacyVerify,
  generateSalt, verifyUserRoleFromDB, validateFile, sendDiscordViaEdge,
  calculateRiskAssessment, globalSearch, assertCryptoAvailable, type RiskAssessment, type SearchResult
} from './db';

// ── Pre-WL Hack type ─────────────────────────────────────
interface PreWLHack {
  id: number;
  rawText: string;
  playerName: string;
  license: string;
  license2: string;
  licenses: string[];   // كل الـ licenses (license + license2 + أي إضافي)
  steam: string;
  steams: string[];     // كل الـ steams
  discord: string;
  discords: string[];   // كل الـ discords (حتى 10)
  xbl: string;
  liveId: string;
  ip: string;
  bannedFrom: string;
  hackActive: 'yes' | 'no';
  imageBase64?: string;
  createdBy: string;
  createdByRole: string;
  createdAt: number;
  updatedBy?: string;
  updatedByRole?: string;
  updatedAt?: number;
  timeline: { action: string; by: string; byRole: string; at: number; old?: string; new?: string }[];
}

export default function App() {
  const [activeSec, setActiveSec] = useState<'home' | 'team' | 'goals' | 'tickets' | 'bans' | 'manage' | 'profile' | 'audit_logs' | 'closed_tickets' | 'my_dashboard' | 'notepad' | 'manager_notes' | 'leaderboard' | 'investigation_hub' | 'case_tracker' | 'intelligence_room' | 'yara_rules' | 'pc_check' | 'pre_wl_hacks'>('home');
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [toast, setToast] = useState<{ show: boolean; msg: string } | null>(null);
  const [showDbDiagnostics, setShowDbDiagnostics] = useState(false);
  const [diagnosticsState, setDiagnosticsState] = useState(dbDiagnostics);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [selectedTicketForModal, setSelectedTicketForModal] = useState<Ticket | null>(null);
  const [selectedMemberForNotes, setSelectedMemberForNotes] = useState<User | null>(null);
  const [isLoadingMemberNotes, setIsLoadingMemberNotes] = useState(false);
  const [selectedNoteForPreview, setSelectedNoteForPreview] = useState<PersonalNote | null>(null);
  const [isLoadingNotePreview, setIsLoadingNotePreview] = useState(false);
  const [showWelcome, setShowWelcome] = useState(true);
  const [authFeedback, setAuthFeedback] = useState<{ type: 'error' | 'success', msg: string } | null>(null);
  const [registerSuccess, setRegisterSuccess] = useState(false); // state مستقل لرسالة التسجيل
  
  // Data State
  const [users, setUsers] = useState<User[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [bans, setBans] = useState<Ban[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [personalNotes, setPersonalNotes] = useState<PersonalNote[]>([]);
  const [cases, setCases] = useState<InvestigationCase[]>([]);
  const [evidenceItems, setEvidenceItems] = useState<EvidenceItem[]>([]);
  const [altProfiles, setAltProfiles] = useState<AltProfile[]>([]);
  const [preWLHacks, setPreWLHacks] = useState<PreWLHack[]>([]);
  const [preWLSearch, setPreWLSearch] = useState('');
  const [preWLFilter, setPreWLFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [preWLShowForm, setPreWLShowForm] = useState(false);
  const [preWLView, setPreWLView] = useState<'list' | 'detail'>('list');
  const [preWLSelected, setPreWLSelected] = useState<PreWLHack | null>(null);
  const [preWLForm, setPreWLForm] = useState({ rawText: '', bannedFrom: '', hackActive: 'yes' as 'yes' | 'no', imageBase64: '' });
  const [preWLEditId, setPreWLEditId] = useState<number | null>(null);
  const [preWLCopied, setPreWLCopied] = useState<string | null>(null);
  const [yaraRules, setYaraRules] = useState<YaraRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [auditLogSearchQuery, setAuditLogSearchQuery] = useState('');
  const [closedTicketsSearchQuery, setClosedTicketsSearchQuery] = useState('');

  // Investigation Hub / Case Tracker / Evidence Center State
  const [activeCaseId, setActiveCaseId] = useState<number | null>(null);
  const activeCase = cases.find(c => c.id === activeCaseId) || null;
  const [caseSearchQuery, setCaseSearchQuery] = useState('');
  const [caseStatusFilter, setCaseStatusFilter] = useState<CaseStatus | 'all'>('all');
  const [showNewCaseForm, setShowNewCaseForm] = useState(false);
  const [newCaseForm, setNewCaseForm] = useState({ discordId: '', playerName: '', title: '', summary: '' });
  const [caseNoteInput, setCaseNoteInput] = useState('');
  const [evidenceSearchQuery, setEvidenceSearchQuery] = useState('');
  const [evidenceCategoryFilter, setEvidenceCategoryFilter] = useState<EvidenceCategory | 'all'>('all');
  const [showNewEvidenceForm, setShowNewEvidenceForm] = useState(false);
  const [newEvidenceForm, setNewEvidenceForm] = useState<{ discordId: string; name: string; category: EvidenceCategory; text: string; tags: string; caseId: number | null }>({ discordId: '', name: '', category: 'screenshot', text: '', tags: '', caseId: null });
  const [newEvidenceFile, setNewEvidenceFile] = useState<File | null>(null);
  const [linkEvidencePickerCaseId, setLinkEvidencePickerCaseId] = useState<number | null>(null);

  // Intelligence Room State
  const [irSearchQuery, setIrSearchQuery] = useState('');
  const [irShowForm, setIrShowForm] = useState(false);
  const [irEditId, setIrEditId] = useState<number | null>(null);
  const [irForm, setIrForm] = useState({ primaryId: '', primaryName: '', linkedIds: '', notes: '' });
  const [irLinkedInput, setIrLinkedInput] = useState('');

  // YARA Rules State
  const [yaraSearchQuery, setYaraSearchQuery] = useState('');
  const [yaraShowForm, setYaraShowForm] = useState(false);
  const [yaraEditId, setYaraEditId] = useState<number | null>(null);
  const [yaraForm, setYaraForm] = useState({ name: '', description: '', rule: '', tags: '' });
  const [yaraCopied, setYaraCopied] = useState<number | null>(null);

  // PC-CHECK State
  const [pcChecks, setPcChecks] = useState<PCCheckRecord[]>([]);
  const [pcSearchQuery, setPcSearchQuery] = useState('');
  const [pcFilter, setPcFilter] = useState<'all' | 'cheaters' | 'clean'>('all');
  const [pcShowForm, setPcShowForm] = useState(false);
  const [pcEditId, setPcEditId] = useState<number | null>(null);
  const [pcForm, setPcForm] = useState({ player: '', isCheater: false, pin: '', hwid: '', notes: '' });

  // Command Palette State
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const [commandSelectedIndex, setCommandSelectedIndex] = useState(0);

  // Auth Inputs
  const [authInputs, setAuthInputs] = useState({ user: '', pass: '', role: UserRole.LOGS });
  const [rememberMe, setRememberMe] = useState(false);
  const [rateLimitState, setRateLimitState] = useState({ blocked: false, remaining: 5, lockoutLeft: 0 });
  const [loginCooldown, setLoginCooldown] = useState(false);
  
  // Ticket Form
  const [ticketForm, setTicketForm] = useState({ subject: '', body: '' });
  const [ticketFile, setTicketFile] = useState<File | null>(null);
  const [ticketViewMode, setTicketViewMode] = useState<'my' | 'create' | 'all' | 'directory'>('create');
  const [ticketSearchQuery, setTicketSearchQuery] = useState('');
  const [activeTicketId, setActiveTicketId] = useState<number | string | null>(null);
  const activeTicket = tickets.find(t => String(t.id) === String(activeTicketId));
  const [replyInput, setReplyInput] = useState('');
  const [replyFile, setReplyFile] = useState<File | null>(null);

  // Notifications & Typing
  const [notifications, setNotifications] = useState<{ id: number; msg: string; ticketId: number | string }[]>([]);
  const [typingUsers, setTypingUsers] = useState<{ user: string; ticketId: number | string }[]>([]);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const realtimeChannelRef = useRef<any>(null);

  // Ban Form
  const [showBanForm, setShowBanForm] = useState(false);
  const [banSearchQuery, setBanSearchQuery] = useState('');
  const [banForm, setBanForm] = useState({
    discordId: '',
    type: 'Ban' as 'Ban' | 'Hack' | 'Glitch',
    reason: '',
    identifiers: ''
  });
  const [banEvidenceFiles, setBanEvidenceFiles] = useState<File[]>([]);
  const [fullScreenMedia, setFullScreenMedia] = useState<{ url: string; type: 'image' | 'video' } | null>(null);
  const [mediaPreviews, setMediaPreviews] = useState<{ url: string; type: 'image' | 'video' }[]>([]);
  const [selectedPreview, setSelectedPreview] = useState<{ url: string; type: 'image' | 'video'; name?: string } | null>(null);

  // Confirmation Modal State
  const [confirmModal, setConfirmModal] = useState<{
    show: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({ show: false, title: '', message: '', onConfirm: () => {} });

  const triggerConfirm = (title: string, message: string, onConfirm: () => void) => {
    setConfirmModal({ show: true, title, message, onConfirm });
  };

  useEffect(() => {
    const initData = async () => {
      try {
        const u = await getAll<User>('users');
        if (u.length === 0) {
          const salt = generateSalt();
          const defaultHashedPass = await hashPasswordWithSalt('098', salt);
          const defaultAdmin: User = { user: 'admin', pass: defaultHashedPass, role: UserRole.MANAGER, status: 'active' };
          await putItem('users', defaultAdmin);
          setUsers([defaultAdmin]);
        } else {
          setUsers(u);
          // Auto-login from saved session (async AES-GCM decryption)
          const session = await loadSession();
          if (session?.valid) {
            // تحقق من الـ role من DB مباشرة — يمنع تزوير الـ role عبر DevTools
            const confirmedRole = await verifyUserRoleFromDB(session.user);
            const savedUser = u.find(usr => usr.user === session.user);
            if (savedUser && savedUser.status === 'active' && confirmedRole) {
              const verifiedUser = { ...savedUser, role: confirmedRole as any };
              setCurrentUser(verifiedUser);
              setActiveSec('home');
              if (verifiedUser.role !== UserRole.ADMIN) setTicketViewMode('all');
            } else {
              clearSession();
            }
          }
          // Pre-fill remembered username
          const saved = await getSavedUsername();
          if (saved) {
            setAuthInputs(prev => ({ ...prev, user: saved }));
            setRememberMe(true);
          }
        }
        setTickets(await getAll<Ticket>('tickets'));
        setBans(await getAll<Ban>('bans'));
        setAuditLogs(await getAll<AuditLog>('audit_logs'));
        setPersonalNotes(await getAll<PersonalNote>('personal_notes'));
        setCases(await getAll<InvestigationCase>('cases'));
        setEvidenceItems(await getAll<EvidenceItem>('evidence_items'));
        setAltProfiles(await getAll<AltProfile>('alt_profiles'));
        const rawPreWL = await getAll<any>('pre_wl_hacks');
        setPreWLHacks(rawPreWL.map((raw: any) => ({
          id: raw.id,
          rawText: raw.raw_text || raw.rawText || '',
          playerName: raw.player_name || raw.playerName || '',
          license: raw.license || '',
          license2: raw.license2 || '',
          licenses: raw.licenses ? (typeof raw.licenses === 'string' ? JSON.parse(raw.licenses) : raw.licenses) : [raw.license, raw.license2].filter(Boolean),
          steam: raw.steam || '',
          steams: raw.steams ? (typeof raw.steams === 'string' ? JSON.parse(raw.steams) : raw.steams) : [raw.steam].filter(Boolean),
          discord: raw.discord || '',
          discords: raw.discords ? (typeof raw.discords === 'string' ? JSON.parse(raw.discords) : raw.discords) : [raw.discord].filter(Boolean),
          xbl: raw.xbl || '',
          liveId: raw.live_id || raw.liveId || '',
          ip: raw.ip || '',
          bannedFrom: raw.banned_from || raw.bannedFrom || '',
          hackActive: raw.hack_active !== undefined ? (raw.hack_active ? 'yes' : 'no') : (raw.hackActive || 'no'),
          imageBase64: raw.image_base64 || raw.imageBase64 || '',
          createdBy: raw.created_by || raw.createdBy || '',
          createdByRole: raw.created_by_role || raw.createdByRole || '',
          createdAt: raw.created_at ? new Date(raw.created_at).getTime() : (raw.createdAt || Date.now()),
          updatedBy: raw.updated_by || raw.updatedBy,
          updatedByRole: raw.updated_by_role || raw.updatedByRole,
          updatedAt: raw.updated_at ? new Date(raw.updated_at).getTime() : raw.updatedAt,
          timeline: raw.timeline ? (typeof raw.timeline === 'string' ? JSON.parse(raw.timeline) : raw.timeline) : [],
        } as PreWLHack)));
        setYaraRules(await getAll<YaraRule>('yara_rules'));
        setPcChecks(await getAll<PCCheckRecord>('pc_checks'));
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
        setDiagnosticsState({ ...dbDiagnostics });
      }
    };
    // Init rate limit state
    setRateLimitState(checkRateLimit());
    initData();
  }, []);

  // Supabase Realtime Synchronization
  useEffect(() => {
    if (!supabase) return;

    const channel = supabase.channel('public_db_changes_sync');
    realtimeChannelRef.current = channel;

    // Subscribe to users
    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, (payload) => {
      if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
        const newUser = payload.new as User;
        setUsers((prev) => {
          const index = prev.findIndex((u) => u.user === newUser.user);
          if (index > -1) {
            const next = [...prev];
            next[index] = newUser;
            return next;
          }
          return [...prev, newUser];
        });
      } else if (payload.eventType === 'DELETE') {
        const oldUser = payload.old as { user: string };
        setUsers((prev) => prev.filter((u) => u.user !== oldUser.user));
      }
    });

    // Subscribe to tickets
    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, (payload) => {
      if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
        const newTicket = payload.new as Ticket;
        setTickets((prev) => {
          const index = prev.findIndex((t) => String(t.id) === String(newTicket.id));
          if (index > -1) {
            const next = [...prev];
            next[index] = newTicket;
            return next;
          }
          return [...prev, newTicket];
        });
      } else if (payload.eventType === 'DELETE') {
        const oldTicket = payload.old as { id: string | number };
        setTickets((prev) => prev.filter((t) => String(t.id) !== String(oldTicket.id)));
      }
    });

    // Subscribe to bans
    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'bans' }, (payload) => {
      if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
        const newBan = payload.new as Ban;
        setBans((prev) => {
          const index = prev.findIndex((b) => String(b.id) === String(newBan.id));
          if (index > -1) {
            const next = [...prev];
            next[index] = newBan;
            return next;
          }
          return [...prev, newBan];
        });
      } else if (payload.eventType === 'DELETE') {
        const oldBan = payload.old as { id: string | number };
        setBans((prev) => prev.filter((b) => String(b.id) !== String(oldBan.id)));
      }
    });

    // Subscribe to audit logs
    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'audit_logs' }, (payload) => {
      if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
        const newLog = payload.new as AuditLog;
        setAuditLogs((prev) => {
          const index = prev.findIndex((l) => String(l.id) === String(newLog.id));
          if (index > -1) {
            const next = [...prev];
            next[index] = newLog;
            return next;
          }
          return [...prev, newLog];
        });
      } else if (payload.eventType === 'DELETE') {
        const oldLog = payload.old as { id: string | number };
        setAuditLogs((prev) => prev.filter((l) => String(l.id) !== String(oldLog.id)));
      }
    });

    // Subscribe to personal notes
    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'personal_notes' }, (payload) => {
      if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
        const newNote = payload.new as PersonalNote;
        setPersonalNotes((prev) => {
          const index = prev.findIndex((n) => String(n.id) === String(newNote.id));
          if (index > -1) {
            const next = [...prev];
            next[index] = newNote;
            return next;
          }
          return [...prev, newNote];
        });
      } else if (payload.eventType === 'DELETE') {
        const oldNote = payload.old as { id: string | number };
        setPersonalNotes((prev) => prev.filter((n) => String(n.id) !== String(oldNote.id)));
      }
    });

    // Subscribe to investigation cases
    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'cases' }, (payload) => {
      if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
        const newCase = payload.new as InvestigationCase;
        setCases((prev) => {
          const index = prev.findIndex((c) => String(c.id) === String(newCase.id));
          if (index > -1) {
            const next = [...prev];
            next[index] = newCase;
            return next;
          }
          return [newCase, ...prev];
        });
      } else if (payload.eventType === 'DELETE') {
        const oldCase = payload.old as { id: string | number };
        setCases((prev) => prev.filter((c) => String(c.id) !== String(oldCase.id)));
      }
    });

    // Subscribe to evidence items
    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'evidence_items' }, (payload) => {
      if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
        const newEv = payload.new as EvidenceItem;
        setEvidenceItems((prev) => {
          const index = prev.findIndex((e) => String(e.id) === String(newEv.id));
          if (index > -1) {
            const next = [...prev];
            next[index] = newEv;
            return next;
          }
          return [newEv, ...prev];
        });
      } else if (payload.eventType === 'DELETE') {
        const oldEv = payload.old as { id: string | number };
        setEvidenceItems((prev) => prev.filter((e) => String(e.id) !== String(oldEv.id)));
      }
    });

    // Subscribe to alt profiles
    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'pre_wl_hacks' }, (payload) => {
      if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
        const raw = payload.new as any;
        const h: PreWLHack = {
          id: raw.id,
          rawText: raw.raw_text || '',
          playerName: raw.player_name || '',
          license: raw.license || '',
          license2: raw.license2 || '',
          licenses: raw.licenses ? (typeof raw.licenses === 'string' ? JSON.parse(raw.licenses) : raw.licenses) : [raw.license, raw.license2].filter(Boolean),
          steam: raw.steam || '',
          steams: raw.steams ? (typeof raw.steams === 'string' ? JSON.parse(raw.steams) : raw.steams) : [raw.steam].filter(Boolean),
          discord: raw.discord || '',
          discords: raw.discords ? (typeof raw.discords === 'string' ? JSON.parse(raw.discords) : raw.discords) : [raw.discord].filter(Boolean),
          xbl: raw.xbl || '',
          liveId: raw.live_id || '',
          ip: raw.ip || '',
          bannedFrom: raw.banned_from || '',
          hackActive: raw.hack_active ? 'yes' : 'no',
          imageBase64: raw.image_base64 || '',
          createdBy: raw.created_by || '',
          createdByRole: raw.created_by_role || '',
          createdAt: raw.created_at ? new Date(raw.created_at).getTime() : Date.now(),
          updatedBy: raw.updated_by,
          updatedByRole: raw.updated_by_role,
          updatedAt: raw.updated_at ? new Date(raw.updated_at).getTime() : undefined,
          timeline: raw.timeline ? (typeof raw.timeline === 'string' ? JSON.parse(raw.timeline) : raw.timeline) : [],
        };
        setPreWLHacks(prev => { const i = prev.findIndex(x => String(x.id) === String(h.id)); return i >= 0 ? prev.map(x => String(x.id) === String(h.id) ? h : x) : [h, ...prev]; });
      } else { setPreWLHacks(prev => prev.filter(x => String(x.id) !== String((payload.old as any).id))); }
    });
    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'alt_profiles' }, (payload) => {
      if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
        const p = payload.new as AltProfile;
        setAltProfiles(prev => {
          const i = prev.findIndex(x => String(x.id) === String(p.id));
          if (i > -1) { const n = [...prev]; n[i] = p; return n; }
          return [p, ...prev];
        });
      } else if (payload.eventType === 'DELETE') {
        const old = payload.old as { id: string | number };
        setAltProfiles(prev => prev.filter(x => String(x.id) !== String(old.id)));
      }
    });

    // Subscribe to yara rules
    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'yara_rules' }, (payload) => {
      if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
        const r = payload.new as YaraRule;
        setYaraRules(prev => {
          const i = prev.findIndex(x => String(x.id) === String(r.id));
          if (i > -1) { const n = [...prev]; n[i] = r; return n; }
          return [r, ...prev];
        });
      } else if (payload.eventType === 'DELETE') {
        const old = payload.old as { id: string | number };
        setYaraRules(prev => prev.filter(x => String(x.id) !== String(old.id)));
      }
    });

    // Subscribe to PC-CHECK records
    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'pc_checks' }, (payload) => {
      if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
        const r = payload.new as PCCheckRecord;
        setPcChecks(prev => {
          const i = prev.findIndex(x => String(x.id) === String(r.id));
          if (i > -1) { const n = [...prev]; n[i] = r; return n; }
          return [r, ...prev];
        });
      } else if (payload.eventType === 'DELETE') {
        const old = payload.old as { id: string | number };
        setPcChecks(prev => prev.filter(x => String(x.id) !== String(old.id)));
      }
    });

    // Listen for typing indicators
    channel.on('broadcast', { event: 'typing' }, (payload) => {
      const { user, ticketId } = payload.payload;
      setTypingUsers(prev => {
        const filtered = prev.filter(t => !(t.user === user && String(t.ticketId) === String(ticketId)));
        return [...filtered, { user, ticketId }];
      });
      setTimeout(() => {
        setTypingUsers(prev => prev.filter(t => !(t.user === user && String(t.ticketId) === String(ticketId))));
      }, 3000);
    });

    // Listen for new ticket notifications
    channel.on('broadcast', { event: 'new_ticket' }, (payload) => {
      const { subject, creator, ticketId } = payload.payload;
      const notif = { id: Date.now(), msg: `🎫 تذكرة جديدة من ${creator}، الرجاء الاطلاع عليها`, ticketId };
      setNotifications(prev => [...prev, notif]);
      setTimeout(() => setNotifications(prev => prev.filter(n => n.id !== notif.id)), 6000);
    });

    channel.subscribe();

    return () => {
      supabase?.removeChannel(channel);
    };
  }, []);

  // Command Palette — Ctrl+K / Cmd+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (currentUser) {
          setCommandPaletteOpen(prev => !prev);
          setCommandQuery('');
          setCommandSelectedIndex(0);
        }
      } else if (e.key === 'Escape' && commandPaletteOpen) {
        setCommandPaletteOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [currentUser, commandPaletteOpen]);

  const commandResults: SearchResult[] = useMemo(() => {
    if (!commandQuery.trim()) return [];
    return globalSearch(commandQuery, cases, bans, evidenceItems, altProfiles, preWLHacks, pcChecks);
  }, [commandQuery, cases, bans, evidenceItems, altProfiles, preWLHacks, pcChecks]);

  const navigateToSearchResult = (result: SearchResult) => {
    if (result.kind === 'case') {
      setActiveCaseId(Number(result.id));
      setActiveSec('case_tracker');
    } else if (result.kind === 'ban') {
      setActiveSec('bans');
      setBanSearchQuery(result.discordId || '');
    } else if (result.kind === 'evidence') {
      setActiveSec('investigation_hub');
      setCaseSearchQuery(result.discordId || '');
    } else if (result.kind === 'altProfile') {
      setActiveSec('intelligence_room');
      setIrSearchQuery(result.discordId || result.title);
    } else if (result.kind === 'player') {
      setActiveSec('investigation_hub');
      setCaseSearchQuery(result.discordId || '');
    } else if (result.kind === 'preWlHack') {
      setActiveSec('pre_wl_hacks');
      setPreWLSearch('');
      setPreWLFilter('all');
      const hack = preWLHacks.find(h => h.id === result.id);
      if (hack) {
        setPreWLSelected(hack);
        setPreWLView('detail');
      }
    } else if (result.kind === 'pcCheck') {
      setActiveSec('pc_check');
      setPcSearchQuery(result.title);
    }
    setCommandPaletteOpen(false);
    setCommandQuery('');
  };


  const handleLogin = async () => {
    // Rate limit check
    const rl = checkRateLimit();
    setRateLimitState(rl);
    if (rl.blocked) {
      const mins = Math.ceil(rl.lockoutLeft / 60);
      setAuthFeedback({ type: 'error', msg: `🔒 تم تجميد الحساب مؤقتاً. حاول بعد ${mins} دقيقة` });
      return;
    }

    if (!authInputs.user.trim() || !authInputs.pass.trim()) {
      setAuthFeedback({ type: 'error', msg: 'الرجاء إدخال اسم المستخدم وكلمة المرور' });
      return;
    }

    if (loginCooldown) return;
    setLoginCooldown(true);
    setAuthFeedback(null);

    try {
      // ✅ جلب أحدث البيانات — مع fallback على الـ state لو DB فشلت
      let allUsers: User[] = users;
      try {
        const freshFromDB = await getAll<User>('users');
        if (freshFromDB && freshFromDB.length > 0) {
          allUsers = freshFromDB;
          setUsers(freshFromDB);
        }
      } catch (dbErr) {
        console.warn('DB fetch failed, using state users:', dbErr);
      }

      const candidate = allUsers.find(u => u.user.trim() === authInputs.user.trim());
      let authenticated = false;
      let finalUser: User | undefined = candidate;

      if (candidate) {
        const storedPass = candidate.pass;
        const isPbkdf2 = storedPass.startsWith('pbkdf2$');

        if (isPbkdf2) {
          // كلمة مرور PBKDF2 حديثة — التحقق الصحيح
          authenticated = await verifyPasswordWithSalt(authInputs.pass, storedPass);
        } else {
          // legacy (SHA-256 قديم أو plain-text) — نتحقق ثم نرقّي فوراً
          authenticated = await legacyVerify(authInputs.pass, storedPass);
          if (authenticated) {
            try {
              const newSalt = generateSalt();
              const newHash = await hashPasswordWithSalt(authInputs.pass, newSalt);
              const upgraded = { ...candidate, pass: newHash };
              await putItem('users', upgraded);
              finalUser = upgraded;
              setUsers(prev => prev.map(u => u.user === candidate.user ? upgraded : u));
            } catch {
              finalUser = candidate;
            }
          }
        }
      }

      if (!authenticated || !finalUser) {
        recordFailedAttempt();
        const newRl = checkRateLimit();
        setRateLimitState(newRl);
        if (newRl.blocked) {
          setAuthFeedback({ type: 'error', msg: `🔒 تم تجميد الحساب لمدة 15 دقيقة بسبب المحاولات المتعددة` });
        } else {
          setAuthFeedback({ type: 'error', msg: `❌ اسم المستخدم أو كلمة المرور غير صحيحة • ${newRl.remaining} محاولة متبقية` });
        }
        return;
      }

      if (finalUser.status === 'pending') {
        setAuthFeedback({ type: 'success', msg: '⏳ الرجاء الانتظار لحين قبول طلبك من المسؤولين' });
        return;
      }

      if (finalUser.status !== 'active') {
        setAuthFeedback({ type: 'error', msg: '🚫 هذا الحساب موقوف، تواصل مع المسؤولين' });
        return;
      }

      // ✅ دخول ناجح — نتحقق من الـ role من DB قبل حفظ الجلسة
      const confirmedRole = await verifyUserRoleFromDB(finalUser.user);
      if (!confirmedRole) {
        setAuthFeedback({ type: 'error', msg: '🚫 لم يتمكن النظام من التحقق من صلاحياتك، تواصل مع المسؤولين' });
        return;
      }
      const verifiedFinalUser = { ...finalUser, role: confirmedRole as any };
      clearAttempts();
      await saveSession(verifiedFinalUser.user, verifiedFinalUser.role, rememberMe);
      setCurrentUser(verifiedFinalUser);
      setAuthInputs({ user: '', pass: '', role: UserRole.LOGS });
      setAuthFeedback(null);
      setActiveSec('home');
      if (finalUser.role !== UserRole.ADMIN) {
        setTicketViewMode('all');
      }

    } catch (unexpectedErr) {
      console.error('Login error:', unexpectedErr);
      setAuthFeedback({ type: 'error', msg: '⚠️ حدث خطأ غير متوقع، أعد المحاولة' });
    } finally {
      setLoginCooldown(false);
    }
  };

  const handleRegister = async () => {
    // تحقق من البيانات
    if (!authInputs.user.trim() || !authInputs.pass.trim()) {
      setAuthFeedback({ type: 'error', msg: '❌ الرجاء إكمال جميع البيانات' });
      return;
    }
    if (authInputs.user.trim().length < 3) {
      setAuthFeedback({ type: 'error', msg: '❌ اسم المستخدم يجب أن يكون 3 أحرف على الأقل' });
      return;
    }
    if (authInputs.pass.trim().length < 3) {
      setAuthFeedback({ type: 'error', msg: '❌ كلمة المرور يجب أن تكون 3 أحرف على الأقل' });
      return;
    }

    // تحقق من تكرار الاسم — نجيب من DB مباشرة
    let existingUsers: User[] = users;
    try {
      const fresh = await getAll<User>('users');
      if (fresh && fresh.length > 0) existingUsers = fresh;
    } catch {}

    if (existingUsers.find(u => u.user.trim() === authInputs.user.trim())) {
      setAuthFeedback({ type: 'error', msg: '❌ اسم المستخدم موجود بالفعل، اختر اسماً آخر' });
      return;
    }

    setAuthFeedback(null);

    try {
      const newSalt = generateSalt();
      const hashedPass = await hashPasswordWithSalt(authInputs.pass.trim(), newSalt);
      const newUser: User = {
        user: authInputs.user.trim(),
        pass: hashedPass,
        role: authInputs.role,
        status: 'pending'
      };

      await putItem('users', newUser);
      setUsers(prev => [...prev, newUser]);
      setRegisterSuccess(true);

      setTimeout(() => {
        setRegisterSuccess(false);
        setAuthMode('login');
        setAuthInputs({ user: '', pass: '', role: UserRole.LOGS });
        setAuthFeedback({ type: 'success', msg: '✅ تم تقديم طلبك — سجل دخولك بعد قبول المسؤولين' });
      }, 5000);

    } catch (err) {
      console.error('Register error:', err);
      setAuthFeedback({ type: 'error', msg: '⚠️ حدث خطأ أثناء التسجيل، حاول مرة أخرى' });
    }
  };

  // Profile Update
  const updateProfile = async () => {
    if (!currentUser) return;
    const { user: newUser, pass: newPass } = authInputs;
    const updatedUsers = await Promise.all(users.map(async u => {
      if (u.user === currentUser.user) {
        let updatedPass = u.pass;
        if (newPass) {
          const salt = generateSalt();
          updatedPass = await hashPasswordWithSalt(newPass, salt);
        }
        return { ...u, user: newUser || u.user, pass: updatedPass };
      }
      return u;
    }));
    const updatedMe = updatedUsers.find(u => u.user === (newUser || currentUser.user))!;
    await putItem('users', updatedMe);
    setUsers(updatedUsers);
    setCurrentUser(updatedMe);
    alert("تم التحديث!");
  };

  // User Management
  const approveUser = async (name: string) => {
    // تحقق من الصلاحية من DB مباشرة — ليس من الـ state فقط
    const actorRole = await verifyUserRoleFromDB(currentUser?.user || '');
    if (actorRole !== UserRole.MANAGER && actorRole !== UserRole.ADMIN) {
      setToast({ show: true, msg: '🚫 ليس لديك صلاحية لتنفيذ هذا الإجراء' });
      return;
    }
    const updated = users.map(u => u.user === name ? { ...u, status: 'active' as const } : u);
    setUsers(updated);
    await putItem('users', updated.find(u => u.user === name)!);
    await addAuditLog('Approve User', `Approved user account: ${name}`);
  };

  const deleteUser = async (name: string) => {
    triggerConfirm(
      "حذف مستخدم",
      `هل أنت متأكد من حذف المستخدم ${name}؟ لا يمكن التراجع عن هذا الإجراء.`,
      async () => {
        // تحقق من الصلاحية من DB قبل الحذف
        const actorRole = await verifyUserRoleFromDB(currentUser?.user || '');
        if (actorRole !== UserRole.MANAGER && actorRole !== UserRole.ADMIN) {
          setToast({ show: true, msg: '🚫 ليس لديك صلاحية لحذف المستخدمين' });
          return;
        }
        const updated = users.filter(u => u.user !== name);
        setUsers(updated);
        await deleteItem('users', name);
        if (currentUser?.user === name) setCurrentUser(null);
        await addAuditLog('Delete User', `Deleted user account: ${name}`);
      }
    );
  };

  // Ticket Handlers
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target?.result as string);
      reader.readAsDataURL(file);
    });
  };

const sendTicket = async () => {
    if (!ticketForm.subject || !ticketForm.body || !currentUser) return alert("أكمل البيانات");
    
    const initialMsg: Message = {
      sender: 'admin',
      senderName: currentUser.user,
      type: 'text',
      text: ticketForm.body,
      timestamp: Date.now()
    };

    const newTicket: Ticket = {
      id: Date.now(),
      subject: ticketForm.subject,
      creator: currentUser.user,
      category: 'logs',
      status: 'open',
      createdAt: new Date().toISOString(),
      msgs: [initialMsg]
    };

    if (ticketFile) {
      if (ticketFile.type.startsWith('video')) {
        try {
          const fileExtension = ticketFile.name.split('.').pop();
          const fileName = `ticket_${Date.now()}_${Math.floor(Math.random() * 1000)}.${fileExtension}`;
          
// 1. فحص حجم ملف التذكرة (الحد الأقصى 100 ميجابايت)
          const MAX_FILE_SIZE = 100 * 1024 * 1024;
          if (ticketFile.size > MAX_FILE_SIZE) {
            setToast({ show: true, msg: "❌ حجم ملف التذكرة كبير جداً! يرجى رفع مقطع أقل من 100 ميجابايت." });
            setTimeout(() => setToast(null), 5000);
            return;
          }

          // 2. تفعيل مؤشر التحميل
          setToast({ show: true, msg: "⏳ جاري رفع مرفقات التذكرة... يرجى الانتظار." });

          // 3. تحويل الملف إلى ArrayBuffer صلب لمنع خطأ getReader نهائياً 🚀
          const publicUrl = await uploadVideoToR2(ticketFile, fileName);

          // ✅ أضف هذين السطرين هنا فوراً لإنهاء مشكلة "جاري التحميل" المعلقة:
          setToast({ show: true, msg: "✅ تم رفع المقطع وفتح التذكرة بنجاح!" });
          setTimeout(() => setToast(null), 3000);

          newTicket.msgs.push({
            sender: 'admin',
            senderName: currentUser.user,
            type: 'video',
            url: publicUrl,
            timestamp: Date.now() + 1
          });
        } catch (storageErr: any) {
          console.error("خطأ أثناء رفع فيديو التذكرة إلى R2:", storageErr.message);
          alert("فشل رفع فيديو التذكرة: " + storageErr.message);
          return;
        }
      } else {
        const url = await fileToBase64(ticketFile);
        newTicket.msgs.push({
          sender: 'admin',
          senderName: currentUser.user,
          type: 'image',
          url,
          timestamp: Date.now() + 1
        });
      }
    }

    await putItem('tickets', newTicket);
    setTickets([newTicket, ...tickets]);

    // إشعار الفريق بالتذكرة الجديدة عبر Broadcast
    if (realtimeChannelRef.current) {
      try {
        await realtimeChannelRef.current.send({
          type: 'broadcast',
          event: 'new_ticket',
          payload: { subject: newTicket.subject, creator: currentUser.user, ticketId: newTicket.id }
        });
      } catch (e) {
        console.error('broadcast error:', e);
      }
    }

    // إرسال إشعار ديسكورد للتذكرة الجديدة
    await sendDiscordTicketNotification(newTicket.subject, currentUser.user, newTicket.id);

    setTicketForm({ subject: '', body: '' });
    setTicketFile(null);
    setTicketViewMode('my');
    setActiveTicketId(newTicket.id);
    alert("تم فتح التذكرة بنجاح ! 🎫");
  };

const sendReply = async () => {
    if ((!replyInput && !replyFile) || !activeTicketId || !currentUser) return;
    
    const tIdx = tickets.findIndex(t => String(t.id) === String(activeTicketId));
    if (tIdx === -1) return;
    
    const ticket = { ...tickets[tIdx] };
    const sender: 'admin' | 'logs' = currentUser.role === UserRole.ADMIN ? 'admin' : 'logs';

    if (replyFile) {
      if (replyFile.type.startsWith('video')) {
        try {
          const fileExtension = replyFile.name.split('.').pop();
          const fileName = `reply_${Date.now()}_${Math.floor(Math.random() * 1000)}.${fileExtension}`;
          
// 1. فحص حجم ملف الرد (الحد الأقصى 100 ميجابايت)
          const MAX_FILE_SIZE = 100 * 1024 * 1024;
          if (replyFile.size > MAX_FILE_SIZE) {
            setToast({ show: true, msg: "❌ حجم مقطع الرد كبير جداً! الحد الأقصى هو 100 ميجابايت." });
            setTimeout(() => setToast(null), 5000);
            return;
          }

          // 2. تفعيل مؤشر التحميل للرد
          setToast({ show: true, msg: "⏳ جاري رفع فيديو الرد... فضلاً انتظر ثواني." });

          // 3. تحويل ملف الرد لمنع خطأ getReader نهائياً 🚀
          const publicUrl = await uploadVideoToR2(replyFile, fileName);
          setToast({ show: true, msg: "✅ تم إرسال الرد ورفع الفيديو بنجاح!" });
          setTimeout(() => setToast(null), 3000);

          ticket.msgs.push({
            sender,
            senderName: currentUser.user,
            type: 'video',
            url: publicUrl,
            timestamp: Date.now()
          });
        } catch (storageErr: any) {
          console.error("خطأ أثناء رفع فيديو الرد إلى R2:", storageErr.message);
          alert("فشل رفع فيديو الرد: " + storageErr.message);
          return;
        }
      } else {
        const url = await fileToBase64(replyFile);
        ticket.msgs.push({
          sender,
          senderName: currentUser.user,
          type: 'image',
          url,
          timestamp: Date.now()
        });
      }
    }

    if (replyInput.trim()) {
      ticket.msgs.push({
        sender,
        senderName: currentUser.user,
        type: 'text',
        text: replyInput,
        timestamp: Date.now() + 1
      });
    }

    const newTickets = [...tickets];
    newTickets[tIdx] = ticket;
    setTickets(newTickets);
    await putItem('tickets', ticket);
    setReplyInput('');
    setReplyFile(null);
  };

  const updateTicketStatus = async (status: 'working' | 'done') => {
    if (!activeTicketId || !currentUser) return;
    
    const action = async () => {
      const tIdx = tickets.findIndex(t => String(t.id) === String(activeTicketId));
      if (tIdx === -1) return;
      
      const ticket = { ...tickets[tIdx] };
      ticket.status = status;
      
      if (status === 'working') {
        ticket.assignedTo = currentUser.user;
      }
      
      if (status === 'done') {
        ticket.closedBy = currentUser.user;
        ticket.closedAt = Date.now();
      }

      const statusText = status === 'working' ? 'قيد العمل' : 'مكتملة';
      const detailMsg = status === 'working' 
        ? `استلم التذكرة: ${currentUser.user}` 
        : `أغلق التذكرة: ${currentUser.user} (عدد الرسائل: ${ticket.msgs.length})`;

      ticket.msgs.push({
        sender: 'system',
        senderName: 'System',
        type: 'text',
        text: status === 'working' 
          ? `⚠️ تم استلام التذكرة بواسطة: ${currentUser.user}` 
          : `✅ تم إغلاق التذكرة بواسطة: ${currentUser.user}`,
        timestamp: Date.now()
      });
      
      const newTickets = [...tickets];
      newTickets[tIdx] = ticket;
      setTickets(newTickets);
      await putItem('tickets', ticket);
      await addAuditLog(`${status === 'working' ? 'Claim' : 'Close'} Ticket`, `Subject: ${ticket.subject} | ${detailMsg}`);
    };

    if (status === 'done') {
      triggerConfirm(
        "إغلاق التذكرة",
        "هل أنت متأكد من إغلاق هذه التذكرة؟ سيتم نقلها إلى قائمة الأرشيف.",
        action
      );
    } else {
      action();
    }
  };

  // Ban Handlers
  const [editingBanId, setEditingBanId] = useState<number | null>(null);

const addBan = async () => {
    if (!currentUser) return;
    if (!banForm.discordId || !banForm.reason || (banEvidenceFiles.length === 0 && !editingBanId)) {
      alert("جميع الحقول إجبارية ويجب رفع دليل واحد على الأقل!");
      return;
    }

    let evidence: BanEvidence[] = [];
    if (editingBanId) {
      const existing = bans.find(b => b.id === editingBanId);
      if (existing) evidence = [...existing.evidence];
    }

    // الرفع الذكي: فصل الفيديوهات إلى Cloudflare R2 والصور إلى Base64
    for (const file of banEvidenceFiles) {
      if (file.type.startsWith('video')) {
        try {
          const fileExtension = file.name.split('.').pop();
          const fileName = `${Date.now()}_${Math.floor(Math.random() * 1000)}.${fileExtension}`;
          
// 1. فحص حجم الملف (إذا تجاوز 100 ميجابايت نمنعه فوراً)
          const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
          if (file.size > MAX_FILE_SIZE) {
            setToast({ show: true, msg: "❌ عذراً، حجم المقطع كبير جداً! الحد الأقصى المسموح به هو 100 ميجابايت لتجنب تعليق الموقع." });
            setTimeout(() => setToast(null), 5000);
            return; // إيقاف العملية
          }

          // 2. تفعيل مؤشر التحميل الخاص بالطابع الاحترافي
          setToast({ show: true, msg: "⏳ جاري رفع مقطع الفيديو إلى التخزين السحابي... يرجى الانتظار وعدم إغلاق الصفحة." });

// 3. تحويل الملف إلى ArrayBuffer صلب لمنع خطأ getReader نهائياً 🚀
          const publicUrl = await uploadVideoToR2(file, fileName);

          // ✅ أضف هذين السطرين هنا فوراً لإنهاء مشكلة "جاري التحميل" المعلقة:
          setToast({ show: true, msg: "✅ تم تسجيل الباند ورفع المقطع بنجاح!" });
          setTimeout(() => setToast(null), 3000);

          evidence.push({
            type: 'video',
            url: publicUrl, // حفظ رابط R2 في سوبابيس
            name: file.name
          });
        } catch (storageErr: any) {
          console.error("خطأ أثناء رفع الفيديو إلى Cloudflare R2:", storageErr.message);
          alert("فشل رفع الفيديو إلى Cloudflare R2: " + storageErr.message);
          return; // إيقاف العملية لحماية السجل من الحفظ بدون الفيديو
        }
      } else {
        // إذا كان الملف صورة، يتم التعامل معه بشكل طبيعي كـ Base64 كما هو
        const url = await fileToBase64(file);
        evidence.push({
          type: 'image',
          url,
          name: file.name
        });
      }
    }

    if (editingBanId) {
      triggerConfirm(
        "تعديل السجل",
        "هل أنت متأكد من حفظ التعديلات على هذا السجل؟",
        async () => {
          const existing = bans.find(b => b.id === editingBanId);
          const newBan: Ban = {
            ...banForm,
            id: editingBanId,
            bannedBy: existing?.bannedBy || currentUser.user,
            evidence,
            createdAt: existing?.createdAt || Date.now(),
            updatedAt: Date.now(),
            updatedBy: currentUser.user
          };

          // حساب الفروقات في الحقول النصية
          const editDiff: { field: string; from: string; to: string }[] = [];
          if (existing) {
            if (existing.discordId !== banForm.discordId)
              editDiff.push({ field: 'Discord ID', from: existing.discordId, to: banForm.discordId });
            if (existing.type !== banForm.type)
              editDiff.push({ field: 'النوع', from: existing.type, to: banForm.type });
            if (existing.reason !== banForm.reason)
              editDiff.push({ field: 'السبب', from: existing.reason, to: banForm.reason });
            if ((existing.identifiers || '') !== (banForm.identifiers || ''))
              editDiff.push({ field: 'المعرفات', from: existing.identifiers || '—', to: banForm.identifiers || '—' });
          }

          // حساب تغييرات الأدلة
          const oldEvidence = existing?.evidence || [];
          const addedMedia = evidence.filter(e => !oldEvidence.some(o => o.url === e.url));
          const removedMedia = oldEvidence.filter(o => !evidence.some(e => e.url === o.url));

          await putItem('bans', newBan);
          setBans(bans.map(b => b.id === editingBanId ? newBan : b));

          const hasTextChanges = editDiff.length > 0;
          const hasMediaChanges = addedMedia.length > 0 || removedMedia.length > 0;

          if (hasTextChanges) {
            // تغييرات نصية — رسالة "تعديل باند" مع الفروقات وأي ميديا
            await addAuditLog('Edit Ban', `Edited ban record for Discord ID: ${banForm.discordId} by ${currentUser.user}`, {
              discordId: banForm.discordId,
              type: banForm.type,
              reason: banForm.reason,
              identifiers: banForm.identifiers || ''
            });
            sendDiscordLogsNotification(
              'Edit Ban',
              `Edited ban record for Discord ID: ${banForm.discordId}`,
              currentUser.user,
              { discordId: banForm.discordId, type: banForm.type, reason: banForm.reason, identifiers: banForm.identifiers || '' },
              editDiff,
              hasMediaChanges ? { added: addedMedia, removed: removedMedia } : undefined
            ).catch(() => {});
          } else if (hasMediaChanges) {
            // تغييرات ميديا فقط — رسائل منفصلة لكل عملية
            for (const added of addedMedia) {
              const addAction = added.type === 'video' ? 'Add Video Evidence' : 'Add Image Evidence';
              const addDetails = `Added ${added.type === 'video' ? 'video' : 'image'} "${added.name || 'دليل'}" to Discord ID: ${banForm.discordId}`;
              await addAuditLog(addAction, addDetails, {
                discordId: banForm.discordId, type: banForm.type,
                reason: banForm.reason, identifiers: banForm.identifiers || ''
              });
              sendDiscordLogsNotification(
                addAction, addDetails, currentUser.user,
                { discordId: banForm.discordId, type: banForm.type, reason: banForm.reason, identifiers: banForm.identifiers || '' },
                undefined,
                { added: [added], removed: [] }
              ).catch(() => {});
            }
            for (const removed of removedMedia) {
              const remAction = removed.type === 'video' ? 'Remove Video Evidence' : 'Remove Image Evidence';
              const remDetails = `Removed ${removed.type === 'video' ? 'video' : 'image'} "${removed.name || 'دليل'}" from Discord ID: ${banForm.discordId}`;
              await addAuditLog(remAction, remDetails, {
                discordId: banForm.discordId, type: banForm.type,
                reason: banForm.reason, identifiers: banForm.identifiers || ''
              });
              sendDiscordLogsNotification(
                remAction, remDetails, currentUser.user,
                { discordId: banForm.discordId, type: banForm.type, reason: banForm.reason, identifiers: banForm.identifiers || '' },
                undefined,
                { added: [], removed: [removed] }
              ).catch(() => {});
            }
          } else {
            // لا تغييرات — سجل بسيط
            await addAuditLog('Edit Ban', `No changes detected for Discord ID: ${banForm.discordId}`);
          }
          setShowBanForm(false);
          setEditingBanId(null);
          setBanForm({ discordId: '', type: 'Ban', reason: '', identifiers: '' });
          setBanEvidenceFiles([]);
          setMediaPreviews([]);
          alert("تم حفظ التعديلات!");
        }
      );
    } else {
      const newBan: Ban = {
        ...banForm,
        id: Date.now(),
        bannedBy: currentUser.user,
        evidence,
        createdAt: Date.now()
      };
      await putItem('bans', newBan);
      setBans([newBan, ...bans]);
      await addAuditLog('Add Ban', `Added new ban record for Discord ID: ${banForm.discordId}`, {
        discordId: newBan.discordId,
        type: newBan.type,
        reason: newBan.reason,
        identifiers: newBan.identifiers || ''
      });
      // إرسال إشعار ديسكورد للباند الجديد
      await sendDiscordBanNotification(newBan.discordId, newBan.type, newBan.reason, currentUser.user);
      setShowBanForm(false);
      setEditingBanId(null);
      setBanForm({ discordId: '', type: 'Ban', reason: '', identifiers: '' });
      setBanEvidenceFiles([]);
      setMediaPreviews([]);
      alert("تم تسجيل الباند ورفع الأدلة بنجاح");
    }
  };

  const removeEvidence = async (banId: number, index: number) => {
    if (!isManager) return;
    triggerConfirm(
      "حذف دليل",
      "هل أنت متأكد من حذف هذا المرفق نهائياً؟",
      async () => {
        const ban = bans.find(b => b.id === banId);
        if (!ban) return;
        const removedItem = ban.evidence[index];
        const newEv = ban.evidence.filter((_, i) => i !== index);
        const updated = { ...ban, evidence: newEv };
        await putItem('bans', updated);
        setBans(bans.map(b => b.id === banId ? updated : b));
        const itemType = removedItem?.type === 'video' ? 'video' : 'image';
        const removeAction = itemType === 'video' ? 'Remove Video Evidence' : 'Remove Image Evidence';
        const details = `Removed ${itemType} "${removedItem?.name || 'دليل'}" from Discord ID: ${ban.discordId}`;
        await addAuditLog(removeAction, details, {
          discordId: ban.discordId,
          type: ban.type,
          reason: ban.reason,
          identifiers: ban.identifiers || ''
        });
        sendDiscordLogsNotification(
          removeAction,
          details,
          currentUser!.user,
          { discordId: ban.discordId, type: ban.type, reason: ban.reason, identifiers: ban.identifiers || '' },
          undefined,
          removedItem ? { added: [], removed: [removedItem] } : undefined
        ).catch(() => {});
      }
    );
  };

  const deleteBan = async (id: number) => {
    if (!isManager) return;
    triggerConfirm(
      "حذف سجل",
      "هل أنت متأكد من حذف هذه الحالة نهائياً من النظام؟",
      async () => {
        // تحقق من الصلاحية من DB قبل الحذف
        const actorRole = await verifyUserRoleFromDB(currentUser?.user || '');
        if (actorRole !== UserRole.MANAGER && actorRole !== UserRole.ADMIN) {
          setToast({ show: true, msg: '🚫 ليس لديك صلاحية لحذف سجلات الباند' });
          return;
        }
        // جلب بيانات الباند قبل الحذف عشان نرسلها لـ Discord
        const banRecord = bans.find(b => b.id === id);
        await deleteItem('bans', id);
        setBans(bans.filter(b => b.id !== id));
        const deletedDetails = banRecord
          ? `Deleted ban — Discord ID: ${banRecord.discordId} | Type: ${banRecord.type} | Reason: ${banRecord.reason}`
          : `Deleted ban record ID: ${id}`;
        const newLog: AuditLog = {
          id: Date.now(),
          userId: currentUser!.user,
          userName: currentUser!.user,
          action: 'Delete Ban',
          details: deletedDetails,
          timestamp: Date.now()
        };
        await putItem('audit_logs', newLog);
        setAuditLogs(prev => [newLog, ...prev]);
        sendDiscordLogsNotification(
          'Delete Ban',
          deletedDetails,
          currentUser!.user,
          banRecord ? {
            discordId: banRecord.discordId,
            type: banRecord.type,
            reason: banRecord.reason,
            identifiers: banRecord.identifiers || ''
          } : undefined
        ).catch(() => {});
      }
    );
  };

  const editBan = (ban: Ban) => {
    if (!isManager) return;
    setEditingBanId(ban.id);
    setBanForm({
      discordId: ban.discordId,
      type: ban.type,
      reason: ban.reason,
      identifiers: renderIdentifiers(ban.identifiers) || ''
    });
    setBanEvidenceFiles([]);
    setMediaPreviews([]);
    setShowBanForm(true);
  };

  const filteredBans = useMemo(() => {
    const q = banSearchQuery.toLowerCase().trim();
    if (!q) return [...bans].sort((a, b) => b.createdAt - a.createdAt);
    return bans.filter(b => {
      const searchableStrings = [
        b.discordId,
        b.reason,
        b.bannedBy,
        renderIdentifiers(b.identifiers)
      ].filter(Boolean).map(s => String(s).toLowerCase());
      
      return searchableStrings.some(s => s.includes(q));
    }).sort((a, b) => b.createdAt - a.createdAt);
  }, [bans, banSearchQuery]);

  function renderIdentifiers(identifiers: any) {
    if (!identifiers) return '';
    if (typeof identifiers === 'string') return identifiers;
    
    // Fallback for legacy object format
    return Object.entries(identifiers)
      .filter(([_, val]) => val)
      .map(([key, val]) => `${key}: (${val})`)
      .join('\n');
  }

  const copyFullInfo = (ban: Ban) => {
    const text = `
Discord ID: ${ban.discordId}
--- Identifiers ---
${renderIdentifiers(ban.identifiers)}
    `.trim();
    navigator.clipboard.writeText(text);
    alert('تم نسخ جميع المعلومات!');
  };

  const copyField = (field: string, value: string) => {
    navigator.clipboard.writeText(value);
    alert(`تم نسخ ${field}!`);
  };

  const formatDate = (ts: number | string | Date) => {
    if (!ts) return '';
    const date = new Date(ts);
    const d = String(date.getDate()).padStart(2, '0');
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const y = date.getFullYear();
    
    const timePart = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }).format(date);
    
    return `${d}/${m}/${y} - ${timePart}`;
  };

  // Permission Helpers
  const isManager = currentUser?.role === UserRole.MANAGER;
  const isLogs = currentUser?.role === UserRole.LOGS;
  const isStaff = isManager || isLogs;
  const unclaimedCount = isStaff ? tickets.filter(t => t.status === 'open' && !t.assignedTo).length : 0;

  // --- NEW FEATURES LOGIC ---
  
  // Stats Calculation
  const stats = useMemo(() => {
    if (!currentUser) return null;
    
    // For specific user (or all if manager)
    const userTickets = tickets.filter(t => t.assignedTo === currentUser.user || t.closedBy === currentUser.user);
    const userBans = bans.filter(b => b.bannedBy === currentUser.user);
    
    // Overall Stats for Leaderboard
    const allStats = users.filter(u => u.role !== UserRole.ADMIN).map(u => {
      const uTickets = tickets.filter(t => (t.assignedTo === u.user || t.closedBy === u.user) && t.status === 'done');
      const uBans = bans.filter(b => b.bannedBy === u.user);
      return {
        user: u.user,
        tickets: uTickets.length,
        bans: uBans.length,
        total: uTickets.length + uBans.length
      };
    }).sort((a,b) => b.total - a.total);

    return {
      personal: {
        tickets: tickets.filter(t => t.closedBy === currentUser.user).length,
        pendingTickets: tickets.filter(t => t.assignedTo === currentUser.user && t.status === 'working').length,
        bans: userBans.length,
        activity: Math.min(100, (userTickets.length + userBans.length) * 5), // Mock percentage
        efficiency: userTickets.length > 0 ? Math.round((tickets.filter(t => t.closedBy === currentUser.user).length / userTickets.length) * 100) : 0
      },
      leaderboard: allStats
    };
  }, [currentUser, tickets, bans, users]);

  // Notepad Logic
  const [noteForm, setNoteForm] = useState({ title: '', content: '', category: 'عام' });
  const [noteSearch, setNoteSearch] = useState('');
  const [editingNoteId, setEditingNoteId] = useState<number | null>(null);

  const saveNote = async () => {
    if (!currentUser || (!noteForm.title && !noteForm.content)) return;
    
    const newNote: PersonalNote = {
      id: editingNoteId || Date.now(),
      userId: currentUser.user,
      title: noteForm.title || 'بدون عنوان',
      content: noteForm.content,
      category: noteForm.category,
      isPinned: personalNotes.find(n => n.id === editingNoteId)?.isPinned || false,
      createdAt: personalNotes.find(n => n.id === editingNoteId)?.createdAt || Date.now(),
      updatedAt: Date.now()
    };

    await putItem('personal_notes', newNote);
    if (editingNoteId) {
      setPersonalNotes(personalNotes.map(n => n.id === editingNoteId ? newNote : n));
    } else {
      setPersonalNotes([newNote, ...personalNotes]);
      setEditingNoteId(newNote.id);
    }
  };

  // Auto-save effect
  useEffect(() => {
    const timer = setTimeout(() => {
      if (editingNoteId || (noteForm.title || noteForm.content)) {
        saveNote();
      }
    }, 1000);
    return () => clearTimeout(timer);
  }, [noteForm]);

  const deleteNote = async (id: number) => {
    await deleteItem('personal_notes', id);
    setPersonalNotes(personalNotes.filter(n => n.id !== id));
    if (editingNoteId === id) {
      setEditingNoteId(null);
      setNoteForm({ title: '', content: '', category: 'عام' });
    }
  };

  const togglePinNote = async (id: number) => {
    const note = personalNotes.find(n => n.id === id);
    if (!note) return;
    const updated = { ...note, isPinned: !note.isPinned, updatedAt: Date.now() };
    await putItem('personal_notes', updated);
    setPersonalNotes(personalNotes.map(n => n.id === id ? updated : n));
  };

  const copyDiscordMention = (text: string) => {
    const idRegex = /(\d{17,19})/g;
    const transformedText = text.replace(idRegex, '<@$1>');
    
    navigator.clipboard.writeText(transformedText).then(() => {
      setToast({ show: true, msg: "Discord Mentions Copied Successfully" });
      setTimeout(() => setToast(null), 3000);
    });
  };

  const [loadingTicket, setLoadingTicket] = useState(false);

  const openTicketModal = (t: Ticket) => {
    setLoadingTicket(true);
    setTimeout(() => {
      setSelectedTicketForModal(t);
      setLoadingTicket(false);
    }, 600);
  };

  const renderHighlightedText = (content: string) => {
    if (!content) return null;
    const discordRegex = /(<@\d{17,19}>|\b\d{17,19}\b)/g;
    const parts = content.split(discordRegex);
    return parts.map((part, index) => {
      const isMention = part.startsWith('<@') && part.endsWith('>');
      const isRawId = /^\d{17,19}$/.test(part);
      if (isMention) {
        return (
          <span key={index} className="text-orange bg-orange/10 px-2 py-0.5 rounded-lg border border-orange/35 font-mono inline-block font-black shadow-[0_0_15px_rgba(255,106,0,0.15)] select-all tracking-wide">
            {part}
          </span>
        );
      } else if (isRawId) {
        return (
          <span key={index} className="text-orange bg-orange/15 px-2 py-0.5 rounded-lg border border-orange/40 font-mono inline-block font-black shadow-[0_0_15px_rgba(255,106,0,0.15)] select-all tracking-wide">
            &lt;@{part}&gt;
          </span>
        );
      }
      return <span key={index}>{part}</span>;
    });
  };

  const copyFullNoteContent = (text: string) => {
    if (!text) return;
    const normalized = text.replace(/<@(\d{17,19})>/g, '$1');
    const fullyTransformed = normalized.replace(/(\d{17,19})/g, '<@$1>');

    navigator.clipboard.writeText(fullyTransformed).then(() => {
      setToast({ show: true, msg: "Full Note Copied & Formatted Successfully" });
      setTimeout(() => setToast(null), 3000);
    });
  };

  const openMemberNotesModal = (member: User) => {
    setIsLoadingMemberNotes(true);
    setSelectedMemberForNotes(member);
    setTimeout(() => {
      setIsLoadingMemberNotes(false);
    }, 600);
  };

  // ═══════════════════════════════════════════════════════
  //  INTELLIGENCE ROOM — Handlers
  // ═══════════════════════════════════════════════════════

  const irFindProfile = (query: string): AltProfile | null => {
    const q = query.trim();
    if (!q) return null;
    return altProfiles.find(p =>
      p.primaryId === q || p.linkedIds.includes(q)
    ) || null;
  };

  const irSaveProfile = async () => {
    if (!currentUser) return;
    const isEdit = irEditId !== null;
    const old = isEdit ? altProfiles.find(p => p.id === irEditId) : null;

    // Logs Team: يقدر يضيف ملف جديد، ويعدّل فقط الملفات اللي أضافها هو
    // Manager: صلاحية كاملة بدون قيود
    if (isEdit && !isManager && old?.createdBy !== currentUser.user) {
      setToast({ show: true, msg: '🔒 تقدر تعدّل فقط الملفات اللي أضفتها أنت' });
      setTimeout(() => setToast(null), 3000);
      return;
    }
    if (!irForm.primaryId.trim()) {
      setToast({ show: true, msg: '❌ الرجاء إدخال Discord ID الأساسي' });
      setTimeout(() => setToast(null), 3000);
      return;
    }
    const linkedArr = irForm.linkedIds.split(/[\n,\s]+/).map(s => s.trim()).filter(Boolean);
    const now = Date.now();

    const profile: AltProfile = {
      id: isEdit ? irEditId! : now,
      primaryId: irForm.primaryId.trim(),
      primaryName: irForm.primaryName.trim() || undefined,
      linkedIds: linkedArr,
      notes: irForm.notes.trim() || undefined,
      createdBy: old?.createdBy || currentUser.user,
      createdAt: old?.createdAt || now,
      updatedAt: now,
    };
    await putItem('alt_profiles', profile);
    setAltProfiles(prev => {
      const i = prev.findIndex(p => p.id === profile.id);
      if (i > -1) { const n = [...prev]; n[i] = profile; return n; }
      return [profile, ...prev];
    });
    const action = isEdit ? 'IR: Edit Profile' : 'IR: Create Profile';
    const details = isEdit
      ? `Edited alt profile — Primary: ${profile.primaryId} | Before: ${JSON.stringify({ primaryId: old?.primaryId, linkedIds: old?.linkedIds })} | After: ${JSON.stringify({ primaryId: profile.primaryId, linkedIds: profile.linkedIds })}`
      : `Created alt profile — Primary: ${profile.primaryId} | Linked IDs: [${linkedArr.join(', ')}]`;
    await addAuditLog(action, details);
    setIrShowForm(false);
    setIrEditId(null);
    setIrForm({ primaryId: '', primaryName: '', linkedIds: '', notes: '' });
    setToast({ show: true, msg: isEdit ? '✅ تم تحديث الملف' : '✅ تم إنشاء الملف' });
    setTimeout(() => setToast(null), 3000);
  };

  const irEditProfile = (p: AltProfile) => {
    setIrEditId(p.id);
    setIrForm({ primaryId: p.primaryId, primaryName: p.primaryName || '', linkedIds: p.linkedIds.join('\n'), notes: p.notes || '' });
    setIrShowForm(true);
    setIrLinkedInput('');
  };

  const irDeleteProfile = async (id: number) => {
    if (!currentUser) return;
    if (!isManager) {
      setToast({ show: true, msg: '🔒 صلاحية الإدارة فقط — لا يمكن لرتبة Logs Team الحذف هنا' });
      setTimeout(() => setToast(null), 3000);
      return;
    }
    const p = altProfiles.find(x => x.id === id);
    await deleteItem('alt_profiles', id);
    setAltProfiles(prev => prev.filter(x => x.id !== id));
    await addAuditLog('IR: Delete Profile', `Deleted alt profile — Primary: ${p?.primaryId} | Linked: [${p?.linkedIds?.join(', ')}]`);
    setToast({ show: true, msg: '🗑️ تم حذف الملف' });
    setTimeout(() => setToast(null), 2500);
  };

  const irAddLinkedId = async (profileId: number, newId: string) => {
    const p = altProfiles.find(x => x.id === profileId);
    if (!p) return;
    if (!isManager && p.createdBy !== currentUser?.user) {
      setToast({ show: true, msg: '🔒 تقدر تعدّل فقط الملفات اللي أضفتها أنت' });
      setTimeout(() => setToast(null), 2500);
      return;
    }
    if (!newId.trim()) return;
    if (p.linkedIds.includes(newId.trim())) {
      setToast({ show: true, msg: '⚠️ هذا الـ ID مضاف مسبقاً' });
      setTimeout(() => setToast(null), 2500);
      return;
    }
    const updated = { ...p, linkedIds: [...p.linkedIds, newId.trim()], updatedAt: Date.now() };
    await putItem('alt_profiles', updated);
    setAltProfiles(prev => prev.map(x => x.id === profileId ? updated : x));
    await addAuditLog('IR: Add Linked ID', `Added linked ID ${newId.trim()} to profile Primary: ${p.primaryId}`);
  };

  const irRemoveLinkedId = async (profileId: number, removeId: string) => {
    const p = altProfiles.find(x => x.id === profileId);
    if (!p) return;
    if (!isManager && p.createdBy !== currentUser?.user) {
      setToast({ show: true, msg: '🔒 تقدر تعدّل فقط الملفات اللي أضفتها أنت' });
      setTimeout(() => setToast(null), 2500);
      return;
    }
    const updated = { ...p, linkedIds: p.linkedIds.filter(id => id !== removeId), updatedAt: Date.now() };
    await putItem('alt_profiles', updated);
    setAltProfiles(prev => prev.map(x => x.id === profileId ? updated : x));
    await addAuditLog('IR: Remove Linked ID', `Removed linked ID ${removeId} from profile Primary: ${p.primaryId}`);
  };

  // ═══════════════════════════════════════════════════════
  //  YARA RULES — Handlers
  // ═══════════════════════════════════════════════════════

  const yaraSave = async () => {
    if (!currentUser) return;
    const isEdit = yaraEditId !== null;
    const old = isEdit ? yaraRules.find(r => r.id === yaraEditId) : null;

    // Logs Team: يقدر يضيف قاعدة جديدة، ويعدّل فقط القواعد اللي أضافها هو
    // Manager: صلاحية كاملة بدون قيود
    if (isEdit && !isManager && old?.addedBy !== currentUser.user) {
      setToast({ show: true, msg: '🔒 تقدر تعدّل فقط القواعد اللي أضفتها أنت' });
      setTimeout(() => setToast(null), 3000);
      return;
    }
    if (!yaraForm.name.trim() || !yaraForm.rule.trim()) {
      setToast({ show: true, msg: '❌ الرجاء إدخال اسم القاعدة ونصها' });
      setTimeout(() => setToast(null), 3000);
      return;
    }
    const tagsArr = yaraForm.tags.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
    const now = Date.now();

    const rule: YaraRule = {
      id: isEdit ? yaraEditId! : now,
      name: yaraForm.name.trim(),
      description: yaraForm.description.trim(),
      rule: yaraForm.rule,
      tags: tagsArr,
      addedBy: old?.addedBy || currentUser.user,
      createdAt: old?.createdAt || now,
      updatedAt: now,
    };
    await putItem('yara_rules', rule);
    setYaraRules(prev => {
      const i = prev.findIndex(r => r.id === rule.id);
      if (i > -1) { const n = [...prev]; n[i] = rule; return n; }
      return [rule, ...prev];
    });
    const action = isEdit ? 'YARA: Edit Rule' : 'YARA: Add Rule';
    const details = isEdit
      ? `Edited YARA rule "${rule.name}" | Before name: ${old?.name}`
      : `Added new YARA rule: "${rule.name}" | Tags: [${tagsArr.join(', ')}]`;
    await addAuditLog(action, details);
    setYaraShowForm(false);
    setYaraEditId(null);
    setYaraForm({ name: '', description: '', rule: '', tags: '' });
    setToast({ show: true, msg: isEdit ? '✅ تم تحديث القاعدة' : '✅ تمت إضافة القاعدة' });
    setTimeout(() => setToast(null), 3000);
  };

  const yaraDelete = async (id: number) => {
    if (!isManager) {
      setToast({ show: true, msg: '🔒 صلاحية الإدارة فقط — لا يمكن لرتبة Logs Team الحذف هنا' });
      setTimeout(() => setToast(null), 3000);
      return;
    }
    const r = yaraRules.find(x => x.id === id);
    await deleteItem('yara_rules', id);
    setYaraRules(prev => prev.filter(x => x.id !== id));
    await addAuditLog('YARA: Delete Rule', `Deleted YARA rule: "${r?.name}"`);
    setToast({ show: true, msg: '🗑️ تم حذف القاعدة' });
    setTimeout(() => setToast(null), 2500);
  };

  const yaraCopy = async (rule: YaraRule) => {
    await navigator.clipboard.writeText(rule.rule);
    setYaraCopied(rule.id);
    setTimeout(() => setYaraCopied(null), 2000);
    await addAuditLog('YARA: Copy Rule', `Copied YARA rule: "${rule.name}"`);
  };

  // ═══════════════════════════════════════════════════════
  //  PC-CHECK — Hardware Fingerprint (HWID) Check Records
  // ═══════════════════════════════════════════════════════

  const pcSaveCheck = async () => {
    if (!currentUser) return;
    const isEdit = pcEditId !== null;
    const old = isEdit ? pcChecks.find(c => c.id === pcEditId) : null;

    // Logs Team: يضيف سجل جديد، ويعدّل فقط السجلات اللي أضافها هو
    // Manager: صلاحية كاملة بدون قيود
    if (isEdit && !isManager && old?.checkedBy !== currentUser.user) {
      setToast({ show: true, msg: '🔒 تقدر تعدّل فقط السجلات اللي أضفتها أنت' });
      setTimeout(() => setToast(null), 3000);
      return;
    }
    if (!pcForm.player.trim()) {
      setToast({ show: true, msg: '❌ الرجاء إدخال اسم اللاعب' });
      setTimeout(() => setToast(null), 3000);
      return;
    }
    const now = Date.now();
    const record: PCCheckRecord = {
      id: isEdit ? pcEditId! : now,
      player: pcForm.player.trim(),
      isCheater: pcForm.isCheater,
      pin: pcForm.pin.trim(),
      hwid: pcForm.hwid.trim(),
      notes: pcForm.notes.trim() || undefined,
      checkedBy: old?.checkedBy || currentUser.user,
      createdAt: old?.createdAt || now,
      updatedAt: now,
    };
    await putItem('pc_checks', record);
    setPcChecks(prev => {
      const i = prev.findIndex(c => c.id === record.id);
      if (i > -1) { const n = [...prev]; n[i] = record; return n; }
      return [record, ...prev];
    });
    const action = isEdit ? 'PC-CHECK: Edit Record' : 'PC-CHECK: Add Record';
    const details = isEdit
      ? `Edited PC-CHECK record for player "${record.player}" | HWID: ${record.hwid || '—'}`
      : `Added PC-CHECK record for player "${record.player}" | Cheater: ${record.isCheater ? 'Yes' : 'No'} | HWID: ${record.hwid || '—'}`;
    await addAuditLog(action, details);
    setPcShowForm(false);
    setPcEditId(null);
    setPcForm({ player: '', isCheater: false, pin: '', hwid: '', notes: '' });
    setToast({ show: true, msg: isEdit ? '✅ تم تحديث السجل' : '✅ تم حفظ سجل الفحص' });
    setTimeout(() => setToast(null), 3000);
  };

  const pcDeleteCheck = async (id: number) => {
    if (!isManager) {
      setToast({ show: true, msg: '🔒 صلاحية الإدارة فقط — لا يمكن لرتبة Logs Team الحذف هنا' });
      setTimeout(() => setToast(null), 3000);
      return;
    }
    triggerConfirm(
      'حذف سجل الفحص',
      'هل أنت متأكد من حذف هذا السجل نهائياً؟',
      async () => {
        const r = pcChecks.find(c => c.id === id);
        await deleteItem('pc_checks', id);
        setPcChecks(prev => prev.filter(c => c.id !== id));
        await addAuditLog('PC-CHECK: Delete Record', `Deleted PC-CHECK record for player "${r?.player}"`);
        setToast({ show: true, msg: '🗑️ تم حذف السجل' });
        setTimeout(() => setToast(null), 2500);
      }
    );
  };

  const pcStartEdit = (r: PCCheckRecord) => {
    setPcEditId(r.id);
    setPcForm({ player: r.player, isCheater: r.isCheater, pin: r.pin, hwid: r.hwid, notes: r.notes || '' });
    setPcShowForm(true);
  };

  const filteredPcChecks = useMemo(() => {
    const q = pcSearchQuery.toLowerCase().trim();
    return pcChecks
      .filter(r => pcFilter === 'all' || (pcFilter === 'cheaters' ? r.isCheater : !r.isCheater))
      .filter(r => !q || `${r.player} ${r.pin} ${r.hwid} ${r.notes || ''}`.toLowerCase().includes(q))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [pcChecks, pcSearchQuery, pcFilter]);

  const addAuditLog = async (
    action: string,
    details: string,
    banData?: { discordId: string; type: string; reason: string; identifiers?: string }
  ) => {
    if (!currentUser) return;
    const newLog: AuditLog = {
      id: Date.now(),
      userId: currentUser.user,
      userName: currentUser.user,
      action,
      details,
      timestamp: Date.now()
    };
    await putItem('audit_logs', newLog);
    setAuditLogs(prev => [newLog, ...prev]);
    // إرسال إشعار Discord عبر Webhook الـ Logs
    sendDiscordLogsNotification(action, details, currentUser.user, banData).catch(() => {});
  };

  // ═══════════════════════════════════════════════════════
  //  PRE-WL HACKS — Handlers
  // ═══════════════════════════════════════════════════════

  const parsePreWLRaw = (raw: string) => {
    const lines = raw.split('\n').map((l: string) => l.trim()).filter(Boolean);
    let playerName = '';
    const licenses: string[]  = [];
    const steams: string[]    = [];
    const discords: string[]  = [];
    let xbl = '', liveId = '', ip = '';

    // ─── مفاتيح الاسم ───
    const NAME_KEYS = [
      'اسم اللاعب', 'اسم_اللاعب', 'اسم',
      'name', 'player', 'playername', 'player name', 'player_name',
    ];

    // ─── مفاتيح المعرفات ───
    const ID_KEYS = ['license', 'license2', 'steam', 'discord', 'xbl', 'liveid', 'live', 'ip', 'hwid'];

    // ─── استخراج القيمة (LTR) ───
    const extractLTR = (line: string, key: string): string => {
      // داخل أقواس: key:(key:value)
      const inParens = line.match(new RegExp(`${key}\\s*:[^(]*\\(${key}:([^)]+)\\)`, 'i'));
      if (inParens) return inParens[1].trim();
      // مباشر: key:value
      const direct = line.match(new RegExp(`${key}\\s*:\\s*([^(\\s][^\\s]*)`, 'i'));
      if (direct) return direct[1].trim();
      return '';
    };

    // ─── استخراج القيمة (RTL — القيمة يسار، المفتاح يمين) ───
    const extractRTL = (line: string, key: string): string => {
      const m = line.match(new RegExp(`^(.+?)\\s*:\\s*${key}\\s*$`, 'i'));
      if (m) return m[1].trim();
      return '';
    };

    const extractAny = (line: string, key: string): string =>
      extractLTR(line, key) || extractRTL(line, key);

    // ─── هل السطر يبدأ أو ينتهي بمفتاح معروف؟ ───
    const hasKey = (line: string, keys: string[]): boolean => {
      const l = line.toLowerCase();
      return keys.some(k => {
        const kl = k.toLowerCase();
        return l.startsWith(kl + ':') || l.startsWith(kl + ' :') ||
               l.endsWith(':' + kl) || l.endsWith(': ' + kl) || l.endsWith(' :' + kl);
      });
    };

    // ─── استخراج اسم اللاعب من سطره الصريح ───
    const extractName = (line: string): string => {
      for (const k of NAME_KEYS) {
        const ltr = line.match(new RegExp(`^${k}\\s*:\\s*(.+)$`, 'i'));
        if (ltr) return ltr[1].trim();
        const rtl = line.match(new RegExp(`^(.+?)\\s*:\\s*${k}\\s*$`, 'i'));
        if (rtl) return rtl[1].trim();
      }
      return '';
    };

    const isIdLine   = (line: string) => hasKey(line, ID_KEYS);
    const isNameLine = (line: string) => hasKey(line, NAME_KEYS);

    const looksLikeName = (line: string): boolean => {
      if (!line || line.length < 2) return false;
      if (/^https?:\/\//i.test(line)) return false;
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(line)) return false;
      if (/^\d{10,}$/.test(line)) return false;
      if (isIdLine(line) || isNameLine(line)) return false;
      if (!line.includes(':')) return true;
      return line.split(':')[0].trim().length > 15;
    };

    for (const line of lines) {
      const lower = line.toLowerCase();

      // ── اسم اللاعب (صريح) ──
      if (!playerName && isNameLine(line)) {
        playerName = extractName(line);
      }
      // ── License / License2 / licenseN — كلها تُجمع ──
      else if (
        (lower.match(/^license\d*\s*:/) || lower.match(/^license\d*\s*\(/) || lower.match(/:license\d*\s*$/)) &&
        !lower.startsWith('steam')
      ) {
        // استخرج بـ license أولاً ثم license2 إذا فشل
        const val = extractLTR(line, 'license2') || extractLTR(line, 'license') ||
                    extractRTL(line, 'license2') || extractRTL(line, 'license');
        if (val && !licenses.includes(val)) licenses.push(val);
      }
      // ── Steam — يجمع كل الـ steams ──
      else if (lower.includes('steam:') || lower.includes(':steam')) {
        const val = extractAny(line, 'steam');
        if (val && !steams.includes(val)) steams.push(val);
      }
      // ── Discord — يجمع حتى 10 ──
      else if ((lower.includes('discord:') || lower.includes(':discord')) && discords.length < 10) {
        const val = extractAny(line, 'discord');
        if (val && !discords.includes(val)) discords.push(val);
      }
      // ── XBL ──
      else if (!xbl && (lower.includes('xbl:') || lower.includes(':xbl'))) {
        xbl = extractAny(line, 'xbl');
      }
      // ── LiveID ──
      else if (!liveId && (lower.includes('liveid:') || lower.includes(':liveid') || lower.startsWith('live:') || lower.endsWith(':live'))) {
        liveId = extractAny(line, 'liveid') || extractAny(line, 'live');
      }
      // ── IP ──
      else if (!ip && (lower.startsWith('ip:') || lower.endsWith(':ip'))) {
        ip = extractAny(line, 'ip');
      }
      // ── اسم ضمني ──
      else if (!playerName && looksLikeName(line)) {
        playerName = line;
      }
    }

    // Fallback للاسم
    if (!playerName) {
      for (const line of lines) {
        if (!isIdLine(line) && !isNameLine(line) && line.length > 1) {
          playerName = line; break;
        }
      }
    }

    return {
      playerName,
      license:  licenses[0]  || '',
      license2: licenses[1]  || '',
      licenses,
      steam:    steams[0]    || '',
      steams,
      discord:  discords[0]  || '',
      discords,
      xbl,
      liveId,
      ip,
    };
  };

  const preWLSave = async () => {
  if (!currentUser) return;
  if (!preWLForm.rawText.trim() || !preWLForm.bannedFrom.trim()) return;

  const parsed = parsePreWLRaw(preWLForm.rawText);
  const isEdit = preWLEditId !== null;
  const existing = isEdit ? preWLHacks.find(h => h.id === preWLEditId) : null;
  const now = Date.now();

  const entry = {
    action: isEdit ? 'تعديل السجل' : 'إنشاء السجل',
    by: currentUser.user,
    byRole: currentUser.role,
    at: now,
    old: isEdit ? existing?.rawText : undefined,
    new: preWLForm.rawText,
  };

  // ─── payload لـ Supabase (snake_case، بدون id عند الإضافة) ──────────
  const supabasePayload: Record<string, any> = {
    raw_text: preWLForm.rawText,
    player_name: parsed.playerName,
    license: parsed.license,
    license2: parsed.license2,
    licenses: JSON.stringify(parsed.licenses),
    steam: parsed.steam,
    steams: JSON.stringify(parsed.steams),
    discord: parsed.discord,
    discords: JSON.stringify(parsed.discords),
    xbl: parsed.xbl,
    live_id: parsed.liveId,
    ip: parsed.ip,
    banned_from: preWLForm.bannedFrom,
    hack_active: preWLForm.hackActive === 'yes',
    image_base64: preWLForm.imageBase64 || (isEdit ? existing?.imageBase64 : ''),
    created_by: isEdit ? (existing?.createdBy || currentUser.user) : currentUser.user,
    created_by_role: isEdit ? (existing?.createdByRole || currentUser.role) : currentUser.role,
    updated_by: currentUser.user,
    updated_by_role: currentUser.role,
    updated_at: new Date(now).toISOString(),
    timeline: JSON.stringify([...(existing?.timeline || []), entry]),
  };

  // عند الإضافة — Supabase يولّد id و created_at تلقائياً
  // عند التعديل — نرسل id فقط
  if (isEdit) {
    supabasePayload.id = preWLEditId;
  }

  // ─── حفظ في Supabase ────────────────────────────────────────────────
  const client = getSupabaseWithUser();
  let savedId = isEdit ? preWLEditId! : now;

  if (client) {
    try {
      if (isEdit) {
        const { error } = await client
          .from('pre_wl_hacks')
          .update(supabasePayload)
          .eq('id', preWLEditId);
        if (error) throw new Error(error.message);
      } else {
        const { data, error } = await client
          .from('pre_wl_hacks')
          .insert(supabasePayload)
          .select('id, created_at')
          .single();
        if (error) throw new Error(error.message);
        savedId = data.id;
      }
    } catch (e: any) {
      console.error('Supabase preWLSave error:', e.message);
      // fallback لـ IndexedDB
      await putItem('pre_wl_hacks', { ...supabasePayload, id: now });
    }
  } else {
    await putItem('pre_wl_hacks', { ...supabasePayload, id: now });
  }

  // ─── تحديث الـ state المحلي ──────────────────────────────────────────
  const localHack: PreWLHack = {
    id: savedId,
    rawText: preWLForm.rawText,
    playerName: parsed.playerName,
    license: parsed.license,
    license2: parsed.license2,
    licenses: parsed.licenses,
    steam: parsed.steam,
    steams: parsed.steams,
    discord: parsed.discord,
    discords: parsed.discords,
    xbl: parsed.xbl,
    liveId: parsed.liveId,
    ip: parsed.ip,
    bannedFrom: preWLForm.bannedFrom,
    hackActive: preWLForm.hackActive,
    imageBase64: preWLForm.imageBase64 || (isEdit ? existing?.imageBase64 : ''),
    createdBy: isEdit ? (existing?.createdBy || currentUser.user) : currentUser.user,
    createdByRole: isEdit ? (existing?.createdByRole || currentUser.role) : currentUser.role,
    createdAt: isEdit ? (existing?.createdAt || now) : now,
    updatedBy: currentUser.user,
    updatedByRole: currentUser.role,
    updatedAt: now,
    timeline: [...(existing?.timeline || []), entry],
  };

  setPreWLHacks(prev =>
    isEdit ? prev.map(h => h.id === localHack.id ? localHack : h) : [localHack, ...prev]
  );

  await addAuditLog(
    isEdit ? 'Pre-WL: تعديل سجل' : 'Pre-WL: إضافة سجل',
    `اللاعب: ${parsed.playerName || 'غير معروف'} | سيرفر: ${preWLForm.bannedFrom} | الهاك: ${preWLForm.hackActive === 'yes' ? 'متفعل' : 'غير متفعل'}`
  );

  setPreWLForm({ rawText: '', bannedFrom: '', hackActive: 'yes', imageBase64: '' });
  setPreWLEditId(null);
  setPreWLShowForm(false);
  setToast({ show: true, msg: isEdit ? '✅ تم تحديث السجل' : '✅ تم حفظ السجل' });
  setTimeout(() => setToast(null), 3000);
};

  const preWLDelete = async (id: number) => {
    if (!isManager) {
      setToast({ show: true, msg: '🔒 صلاحية الإدارة فقط — لا يمكن لرتبة Logs Team الحذف' });
      setTimeout(() => setToast(null), 3000);
      return;
    }
    triggerConfirm('حذف السجل', 'هل أنت متأكد من حذف هذا السجل نهائياً؟', async () => {
      const hack = preWLHacks.find(h => h.id === id);
      await deleteItem('pre_wl_hacks', id);
      setPreWLHacks(prev => prev.filter(h => h.id !== id));
      if (preWLSelected?.id === id) { setPreWLSelected(null); setPreWLView('list'); }
      await addAuditLog('Pre-WL: حذف سجل', `اللاعب: ${hack?.playerName || 'غير معروف'} | سيرفر: ${hack?.bannedFrom}`);
      setToast({ show: true, msg: '🗑️ تم حذف السجل' });
      setTimeout(() => setToast(null), 2500);
    });
  };

  const preWLStartEdit = (hack: PreWLHack) => {
    setPreWLForm({ rawText: hack.rawText, bannedFrom: hack.bannedFrom, hackActive: hack.hackActive, imageBase64: hack.imageBase64 || '' });
    setPreWLEditId(hack.id);
    setPreWLShowForm(true);
  };

  const preWLCopyAll = async (hack: PreWLHack) => {
    await navigator.clipboard.writeText(hack.rawText);
    setPreWLCopied('all-' + hack.id);
    setTimeout(() => setPreWLCopied(null), 2000);
    await addAuditLog('Pre-WL: نسخ بيانات', `اللاعب: ${hack.playerName || 'غير معروف'}`);
  };

  const preWLCopyField = async (hackId: number, field: string, value: string) => {
    await navigator.clipboard.writeText(value);
    setPreWLCopied(field + '-' + hackId);
    setTimeout(() => setPreWLCopied(null), 2000);
  };

  const preWLImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setPreWLForm(f => ({ ...f, imageBase64: reader.result as string }));
    reader.readAsDataURL(file);
  };

  const preWLFiltered = useMemo(() => {
    const q = preWLSearch.toLowerCase().trim();
    return preWLHacks
      .filter(h => preWLFilter === 'all' || (preWLFilter === 'active' ? h.hackActive === 'yes' : h.hackActive === 'no'))
      .filter(h => !q || [h.playerName, ...(h.licenses||[h.license,h.license2]), ...(h.steams||[h.steam]), ...(h.discords||[h.discord]), h.xbl, h.liveId, h.ip, h.bannedFrom].some(v => v?.toLowerCase().includes(q)))
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [preWLHacks, preWLSearch, preWLFilter]);


  // ═══════════════════════════════════════════════════════
  //  INVESTIGATION HUB / CASE TRACKER — Handlers
  // ═══════════════════════════════════════════════════════

  const getCaseRisk = (discordId: string): RiskAssessment =>
    calculateRiskAssessment(discordId, cases, bans, evidenceItems);

  const createCase = async () => {
    if (!currentUser) return;
    if (!newCaseForm.discordId.trim() || !newCaseForm.title.trim()) {
      setToast({ show: true, msg: '❌ الرجاء إدخال Discord ID وعنوان ملف على الأقل' });
      setTimeout(() => setToast(null), 3500);
      return;
    }
    const risk = getCaseRisk(newCaseForm.discordId.trim());
    const now = Date.now();
    const firstEvent: CaseEvent = {
      id: now,
      type: 'created',
      text: `تم فتح ملف بواسطة ${currentUser.user}`,
      by: currentUser.user,
      timestamp: now,
    };
    const newCase: InvestigationCase = {
      id: now,
      discordId: newCaseForm.discordId.trim(),
      playerName: newCaseForm.playerName.trim() || undefined,
      title: newCaseForm.title.trim(),
      status: 'open',
      riskLevel: risk.level,
      riskScore: risk.score,
      summary: newCaseForm.summary.trim() || 'بدون ملخص مبدئي — يُحدَّث أثناء التحقيق.',
      suggestedAction: risk.suggestedAction,
      evidenceIds: [],
      createdBy: currentUser.user,
      createdAt: now,
      updatedAt: now,
      timeline: [firstEvent],
    };
    await putItem('cases', newCase);
    setCases(prev => [newCase, ...prev]);
    await addAuditLog('Open Case', `فتح ملف جديدة برقم #${newCase.id} للاعب ${newCase.discordId}: ${newCase.title}`);
    setShowNewCaseForm(false);
    setNewCaseForm({ discordId: '', playerName: '', title: '', summary: '' });
    setActiveCaseId(newCase.id);
    setActiveSec('case_tracker');
    setToast({ show: true, msg: '✅ تم فتح ملف بنجاح' });
    setTimeout(() => setToast(null), 3000);
  };

  const appendCaseEvent = async (caseItem: InvestigationCase, event: Omit<CaseEvent, 'id' | 'timestamp'>) => {
    const now = Date.now();
    const newEvent: CaseEvent = { ...event, id: now, timestamp: now };
    const updated: InvestigationCase = { ...caseItem, timeline: [...caseItem.timeline, newEvent], updatedAt: now };
    await putItem('cases', updated);
    setCases(prev => prev.map(c => c.id === updated.id ? updated : c));
    return updated;
  };

  const addCaseNote = async () => {
    if (!activeCase || !currentUser || !caseNoteInput.trim()) return;
    await appendCaseEvent(activeCase, { type: 'note', text: caseNoteInput.trim(), by: currentUser.user });
    await addAuditLog('Case Note', `إضافة ملاحظة على ملف #${activeCase.id} (${activeCase.discordId})`);
    setCaseNoteInput('');
  };

  const updateCaseStatusHandler = async (status: CaseStatus) => {
    if (!activeCase || !currentUser) return;
    const statusLabels: Record<CaseStatus, string> = {
      open: 'مفتوحة', investigating: 'تحت التحقيق', pending_review: 'بانتظار المراجعة',
      closed_banned: 'مغلقة — تم الباند', closed_cleared: 'مغلقة — تمت التبرئة',
    };
    const updated: InvestigationCase = { ...activeCase, status, updatedAt: Date.now() };
    await putItem('cases', updated);
    setCases(prev => prev.map(c => c.id === updated.id ? updated : c));
    await appendCaseEvent(updated, { type: 'status_change', text: `تغيير حالة ملف إلى: ${statusLabels[status]}`, by: currentUser.user });
    await addAuditLog('Case Status Change', `تغيير حالة ملف #${activeCase.id} (${activeCase.discordId}) إلى ${statusLabels[status]}`);
  };

  const refreshCaseRisk = async () => {
    if (!activeCase || !currentUser) return;
    const risk = getCaseRisk(activeCase.discordId);
    if (risk.level === activeCase.riskLevel && risk.score === activeCase.riskScore) {
      setToast({ show: true, msg: 'ℹ️ مستوى الخطورة لم يتغيّر' });
      setTimeout(() => setToast(null), 2500);
      return;
    }
    const updated: InvestigationCase = { ...activeCase, riskLevel: risk.level, riskScore: risk.score, suggestedAction: risk.suggestedAction, updatedAt: Date.now() };
    await putItem('cases', updated);
    setCases(prev => prev.map(c => c.id === updated.id ? updated : c));
    await appendCaseEvent(updated, { type: 'risk_change', text: `تحديث تقييم الخطورة إلى ${risk.score}/100 (${risk.level})`, by: currentUser.user });
  };

  const linkExistingBanToCase = async (banId: number | string) => {
    if (!activeCase || !currentUser) return;
    const updated: InvestigationCase = { ...activeCase, linkedBanId: banId, updatedAt: Date.now() };
    await putItem('cases', updated);
    setCases(prev => prev.map(c => c.id === updated.id ? updated : c));
    await appendCaseEvent(updated, { type: 'linked_ban', text: `تم ربط ملف بسجل باند رقم #${banId}`, by: currentUser.user });
    await addAuditLog('Link Ban to Case', `ربط ملف #${activeCase.id} بسجل الباند #${banId}`);
  };

  const assignCaseToMe = async () => {
    if (!activeCase || !currentUser) return;
    const updated: InvestigationCase = { ...activeCase, assignedTo: currentUser.user, status: activeCase.status === 'open' ? 'investigating' : activeCase.status, updatedAt: Date.now() };
    await putItem('cases', updated);
    setCases(prev => prev.map(c => c.id === updated.id ? updated : c));
    await appendCaseEvent(updated, { type: 'assigned', text: `تم تكليف ${currentUser.user} بمتابعة هذه الملف`, by: currentUser.user });
    await addAuditLog('Case Assigned', `تكليف ${currentUser.user} ملف #${activeCase.id} (${activeCase.discordId})`);
  };

  const deleteCase = (caseId: number) => {
    triggerConfirm(
      'حذف القضية',
      'هل أنت متأكد من حذف هذه ملف نهائياً؟ السجل التاريخي سيُفقد.',
      async () => {
        if (!currentUser) return;
        const target = cases.find(c => c.id === caseId);
        await deleteItem('cases', caseId);
        setCases(prev => prev.filter(c => c.id !== caseId));
        if (activeCaseId === caseId) { setActiveCaseId(null); setActiveSec('investigation_hub'); }
        await addAuditLog('Delete Case', `حذف الملف #${caseId}${target ? ` (${target.discordId})` : ''}`);
      }
    );
  };

  // ── Evidence Intelligence Center ──

  const fileToBase64Generic = (file: File): Promise<string> =>
    new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target?.result as string);
      reader.readAsDataURL(file);
    });

  const createEvidence = async () => {
    if (!currentUser) return;
    if (!newEvidenceForm.name.trim() && !newEvidenceFile && !newEvidenceForm.text.trim()) {
      setToast({ show: true, msg: '❌ أضف اسماً أو ملفاً أو نصاً للدليل' });
      setTimeout(() => setToast(null), 3000);
      return;
    }
    let url: string | undefined;
    let type: EvidenceItem['type'] = newEvidenceForm.text.trim() ? 'text' : 'image';

    try {
      if (newEvidenceFile) {
        if (newEvidenceFile.type.startsWith('video')) {
          const fileExtension = newEvidenceFile.name.split('.').pop();
          const fileName = `evidence_${Date.now()}_${Math.floor(Math.random() * 1000)}.${fileExtension}`;
          setToast({ show: true, msg: '⏳ جاري رفع الدليل... يرجى الانتظار.' });
          url = await uploadVideoToR2(newEvidenceFile, fileName);
          type = 'video';
        } else {
          url = await fileToBase64Generic(newEvidenceFile);
          type = 'image';
        }
      }
    } catch (e: any) {
      setToast({ show: true, msg: '❌ فشل رفع الملف: ' + (e?.message || 'خطأ غير متوقع') });
      setTimeout(() => setToast(null), 4000);
      return;
    }

    const now = Date.now();
    const newEvidence: EvidenceItem = {
      id: now,
      caseId: newEvidenceForm.caseId,
      discordId: newEvidenceForm.discordId.trim() || undefined,
      type,
      url,
      text: newEvidenceForm.text.trim() || undefined,
      name: newEvidenceForm.name.trim() || undefined,
      category: newEvidenceForm.category,
      tags: newEvidenceForm.tags.split(',').map(t => t.trim()).filter(Boolean),
      addedBy: currentUser.user,
      createdAt: now,
    };
    await putItem('evidence_items', newEvidence);
    setEvidenceItems(prev => [newEvidence, ...prev]);

    if (newEvidenceForm.caseId) {
      const linkedCase = cases.find(c => c.id === newEvidenceForm.caseId);
      if (linkedCase) {
        const updated: InvestigationCase = { ...linkedCase, evidenceIds: [...linkedCase.evidenceIds, newEvidence.id], updatedAt: now };
        await putItem('cases', updated);
        setCases(prev => prev.map(c => c.id === updated.id ? updated : c));
        await appendCaseEvent(updated, { type: 'evidence_added', text: `إضافة دليل جديد: ${newEvidence.name || newEvidence.category}`, by: currentUser.user });
      }
    }

    await addAuditLog('Add Evidence', `إضافة دليل جديد (${newEvidence.category})${newEvidence.discordId ? ` للاعب ${newEvidence.discordId}` : ''}`);
    setToast({ show: true, msg: '✅ تم حفظ الدليل بنجاح' });
    setTimeout(() => setToast(null), 3000);
    setShowNewEvidenceForm(false);
    setNewEvidenceForm({ discordId: '', name: '', category: 'screenshot', text: '', tags: '', caseId: null });
    setNewEvidenceFile(null);
  };

  const linkEvidenceToCase = async (evidenceId: number, caseId: number) => {
    if (!currentUser) return;
    const ev = evidenceItems.find(e => e.id === evidenceId);
    const targetCase = cases.find(c => c.id === caseId);
    if (!ev || !targetCase) return;
    const updatedEv: EvidenceItem = { ...ev, caseId };
    await putItem('evidence_items', updatedEv);
    setEvidenceItems(prev => prev.map(e => e.id === evidenceId ? updatedEv : e));
    const updatedCase: InvestigationCase = { ...targetCase, evidenceIds: Array.from(new Set([...targetCase.evidenceIds, evidenceId])), updatedAt: Date.now() };
    await putItem('cases', updatedCase);
    setCases(prev => prev.map(c => c.id === caseId ? updatedCase : c));
    await appendCaseEvent(updatedCase, { type: 'evidence_added', text: `ربط دليل موجود: ${ev.name || ev.category}`, by: currentUser.user });
    await addAuditLog('Link Evidence', `ربط الدليل #${evidenceId} ملف #${caseId}`);
    setLinkEvidencePickerCaseId(null);
    setToast({ show: true, msg: '✅ تم ربط الدليل بالملف' });
    setTimeout(() => setToast(null), 2500);
  };

  const deleteEvidence = (evidenceId: number) => {
    triggerConfirm(
      'حذف الدليل',
      'هل أنت متأكد من حذف هذا الدليل نهائياً؟',
      async () => {
        if (!currentUser) return;
        const ev = evidenceItems.find(e => e.id === evidenceId);
        await deleteItem('evidence_items', evidenceId);
        setEvidenceItems(prev => prev.filter(e => e.id !== evidenceId));
        if (ev?.caseId) {
          const linkedCase = cases.find(c => c.id === ev.caseId);
          if (linkedCase) {
            const updated: InvestigationCase = { ...linkedCase, evidenceIds: linkedCase.evidenceIds.filter(id => id !== evidenceId), updatedAt: Date.now() };
            await putItem('cases', updated);
            setCases(prev => prev.map(c => c.id === updated.id ? updated : c));
            await appendCaseEvent(updated, { type: 'evidence_removed', text: `حذف دليل: ${ev?.name || ev?.category}`, by: currentUser.user });
          }
        }
        await addAuditLog('Delete Evidence', `حذف الدليل #${evidenceId}`);
      }
    );
  };

  if (loading) return (
    <div className="h-screen w-screen flex items-center justify-center gap-2 text-orange font-orbitron text-2xl">
      <span>MT LOGS...</span>
    </div>
  );

  if (!currentUser) {
    return (
      <AnimatePresence mode="wait">
        {showWelcome ? (
          <motion.div 
            key="welcome"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 1.1, filter: "blur(20px)" }}
            transition={{ duration: 1 }}
            className="fixed inset-0 bg-[#020202] flex items-center justify-center z-50 overflow-hidden"
          >
            {/* Particles */}
            <div className="absolute inset-0 pointer-events-none">
              {[...Array(20)].map((_, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: Math.random() * 1000 }}
                  animate={{ 
                    opacity: [0, 0.5, 0],
                    y: [Math.random() * 1000, Math.random() * 1000 - 500] 
                  }}
                  transition={{ 
                    duration: 5 + Math.random() * 5, 
                    repeat: Infinity,
                    ease: "linear"
                  }}
                  className="absolute w-1 h-1 bg-orange/40 rounded-full"
                  style={{ left: `${Math.random() * 100}%` }}
                />
              ))}
            </div>

            {/* Cyber Grid Background */}
            <div className="absolute inset-0 cyber-grid opacity-20" />
            <div className="scanning-line" />
            
            {/* Animated HUD Elements - Expanding to super wide */}
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center overflow-hidden">
              <motion.div 
                animate={{ rotate: 360 }} 
                transition={{ duration: 30, repeat: Infinity, ease: "linear" }}
                className="w-[180vw] h-[180vw] border border-orange/10 rounded-full border-dashed"
              />
              <motion.div 
                animate={{ rotate: -360 }} 
                transition={{ duration: 25, repeat: Infinity, ease: "linear" }}
                className="absolute w-[120vw] h-[120vw] border-2 border-orange/5 rounded-full border-dotted"
              />
              <div className="absolute w-full h-full bg-[radial-gradient(circle_at_center,rgba(255,106,0,0.12)_0%,transparent_70%)] blur-[150px]" />
              
              {/* Extra HUD floating lines - Spread across more width */}
              <div className="absolute inset-0 px-[1%] opacity-30 pointer-events-none flex justify-between">
                {[...Array(12)].map((_, i) => (
                  <div key={i} className="h-full border-x border-orange/15 relative w-px">
                    <motion.div 
                      animate={{ y: [0, 1200, 0] }} 
                      transition={{ duration: 8 + i * 2, repeat: Infinity, ease: "linear" }} 
                      className="absolute top-0 left-[-1px] w-[2px] h-[300px] bg-gradient-to-b from-transparent via-orange/60 to-transparent" 
                    />
                  </div>
                ))}
              </div>
            </div>

            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 1, ease: "easeOut" }}
              className="text-center space-y-10 relative z-10 px-6"
            >
              <div className="relative inline-block group">
                 <div className="relative p-2">
                   <img 
                     src="https://i.postimg.cc/G3DsDrGz/W3j-Wowj-B-Photoroom.png" 
                     alt="MT Logo" 
                     className="w-56 h-56 object-contain relative z-10 drop-shadow-[0_0_40px_rgba(255,106,0,0.6)] group-hover:drop-shadow-[0_0_60px_rgba(255,106,0,0.85)] transition-all duration-500" 
                     referrerPolicy="no-referrer" 
                   />
                 </div>
              </div>

              <div className="space-y-4">
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                >
                  <h1 className="text-5xl md:text-8xl font-black font-orbitron tracking-[0.25em] text-white">
                    MT <span className="text-orange animate-pulse drop-shadow-gold">LOGS</span>
                  </h1>
                </motion.div>
                
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.5 }}
                  className="space-y-6"
                >
                  <p className="text-orange font-bold uppercase tracking-[0.9em] text-xs md:text-sm">
                    Elite Administrative System
                  </p>
                  <div className="flex items-center justify-center gap-4">
                    <div className="w-16 h-[1px] bg-gradient-to-r from-transparent to-orange/50" />
                    <div className="w-2 h-2 rotate-45 border border-orange/50" />
                    <div className="w-16 h-[1px] bg-gradient-to-l from-transparent to-orange/50" />
                  </div>
                  <p className="text-text-dim max-w-xl mx-auto text-sm md:text-lg font-arabic leading-relaxed tracking-wide font-medium">
                   نظام مستري تاون المتقدم للرقابة التقنية وإدارة البيانات الأمنية. واجهة حصرية مخصصة للنخبة تضمن أعلى مستويات الشفافية والحماية الرقمية
                  </p>
                </motion.div>
              </div>

              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.8 }}
                className="flex flex-col sm:flex-row gap-8 justify-center items-center pt-10"
              >
                <button 
                  onClick={() => setShowWelcome(false)}
                  className="btn-gold group min-w-[260px] relative"
                >
                  <span className="relative z-10 flex items-center justify-center gap-4 text-base font-black">
                    <LogIn size={22} />
                    <span>الدخول للمنصة</span>
                  </span>
                </button>

                <button 
                  className="btn-luxury-outline group min-w-[260px] relative overflow-hidden"
                >
                  <span className="relative z-10 flex items-center justify-center gap-4 font-orbitron font-bold">
                    System Preview
                  </span>
                </button>
              </motion.div>

              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 0.6 }}
                transition={{ delay: 1.2 }}
                className="pt-12 flex items-center justify-center gap-12"
              >
                {[
                  { label: "Encrypted", icon: <Shield size={12} /> },
                  { label: "Elite Access", icon: <Shield size={12} /> },
                  { label: "Real-time", icon: <Shield size={12} /> }
                ].map((item, i) => (
                  <div key={i} className="flex flex-col items-center gap-3">
                    <div className="flex items-center gap-2 text-orange">
                      {item.icon}
                      <span className="text-[10px] font-orbitron uppercase tracking-[0.3em]">{item.label}</span>
                    </div>
                    <div className="w-20 h-[2px] bg-gradient-to-r from-transparent via-orange/30 to-transparent" />
                  </div>
                ))}
              </motion.div>
            </motion.div>

            {/* Corner HUD Details */}
            <div className="absolute top-12 left-12 hidden lg:block opacity-30 pointer-events-none">
              <div className="font-mono text-[10px] space-y-2 border-l border-orange/40 pl-4 py-2">
                <p className="text-orange">STATUS: AUTHORIZED</p>
                <p>ACCESS_LEVEL: 05_OVERSEER</p>
                <p>ENCRYPTION: AES_256_GCM</p>
                <p>UPLINK: SECURE_CHANNEL_B</p>
              </div>
            </div>
            <div className="absolute bottom-12 right-12 hidden lg:block opacity-30 pointer-events-none">
              <div className="font-mono text-[10px] text-right space-y-2 border-r border-orange/40 pr-4 py-2">
                <p className="text-orange">M_T_X_LOGS_OS_4.0</p>
                <p>CYBER_CORE: OPERATIONAL</p>
                <p>ADMIN_PROTOCOL: ACTIVE</p>
                <p>© 2026 MYSTERY TOWN SYSTEM</p>
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div 
            key="auth"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="fixed inset-0 bg-bg flex items-center justify-center p-6 z-50 overflow-y-auto overflow-x-hidden"
          >
            {/* Ambient background — subtle moving glows + grid (isolated, non-scrolling) */}
            <div className="fixed inset-0 overflow-hidden pointer-events-none -z-10">
              <div className="absolute inset-0 cyber-grid opacity-10" />
              <motion.div
                animate={{ x: [0, 40, 0], y: [0, 30, 0] }}
                transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
                className="absolute -top-32 -right-32 w-[26rem] h-[26rem] bg-orange/10 rounded-full blur-[120px]"
              />
              <motion.div
                animate={{ x: [0, -30, 0], y: [0, -40, 0] }}
                transition={{ duration: 22, repeat: Infinity, ease: "easeInOut" }}
                className="absolute -bottom-40 -left-32 w-[22rem] h-[22rem] bg-orange/5 rounded-full blur-[120px]"
              />
            </div>

            <div className="card relative w-full max-w-[420px] text-center space-y-8 border-orange/20 shadow-[0_0_50px_rgba(255,106,0,0.1)] overflow-hidden">

              {/* Single shimmer dot traveling around the card border */}
              <svg className="absolute inset-0 pointer-events-none" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', overflow: 'visible', zIndex: 1 }}>
                <defs>
                  <style>{`
                    @keyframes cardTravel {
                      0%   { stroke-dashoffset: 2000; }
                      100% { stroke-dashoffset: -2000; }
                    }
                    .csr {
                      fill: none;
                      stroke: #ff6a00;
                      stroke-width: 2;
                      stroke-linecap: round;
                      stroke-dasharray: 100 1900;
                      animation: cardTravel 15s linear infinite;
                      filter: drop-shadow(0 0 6px #ff6a00) drop-shadow(0 0 12px rgba(255,106,0,0.5));
                    }
                  `}</style>
                </defs>
                <rect className="csr" x="1" y="1" width="calc(100% - 2px)" height="calc(100% - 2px)" rx="28" ry="28" />
              </svg>

              <div className="relative mx-auto w-32 h-32 flex items-center justify-center mb-6">
                <motion.div
                  className="absolute inset-2 rounded-full bg-orange/20 blur-2xl"
                  animate={{ scale: [1, 1.2, 1], opacity: [0.35, 0.65, 0.35] }}
                  transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                />
                <motion.img 
                  src="https://i.postimg.cc/G3DsDrGz/W3j-Wowj-B-Photoroom.png" 
                  alt="MT Logo" 
                  className="relative z-10 w-full h-full object-contain drop-shadow-[0_0_20px_rgba(255,106,0,0.5)] p-2"
                  animate={{ y: [0, -6, 0] }}
                  transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
                  referrerPolicy="no-referrer"
                />
              </div>

              <h1 className="font-orbitron text-4xl font-black tracking-tighter">MT <span className="text-orange">{authMode === 'login' ? 'LOGS' : 'JOIN'}</span></h1>
              
              <AnimatePresence mode="wait">
                {authFeedback && (
                  <motion.div 
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className={`p-4 rounded-2xl text-sm font-arabic font-bold flex items-center gap-3 ${authFeedback.type === 'error' ? 'bg-red-500/10 text-red-500 border border-red-500/20' : 'bg-green-500/10 text-green-500 border border-green-500/20'}`}
                  >
                    {authFeedback.type === 'error' ? <ShieldAlert size={18} /> : <ShieldCheck size={18} />}
                    {authFeedback.msg}
                  </motion.div>
                )}
              </AnimatePresence>

              <AnimatePresence mode="wait">
                {authMode === 'login' ? (
                  <motion.div key="login" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="flex flex-col gap-5">
                    <input type="text" placeholder="اسم المستخدم (MT بدون كتابة)" className="input-field focus:border-gold" value={authInputs.user} onChange={e => {
                      let val = e.target.value;
                      // أضف "MT " تلقائياً لو ما بدأ فيها
                      if (val.length > 0 && !val.startsWith('MT ') && !val.startsWith('mt ') && !val.startsWith('MT') ) {
                        val = 'MT ' + val;
                      }
                      if (val === 'MT' || val === 'mt') val = 'MT ';
                      setAuthInputs({...authInputs, user: val}); setAuthFeedback(null);
                    }} />
                    <input type="password" placeholder="كلمة المرور" className="input-field focus:border-gold" value={authInputs.pass} onChange={e => { setAuthInputs({...authInputs, pass: e.target.value}); setAuthFeedback(null); }} onKeyDown={e => e.key === 'Enter' && handleLogin()} />
                    
                    {/* Remember Me + Rate Limit */}
                    <div className="flex items-center justify-between px-1">
                      <label className="flex items-center gap-2.5 cursor-pointer group select-none" onClick={() => setRememberMe(!rememberMe)}>
                        <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all duration-200 ${rememberMe ? 'bg-orange border-orange shadow-[0_0_10px_rgba(255,106,0,0.5)]' : 'border-white/20 bg-white/5 group-hover:border-orange/50'}`}>
                          {rememberMe && (
                            <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                              <path d="M1 4L3.5 6.5L9 1" stroke="black" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          )}
                        </div>
                        <span className="text-xs text-text-dim group-hover:text-white transition-colors font-arabic">تذكرني لمدة 30 يوم</span>
                      </label>
                      {!rateLimitState.blocked && rateLimitState.remaining < 5 && (
                        <span className="text-[10px] text-amber-400 font-mono">{rateLimitState.remaining} محاولة متبقية</span>
                      )}
                    </div>

                    <button 
                      className={`btn-gold w-full text-sm py-4 transition-all ${loginCooldown || rateLimitState.blocked ? 'opacity-50 cursor-not-allowed' : ''}`} 
                      onClick={handleLogin}
                      disabled={loginCooldown || rateLimitState.blocked}
                    >
                      {loginCooldown ? (
                        <span className="flex items-center justify-center gap-2">
                          <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                          </svg>
                          جاري التحقق...
                        </span>
                      ) : rateLimitState.blocked ? `🔒 مجمّد` : 'دخول للنظام'}
                    </button>

                    {/* Security badge */}
                    <div className="flex items-center justify-center gap-2 opacity-40">
                      <Shield size={9} className="text-orange" />
                      <span className="text-[9px] font-mono uppercase tracking-widest text-orange">Secured • Encrypted • Protected</span>
                    </div>

                    <p className="text-xs text-text-dim text-center">ليس لديك حساب؟ <span className="text-orange cursor-pointer font-bold hover:opacity-80 transition-opacity" onClick={() => { setAuthMode('register'); setAuthFeedback(null); setAuthInputs({user: '', pass: '', role: UserRole.LOGS}); }}>سجل الآن</span></p>
                  </motion.div>
                ) : (
                  <motion.div key="register" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-5">
                    <input type="text" placeholder="اسم المستخدم (MT بدون كتابة)" className="input-field focus:border-gold" value={authInputs.user} onChange={e => {
                      let val = e.target.value;
                      if (val.length > 0 && !val.startsWith('MT ') && !val.startsWith('mt ') && !val.startsWith('MT')) {
                        val = 'MT ' + val;
                      }
                      if (val === 'MT' || val === 'mt') val = 'MT ';
                      setAuthInputs({...authInputs, user: val}); setAuthFeedback(null);
                    }} />
                    <input type="password" placeholder="كلمة المرور" className="input-field focus:border-gold" value={authInputs.pass} onChange={e => { setAuthInputs({...authInputs, pass: e.target.value}); setAuthFeedback(null); }} />
                    <select className="input-field focus:border-gold" value={authInputs.role} onChange={e => { setAuthInputs({...authInputs, role: e.target.value as UserRole}); setAuthFeedback(null); }}>
                      <option value={UserRole.ADMIN}>إداري (Staff)</option>
                      <option value={UserRole.LOGS}>عضو Logs Team</option>
                    </select>
                    {registerSuccess ? (
                      <div className="flex flex-col items-center gap-4 py-4 text-center">
                        <div className="w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center border border-green-500/30">
                          <ShieldCheck className="text-green-400 w-8 h-8" />
                        </div>
                        <p className="text-green-400 font-black text-base font-arabic">✅ تم تقديم طلبك بنجاح!</p>
                        <p className="text-text-dim text-xs font-arabic leading-relaxed">طلبك وصل للمدير — سيتم مراجعته وإشعارك بالقبول قريباً. سيتم تحويلك لصفحة الدخول خلال ثوانٍ...</p>
                        <div className="w-full bg-white/5 rounded-full h-1 overflow-hidden">
                          <div className="h-full bg-green-400 animate-[shrink_5s_linear_forwards]" style={{animation: 'width 5s linear forwards', width: '100%'}} />
                        </div>
                      </div>
                    ) : (
                      <button className="btn-gold w-full text-sm py-4" onClick={handleRegister}>تقديم الطلب</button>
                    )}
                    {!registerSuccess && (
                      <p className="text-xs text-text-dim cursor-pointer hover:text-orange transition-colors font-bold mt-4" onClick={() => { setAuthMode('login'); setAuthFeedback(null); setAuthInputs({user: '', pass: '', role: UserRole.LOGS}); }}>العودة للدخول</p>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    );
  }

  return (
    <div className="min-h-screen" dir="rtl">
      <nav className="sticky top-0 z-40 bg-bg/80 backdrop-blur-xl border-b border-white/5 px-[6%] py-3 flex flex-wrap justify-between items-center gap-4">
        <div className="flex items-center gap-4 cursor-pointer group" onClick={() => setActiveSec('home')}>
          <div className="relative">
            <div className="relative w-12 h-12 overflow-hidden p-1">
              <img src="https://i.postimg.cc/G3DsDrGz/W3j-Wowj-B-Photoroom.png" alt="Logo" className="w-full h-full object-contain drop-shadow-[0_0_10px_rgba(255,106,0,0.5)] group-hover:drop-shadow-[0_0_15px_rgba(255,106,0,0.8)] transition-all duration-300" referrerPolicy="no-referrer" />
            </div>
          </div>
          <div className="flex flex-col text-right">
            <div className="font-orbitron font-black text-xl tracking-tighter">
              MT <span className="text-orange/60 mx-0.5">X</span> <span className="text-orange">LOGS</span>
            </div>
            <div 
              onClick={() => {
                setDiagnosticsState({ ...dbDiagnostics });
                setShowDbDiagnostics(true);
              }}
              className="flex items-center gap-1.5 text-[9px] font-black mt-0.5 select-none cursor-pointer hover:opacity-85 transition-opacity bg-white/5 hover:bg-white/10 px-2 py-0.5 rounded border border-white/5"
              title="انقر لعرض حالة وتفاصيل اتصال قاعدة البيانات"
            >
              {supabase ? (
                <>
                  <span className={`w-1.5 h-1.5 rounded-full ${diagnosticsState.hasErrors ? 'bg-amber-400' : 'bg-emerald-400'} animate-pulse`}></span>
                  <span className={`${diagnosticsState.hasErrors ? 'text-amber-400' : 'text-emerald-400'} tracking-wide uppercase font-mono flex items-center gap-1`}>
                    سحابي {diagnosticsState.hasErrors ? '(محدود)' : '(نشط)'}
                  </span>
                </>
              ) : (
                <>
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                  <span className="text-amber-400 tracking-wide uppercase font-mono">محلي (IndexedDB)</span>
                </>
              )}
            </div>
          </div>
        </div>
        
        <div className="flex flex-wrap items-center gap-2 md:gap-4 overflow-x-auto no-scrollbar">
          <span className={`nav-link ${activeSec === 'home' ? 'active' : ''}`} onClick={() => setActiveSec('home')}>الرئيسية</span>
          <span className={`nav-link ${activeSec === 'team' ? 'active' : ''}`} onClick={() => setActiveSec('team')}>المسؤولين</span>
          <span className={`nav-link ${activeSec === 'goals' ? 'active' : ''}`} onClick={() => setActiveSec('goals')}>أهدافنا</span>
          <span className={`nav-link ${activeSec === 'tickets' ? 'active' : ''} relative`} onClick={() => { setActiveSec('tickets'); setTicketViewMode(currentUser.role === UserRole.ADMIN ? 'create' : 'all'); }}>
            التذاكر
            {unclaimedCount > 0 && activeSec !== 'tickets' && (
              <span className="absolute top-1 -right-4 bg-orange text-black text-[9px] font-black w-4 h-4 rounded-full flex items-center justify-center shadow-[0_0_8px_rgba(255,106,0,0.8)] animate-pulse">
                {unclaimedCount}
              </span>
            )}
          </span>
          {isStaff && (
            <span className={`nav-link ${activeSec === 'my_dashboard' ? 'active' : ''} !text-orange/90`} onClick={() => setActiveSec('my_dashboard')}>داشبورد</span>
          )}
          {isStaff && (
            <span className={`nav-link ${activeSec === 'notepad' ? 'active' : ''} !text-orange/90`} onClick={() => setActiveSec('notepad')}>المفكرة</span>
          )}
          {isManager && (
            <span className={`nav-link ${activeSec === 'manager_notes' ? 'active' : ''} !text-red/80`} onClick={() => setActiveSec('manager_notes')}>Operations Notes Center</span>
          )}
          {isStaff && (
            <span className={`nav-link ${activeSec === 'leaderboard' ? 'active' : ''} !text-yellow-500/80`} onClick={() => setActiveSec('leaderboard')}>لوحة الصدارة</span>
          )}
          {isStaff && (
            <span className={`nav-link ${activeSec === 'bans' ? 'active' : ''} !text-orange font-bold`} onClick={() => setActiveSec('bans')}>معلومات الباند</span>
          )}
          {isStaff && (
            <span className={`nav-link ${activeSec === 'investigation_hub' || activeSec === 'case_tracker' ? 'active' : ''} !text-orange font-bold flex items-center gap-1.5`} onClick={() => { setActiveSec('investigation_hub'); setActiveCaseId(null); }}>
              <Crosshair size={14} /> Suspicious Profiles
            </span>
          )}
          {isStaff && (
            <span className={`nav-link ${activeSec === 'intelligence_room' ? 'active' : ''} !text-orange/90 flex items-center gap-1.5`} onClick={() => setActiveSec('intelligence_room')}>
              <Network size={14} /> Intelligence Room
            </span>
          )}
          {isStaff && (
            <span className={`nav-link ${activeSec === 'yara_rules' ? 'active' : ''} !text-orange/90 flex items-center gap-1.5`} onClick={() => setActiveSec('yara_rules')}>
              <FileCode size={14} /> YARA Rules
            </span>
          )}
          {isStaff && (
            <span className={`nav-link ${activeSec === 'pc_check' ? 'active' : ''} !text-orange/90 flex items-center gap-1.5`} onClick={() => setActiveSec('pc_check')}>
              <Cpu size={14} /> PC-CHECK
            </span>
          )}
          {isStaff && (
            <span className={`nav-link ${activeSec === 'pre_wl_hacks' ? 'active' : ''} !text-red-400 flex items-center gap-1.5`} onClick={() => { setActiveSec('pre_wl_hacks'); setPreWLView('list'); }}>
              <ShieldAlert size={14} /> الهاكات قبل الوايت لست
            </span>
          )}
          {isManager && (
            <span className={`nav-link ${activeSec === 'audit_logs' ? 'active' : ''} !text-orange/80`} onClick={() => setActiveSec('audit_logs')}>Audit Logs</span>
          )}
          {isManager && (
            <span className={`nav-link ${activeSec === 'closed_tickets' ? 'active' : ''} text-red/60`} onClick={() => setActiveSec('closed_tickets')}>التذاكر المغلقة</span>
          )}
          {isManager && (
            <span className={`nav-link ${activeSec === 'manage' ? 'active' : ''} relative`} onClick={() => setActiveSec('manage')}>
              الإدارة
              {users.filter(u => u.status === 'pending').length > 0 && (
                <span className="absolute -top-1 -right-3 bg-red-500 text-white text-[9px] font-black w-4 h-4 rounded-full flex items-center justify-center shadow-[0_0_8px_rgba(239,68,68,0.8)] animate-pulse">
                  {users.filter(u => u.status === 'pending').length}
                </span>
              )}
            </span>
          )}
          <span className={`nav-link ${activeSec === 'profile' ? 'active' : ''}`} onClick={() => setActiveSec('profile')}><Settings className="inline w-4 h-4 mr-1" /> الإعدادات</span>
        </div>

        <div className="flex items-center gap-4">
          {isStaff && (
            <button
              onClick={() => { setCommandPaletteOpen(true); setCommandQuery(''); setCommandSelectedIndex(0); }}
              className="hidden md:flex items-center gap-2 text-text-dim hover:text-orange hover:border-orange/40 border border-white/10 px-3 py-1.5 rounded-xl text-xs transition-all bg-white/[0.02]"
            >
              <Search size={13} />
              <span>بحث شامل...</span>
              <span className="flex items-center gap-0.5 text-[9px] font-mono bg-white/5 px-1.5 py-0.5 rounded border border-white/10 ml-1">
                <Command size={9} />K
              </span>
            </button>
          )}
          <div className="hidden sm:block text-orange font-black border border-orange px-3 py-1 rounded-full text-xs uppercase tracking-widest">
            {currentUser.role}
          </div>
          <Power className="text-red cursor-pointer hover:scale-110 transition-transform" onClick={() => { clearSession(); setCurrentUser(null); }} />
        </div>
      </nav>

      <main className="w-full px-0 py-10 pt-111 lg:pt-5">
        <AnimatePresence mode="wait">
          {/* HOME SECTION */}
          {activeSec === 'home' && (
            <motion.div key="home" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-10 px-[4%]">
              <div className="card glow-hover border-r-[6px] border-orange">
                <h1 className="font-orbitron text-4xl sm:text-6xl font-black leading-tight">
                  Logs Team<br /> <span className="text-orange">Mystery Town</span>
                </h1>
                <p className="mt-6 text-text-dim max-w-3xl leading-relaxed">
                  مسؤوليتنا متابعة السجلات والتأكد من سلامة الإجراءات داخل السيرفر. نركز على كشف أي تلاعب أو استغلال يؤثر على تجربة اللاعبين، ونعمل بشكل مستمر للحفاظ على بيئة لعب عادلة ومنظمة. هدفنا الأساسي هو دعم الاستقرار والثقة داخل المجتمع من خلال المتابعة الدقيقة والتعامل المهني مع مختلف الحالات داخل السيرفر.
                </p>
              </div>

              <div>
                <h3 className="section-title text-2xl text-orange font-bold border-r-4 border-orange pr-4 mb-8">إنجازات Logs Team (الـ 30 يوم الماضية)</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {[
                    { val: '140', label: 'مخالف' },
                    { val: '81', label: 'هاك' },
                    { val: '0%', label: 'تخريب خلال الحدث الأخير' },
                    { val: 'فوري', label: 'وقت الاستجابة', special: true },
                  ].map((s, i) => (
                    <div key={i} className={`card glow-hover text-center py-8 ${s.special ? 'border-orange' : ''}`}>
                      <h2 className="font-orbitron text-3xl sm:text-4xl text-orange font-black">{s.val}</h2>
                      <p className="text-xs text-text-dim mt-2">{s.label}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid md:grid-cols-3 gap-6">
                <div className="card md:col-span-2 glow-hover space-y-4">
                  <h3 className="text-orange font-bold flex items-center gap-2"><PlusCircle className="w-5 h-5" /> ضربات استباقية</h3>
                  <p className="text-text-dim text-sm leading-loose">
                    تمكن الفريق خلال الفترة الماضية من رصد عدة محاولات غير مصرح بها لاستهداف ملفات السيرفر، وتم التعامل معها واتخاذ الإجراءات اللازمة بحق المتسببين خلال وقت قياسي. نحرص بشكل مستمر على متابعة السجلات وتحليل الحالات لضمان استقرار السيرفر والحفاظ على بيئة آمنة وعادلة لجميع اللاعبين.
                  </p>
                </div>
                <div className="card glow-hover flex flex-col justify-center items-center text-center">
                  <h3 className="text-orange font-bold">الريادة التقنية</h3>
                  <p className="text-text-dim text-sm mt-4">نطبق أحدث تقنيات الـ Tracking والـ Logs لضمان بيئة لعب نظيفة 100%.</p>
                </div>
              </div>
            </motion.div>
          )}

          {/* MY DASHBOARD SECTION */}
          {activeSec === 'my_dashboard' && isStaff && (
            <motion.div key="my_dashboard" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="space-y-10 px-[4%]">
              <header className="flex justify-between items-center bg-black/40 p-8 rounded-[2rem] border border-orange/20 backdrop-blur-md">
                <div>
                  <h1 className="text-3xl font-black font-orbitron tracking-widest flex items-center gap-4">
                    <LayoutDashboard className="text-orange" size={32} />
                    MY <span className="text-orange">DASHBOARD</span>
                  </h1>
                  <p className="text-text-dim text-xs mt-2 uppercase tracking-[0.4em]">Personal Administrative Intelligence</p>
                </div>
                <div className="text-right">
                  <p className="text-text-dim text-[10px] uppercase tracking-widest text-orange font-bold">Access Level</p>
                  <p className="font-orbitron font-black text-xl">{currentUser.role.toUpperCase()}</p>
                </div>
              </header>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="card glow-hover border-b-4 border-orange">
                  <div className="flex justify-between items-start mb-4">
                    <div className="p-3 bg-orange/10 rounded-2xl border border-orange/20"><TicketIcon className="text-orange" /></div>
                    <span className="text-[10px] font-bold text-green-500">+12%</span>
                  </div>
                  <h2 className="text-4xl font-black font-orbitron">{stats?.personal.tickets}</h2>
                  <p className="text-text-dim text-xs mt-2">تذاكر منجزة</p>
                </div>
                <div className="card glow-hover border-b-4 border-blue-500">
                  <div className="flex justify-between items-start mb-4">
                    <div className="p-3 bg-blue-500/10 rounded-2xl border border-blue-500/20"><ShieldCheck className="text-blue-500" /></div>
                    <span className="text-[10px] font-bold text-blue-400">نشط</span>
                  </div>
                  <h2 className="text-4xl font-black font-orbitron">{stats?.personal.bans}</h2>
                  <p className="text-text-dim text-xs mt-2">سجلات باند مقبولة</p>
                </div>
                <div className="card glow-hover border-b-4 border-yellow-500">
                  <div className="flex justify-between items-start mb-4">
                    <div className="p-3 bg-yellow-500/10 rounded-2xl border border-yellow-500/20"><Activity className="text-yellow-500" /></div>
                    <div className="w-16 bg-white/5 h-1 rounded-full overflow-hidden mt-3">
                      <div className="bg-yellow-500 h-full" style={{ width: `${stats?.personal.activity}%` }} />
                    </div>
                  </div>
                  <h2 className="text-4xl font-black font-orbitron">{stats?.personal.activity}%</h2>
                  <p className="text-text-dim text-xs mt-2">معدل النشاط الشهري</p>
                </div>
                <div className="card glow-hover border-b-4 border-purple-500">
                  <div className="flex justify-between items-start mb-4">
                    <div className="p-3 bg-purple-500/10 rounded-2xl border border-purple-500/20"><Target className="text-purple-500" /></div>
                    <span className="text-[10px] font-bold text-purple-400">دقة</span>
                  </div>
                  <h2 className="text-4xl font-black font-orbitron">{stats?.personal.efficiency}%</h2>
                  <p className="text-text-dim text-xs mt-2">نسبة الإنجاز والأداء</p>
                </div>
              </div>

              <div className="grid lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 space-y-6">
                  <div className="card h-full">
                    <h3 className="section-title text-orange font-bold flex items-center gap-2 mb-6"><BarChart2 className="w-5 h-5" /> تحليل الأداء الذاتي</h3>
                    <div className="space-y-8 py-4">
                      {['التعامل مع التذاكر', 'دقة الأدلة', 'سرعة الاستجابة'].map((label, i) => (
                        <div key={label} className="space-y-3">
                          <div className="flex justify-between text-sm">
                            <span className="font-bold">{label}</span>
                            <span className="text-orange font-mono">{80 + i * 5}%</span>
                          </div>
                          <div className="h-3 bg-black/40 rounded-full border border-white/5 p-[2px]">
                            <motion.div 
                              initial={{ width: 0 }}
                              animate={{ width: `${80 + i * 5}%` }}
                              transition={{ duration: 1.5, ease: "easeOut", delay: i * 0.2 }}
                              className={`h-full rounded-full bg-gradient-to-r ${i === 0 ? 'from-orange/20 to-orange' : i === 1 ? 'from-blue-500/20 to-blue-500' : 'from-yellow-500/20 to-yellow-500'}`} 
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="card h-full overflow-hidden relative">
                    <div className="absolute top-0 right-0 p-8 opacity-5">
                      <History size={120} />
                    </div>
                    <h3 className="text-orange font-bold flex items-center gap-2 mb-6"><History className="w-5 h-5" /> أحدث العمليات</h3>
                    <div className="space-y-4 max-h-[400px] overflow-y-auto no-scrollbar">
                      {auditLogs.filter(l => l.userId === currentUser.user).slice(0, 5).map((log, index) => (
                        <div key={`dash_log_${log.id}_${index}`} className="p-4 bg-white/5 rounded-2xl border border-white/5 hover:border-orange/20 transition-all group">
                          <div className="flex justify-between items-start mb-2">
                            <span className="text-xs font-bold text-orange uppercase tracking-tighter">{log.action}</span>
                            <span className="text-[9px] text-text-dim font-mono">{formatDate(log.timestamp).split('-')[1]}</span>
                          </div>
                          <p className="text-[10px] text-text-dim line-clamp-2 group-hover:text-white transition-colors">{log.details}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* PERSONAL NOTEPAD SECTION */}
          {activeSec === 'notepad' && isStaff && (
            <motion.div key="notepad" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="h-[calc(100vh-180px)] flex flex-col gap-6 px-[4%]">
              <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                <div>
                  <h1 className="text-2xl font-black font-orbitron tracking-widest flex items-center gap-4">
                    <StickyNote className="text-orange" />
                    STAFF <span className="text-orange">NOTEPAD</span>
                  </h1>
                  <p className="text-text-dim text-[10px] uppercase tracking-[0.4em] mt-1 font-bold">Secure Administrative Intelligence</p>
                </div>
                <div className="flex gap-4 w-full md:w-auto">
                   <div className="relative flex-1 md:w-64">
                    <Search className="absolute right-4 top-3 text-text-dim w-4 h-4" />
                    <input 
                      type="text" 
                      placeholder="بحث في الملاحظات..." 
                      className="input-field pr-12 text-sm h-11" 
                      value={noteSearch} 
                      onChange={e => setNoteSearch(e.target.value)} 
                    />
                  </div>
                  <button className="btn-orange h-11 px-6 flex items-center gap-2" onClick={() => { setEditingNoteId(null); setNoteForm({ title: '', content: '', category: 'عام' }); }}>
                    <Plus size={18} /> <span className="hidden sm:inline">ملاحظة جديدة</span>
                  </button>
                </div>
              </header>

              <div className="grid lg:grid-cols-12 gap-8 flex-1 min-h-0">
                <div className="lg:col-span-4 flex flex-col gap-4 overflow-y-auto no-scrollbar">
                  {personalNotes
                    .filter(n => n.userId === currentUser.user && (n.title.toLowerCase().includes(noteSearch.toLowerCase()) || n.content.toLowerCase().includes(noteSearch.toLowerCase())))
                    .sort((a,b) => (b.isPinned ? 1 : 0) - (a.isPinned ? 1 : 0) || b.updatedAt - a.updatedAt)
                    .map((note, idx) => (
                      <div 
                        key={`personal_note_${note.id}_${idx}`} 
                        onClick={() => { setEditingNoteId(note.id); setNoteForm({ title: note.title, content: note.content, category: note.category }); }}
                        className={`p-5 rounded-3xl border transition-all cursor-pointer group relative overflow-hidden ${editingNoteId === note.id ? 'bg-orange/10 border-orange/40 shadow-[0_0_30px_rgba(255,106,0,0.1)]' : 'bg-black/40 border-white/5 hover:border-orange/20'}`}
                      >
                        {note.isPinned && <Star size={12} className="absolute left-4 top-4 text-orange fill-orange" />}
                        <div className="flex justify-between items-start mb-2">
                          <span className="text-[10px] text-orange font-bold uppercase tracking-widest">{note.category}</span>
                          <span className="text-[9px] text-text-dim font-mono">{formatDate(note.updatedAt).split('-')[0]}</span>
                        </div>
                        <h4 className="font-bold text-sm mb-2 line-clamp-1 group-hover:text-orange transition-colors">{note.title}</h4>
                        <p className="text-xs text-text-dim line-clamp-2 leading-relaxed">{note.content}</p>
                      </div>
                    ))}
                </div>

                <div className="lg:col-span-8 flex flex-col gap-6 bg-black/40 rounded-3xl border border-white/5 p-8 backdrop-blur-md">
                  <div className="flex justify-between items-center pb-4 border-b border-white/5">
                    <input 
                      type="text" 
                      placeholder="عنوان الملاحظة..." 
                      className="bg-transparent text-xl font-black w-full outline-none focus:text-orange transition-colors"
                      value={noteForm.title}
                      onChange={e => setNoteForm({...noteForm, title: e.target.value})}
                    />
                    <div className="flex items-center gap-2">
                       {editingNoteId && (
                         <>
                           <button className="p-2 bg-white/5 hover:bg-orange/20 rounded-xl transition-all text-orange" onClick={() => togglePinNote(editingNoteId)}>
                             <Star size={18} className={personalNotes.find(n => n.id === editingNoteId)?.isPinned ? 'fill-orange' : ''} />
                           </button>
                           <button className="p-2 bg-white/5 hover:bg-red/20 rounded-xl transition-all text-red" onClick={() => deleteNote(editingNoteId)}>
                             <Trash2 size={18} />
                           </button>
                         </>
                       )}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 py-2">
                    {['عام', 'IDs مشبوهة', 'ملاحظات مناوبة', 'تذكيرات', 'هامة'].map(cat => (
                      <button 
                        key={cat} 
                        onClick={() => setNoteForm({...noteForm, category: cat})}
                        className={`px-4 py-1.5 rounded-full text-[10px] font-bold border transition-all ${noteForm.category === cat ? 'bg-orange text-black border-orange' : 'bg-white/5 border-white/5 text-text-dim hover:border-orange/30'}`}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>

                  <div className="flex-1 min-h-0 relative group">
                    <textarea 
                      placeholder="ابدأ الكتابة هنا... يتم الحفظ تلقائياً" 
                      className="w-full h-full bg-transparent resize-none outline-none text-sm leading-relaxed font-arabic"
                      value={noteForm.content}
                      onChange={e => setNoteForm({...noteForm, content: e.target.value})}
                    />
                    <div className="absolute left-0 bottom-0 p-4 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button 
                        onClick={() => copyDiscordMention(noteForm.content)}
                        className="btn-orange py-2 px-4 text-[11px] rounded-xl flex items-center gap-2 shadow-2xl"
                      >
                        <Copy size={14} /> Copy Discord Mention
                      </button>
                    </div>
                  </div>

                  <div className="flex justify-between items-center pt-4 border-t border-white/5 text-[9px] text-text-dim font-mono">
                    <div className="flex items-center gap-4">
                      <span>الأحرف: {noteForm.content.length}</span>
                      <span>الكلمات: {noteForm.content.trim() ? noteForm.content.trim().split(/\s+/).length : 0}</span>
                    </div>
                    <span>آخر تعديل: {editingNoteId ? formatDate(personalNotes.find(n => n.id === editingNoteId)?.updatedAt || Date.now()) : 'الآن'}</span>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* MANAGER NOTES SECTION */}
          {activeSec === 'manager_notes' && isManager && (
            <motion.div key="manager_notes" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="space-y-10 px-[4%]">
              <header className="flex justify-between items-center bg-black/40 p-8 rounded-[2rem] border border-red/20 backdrop-blur-md">
                <div>
                  <h1 className="text-3xl font-black font-orbitron tracking-widest flex items-center gap-4">
                    <ClipboardList className="text-red" size={32} />
                    OPERATIONS <span className="text-red">NOTES CENTER</span>
                  </h1>
                  <p className="text-text-dim text-xs mt-2 uppercase tracking-[0.4em]">Internal Security Intelligence Audit</p>
                </div>
                <div className="text-right">
                   <div className="relative w-64 group">
                    <Search className="absolute right-4 top-3 text-text-dim w-4 h-4" />
                    <input 
                      type="text" 
                      placeholder="بحث باسم العضو..." 
                      className="input-field pr-12 text-sm h-11 bg-black/60" 
                      value={noteSearch} 
                      onChange={e => setNoteSearch(e.target.value)} 
                    />
                  </div>
                </div>
              </header>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                 {users.filter(u => u.role === UserRole.LOGS && u.user.toLowerCase().includes(noteSearch.toLowerCase())).map((member, index) => {
                   const uNotes = personalNotes.filter(n => n.userId === member.user);
                   return (
                     <div key={`member_item_${member.user}_${index}`} className="card glow-hover border-white/5 hover:border-red/40 group relative overflow-hidden">
                       <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-red/40 to-transparent" />
                       <div className="flex items-center gap-4 mb-6">
                          <div className="w-16 h-16 bg-white/5 rounded-2xl border border-white/10 flex items-center justify-center text-red font-black text-2xl group-hover:scale-110 transition-transform">
                            {member.user.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <h4 className="font-bold text-lg">{member.user}</h4>
                            <span className="text-[10px] px-2 py-1 bg-white/5 rounded-lg text-text-dim font-bold uppercase tracking-widest">Logs Team</span>
                          </div>
                       </div>

                       <div className="space-y-4">
                         <div className="flex justify-between text-xs">
                           <span className="text-text-dim">عدد الملاحظات:</span>
                           <span className="font-mono text-red">{uNotes.length}</span>
                         </div>
                         <div className="flex justify-between text-xs">
                           <span className="text-text-dim">آخر تحديث:</span>
                           <span className="font-mono">{uNotes.sort((a,b) => b.updatedAt - a.updatedAt)[0] ? formatDate(uNotes.sort((a,b) => b.updatedAt - a.updatedAt)[0].updatedAt).split('-')[0] : 'لا يوجد'}</span>
                         </div>
                         
                         <button 
                          onClick={() => openMemberNotesModal(member)}
                          className="w-full btn-luxury-outline py-3 text-xs flex items-center justify-center gap-2 mt-4 hover:border-red/40 hover:bg-red/10 hover:text-red transition-all duration-300 shadow-sm active:scale-95"
                         >
                           <Eye size={14} /> استعراض المفكرة
                         </button>
                       </div>
                     </div>
                   );
                 })}
              </div>
            </motion.div>
          )}

          {/* Ticket Detail Modal */}
          <AnimatePresence>
            {selectedTicketForModal && (
              <motion.div 
                initial={{ opacity: 0 }} 
                animate={{ opacity: 1 }} 
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/90 backdrop-blur-xl"
              >
                <motion.div 
                  initial={{ scale: 0.9, y: 30 }}
                  animate={{ scale: 1, y: 0 }}
                  exit={{ scale: 0.9, y: 30 }}
                  className="card w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col p-0 border-orange/30 shadow-[0_0_80px_rgba(255,106,0,0.2)] bg-[#0c0c0c]"
                >
                  {loadingTicket ? (
                    <div className="flex-1 flex flex-col items-center justify-center gap-6 p-20">
                       <div className="w-16 h-16 border-4 border-orange/20 border-t-orange rounded-full animate-spin"></div>
                       <p className="text-orange font-black tracking-widest uppercase text-xs animate-pulse">Decrypting Support Channel...</p>
                    </div>
                  ) : (
                    <>
                      <header className="p-8 bg-white/5 border-b border-white/10 flex justify-between items-center group">
                        <div className="flex items-center gap-6">
                          <div className="w-16 h-16 bg-orange/10 rounded-3xl flex items-center justify-center text-orange border border-orange/20 shadow-lg group-hover:scale-110 transition-transform">
                            <TicketIcon size={32} />
                          </div>
                          <div>
                            <h2 className="text-2xl font-black text-white font-arabic">{selectedTicketForModal.subject}</h2>
                            <p className="text-[10px] text-text-dim mt-1 uppercase tracking-[0.4em] font-orbitron">Ticket Documentation Center</p>
                          </div>
                        </div>
                        <button onClick={() => setSelectedTicketForModal(null)} className="w-12 h-12 flex items-center justify-center bg-white/10 hover:bg-red/20 rounded-full transition-all group">
                          <X className="text-white group-hover:text-red" />
                        </button>
                      </header>

                  <div className="flex-1 overflow-y-auto p-8 custom-scrollbar space-y-10">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div className="p-6 bg-white/[0.02] border border-white/5 rounded-3xl">
                        <p className="text-[9px] text-orange font-black uppercase tracking-widest mb-3">Status / الحالة</p>
                        <div className={`inline-block px-4 py-1.5 rounded-full text-[11px] font-black ${selectedTicketForModal.status === 'done' ? 'bg-green-500/10 text-green-500 border border-green-500/20' : selectedTicketForModal.status === 'working' ? 'bg-orange/10 text-orange border border-orange/20' : 'bg-blue-500/10 text-blue-400 border border-blue-500/10'}`}>
                          {selectedTicketForModal.status.toUpperCase()}
                        </div>
                      </div>
                      <div className="p-6 bg-white/[0.02] border border-white/5 rounded-3xl">
                        <p className="text-[9px] text-orange font-black uppercase tracking-widest mb-3">Creator / المنشئ</p>
                        <p className="font-bold text-white uppercase">{selectedTicketForModal.creator}</p>
                      </div>
                      <div className="p-6 bg-white/[0.02] border border-white/5 rounded-3xl">
                        <p className="text-[9px] text-orange font-black uppercase tracking-widest mb-3">Created At / التاريخ</p>
                        <p className="font-mono text-xs text-text-dim">{formatDate(selectedTicketForModal.createdAt)}</p>
                      </div>
                    </div>

                    <div className="space-y-6">
                      <h3 className="section-title text-orange font-bold flex items-center gap-2"><ClipboardList className="w-5 h-5" /> سجل المحادثات والأدلة</h3>
                      <div className="space-y-6">
                        {[...selectedTicketForModal.msgs].sort((a,b) => (a.timestamp || 0) - (b.timestamp || 0)).map((m, i) => (
                          <div key={i} className={`flex flex-col ${m.sender === 'system' ? 'items-center' : (m.sender === 'logs' ? 'items-end' : 'items-start')}`}>
                            <div className={`max-w-[90%] p-6 rounded-[32px] border ${m.sender === 'system' ? 'bg-white/5 border-white/10 text-orange/80 text-[11px]' : (m.sender === 'logs' ? 'bg-orange/10 border-orange/20 text-white' : 'bg-white/5 border-white/10 text-gray-200')}`}>
                               {m.sender !== 'system' && (
                                 <div className="flex items-center gap-3 mb-4 text-[10px] font-black tracking-widest border-b border-white/5 pb-2">
                                   <span className="text-orange">{m.senderName}</span>
                                   <span className="text-text-dim/40 font-mono">{formatDate(m.timestamp || 0)}</span>
                                 </div>
                               )}
                               {m.type === 'text' ? (
                                 <p className="leading-relaxed whitespace-pre-wrap font-arabic text-[14px]">{m.text}</p>
                               ) : (
                                 <div className="space-y-4">
                                   {m.type === 'image' ? (
                                      <img src={m.url} className="rounded-2xl max-h-[500px] w-full object-cover border border-white/10 shadow-2xl" />
                                   ) : (
                                      <video src={m.url} controls autoPlay muted playsInline className="rounded-2xl max-h-[500px] w-full" />
                                   )}
                                 </div>
                               )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <footer className="p-8 bg-black/40 border-t border-white/10 flex justify-end gap-4">
                     <button onClick={() => setSelectedTicketForModal(null)} className="btn-luxury-outline px-10 py-4 text-sm hover:bg-orange hover:text-black transition-all">إغلاق المعاينة</button>
                   </footer>
                 </>
               )}
             </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Member Notes Modal (Operations Notes Center Drawer / Modal) */}
          <AnimatePresence>
            {selectedMemberForNotes && (
              <motion.div 
                initial={{ opacity: 0 }} 
                animate={{ opacity: 1 }} 
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/95 backdrop-blur-xl"
              >
                <motion.div 
                  initial={{ scale: 0.95, y: 30 }}
                  animate={{ scale: 1, y: 0 }}
                  exit={{ scale: 0.95, y: 30 }}
                  className="card w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col p-0 border-red/30 shadow-[0_0_80px_rgba(239,68,68,0.15)] bg-[#0a0a0a]"
                >
                  {isLoadingMemberNotes ? (
                    <div className="flex-1 flex flex-col items-center justify-center gap-6 p-20 min-h-[400px]">
                      <div className="w-16 h-16 border-4 border-red/20 border-t-red rounded-full animate-spin"></div>
                      <p className="text-red font-black tracking-widest uppercase text-xs animate-pulse font-orbitron">Intercepting Tactical Uplink...</p>
                    </div>
                  ) : (
                    <>
                      {(() => {
                        const notes = personalNotes.filter(n => n.userId === selectedMemberForNotes.user);
                        const lastUpdated = notes.sort((a,b) => b.updatedAt - a.updatedAt)[0];
                        return (
                          <>
                            <header className="p-8 bg-white/5 border-b border-white/10 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                              <div className="flex items-center gap-6">
                                <div className="w-16 h-16 bg-red/10 rounded-3xl flex items-center justify-center text-red border border-red/20 shadow-lg font-black text-2xl">
                                  {selectedMemberForNotes.user.charAt(0).toUpperCase()}
                                </div>
                                <div>
                                  <div className="flex items-center gap-3">
                                    <h2 className="text-2xl font-black text-white font-orbitron tracking-wide">{selectedMemberForNotes.user}</h2>
                                    <span className={`text-[10px] px-2.5 py-1 rounded-full font-bold uppercase tracking-wider ${selectedMemberForNotes.status === 'active' ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-yellow-500/10 text-yellow-500 border border-yellow-500/20'}`}>
                                      ● {selectedMemberForNotes.status === 'active' ? 'ACTIVE' : 'AWAY'}
                                    </span>
                                  </div>
                                  <p className="text-[10px] text-text-dim mt-1.5 uppercase tracking-[0.4em] font-orbitron">
                                    Operations Intelligence Portal &bull; <span className="text-red">{notes.length} Notes Captured</span>
                                  </p>
                                </div>
                              </div>
                              <div className="flex items-center gap-4 w-full md:w-auto self-stretch md:self-auto justify-between">
                                <div className="text-right hidden sm:block">
                                  <p className="text-[9px] text-text-dim/60 uppercase tracking-widest font-mono">Last Modification</p>
                                  <p className="text-xs font-mono text-white/95 mt-1">{lastUpdated ? formatDate(lastUpdated.updatedAt) : 'N/A'}</p>
                                </div>
                                <button 
                                  onClick={() => setSelectedMemberForNotes(null)} 
                                  className="w-12 h-12 flex items-center justify-center bg-white/5 hover:bg-red/20 rounded-full transition-all text-white hover:text-red self-end md:self-auto"
                                >
                                  <X size={20} />
                                </button>
                              </div>
                            </header>

                            <div className="flex-1 overflow-y-auto p-8 custom-scrollbar min-h-0 bg-[#070707]">
                              {notes.length === 0 ? (
                                <div className="flex flex-col items-center justify-center p-20 text-center space-y-4">
                                  <StickyNote size={48} className="text-white/10" />
                                  <p className="text-sm text-text-dim">هذا العضو لم يقم بكتابة أي ملاحظات أو تقارير في مفكرته حتى الآن.</p>
                                </div>
                              ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                  {notes.map((note, index) => (
                                    <div 
                                      key={`member_note_${note.id}_${index}`} 
                                      onClick={() => {
                                        setIsLoadingNotePreview(true);
                                        setSelectedNoteForPreview(note);
                                        setTimeout(() => {
                                          setIsLoadingNotePreview(false);
                                        }, 400);
                                      }}
                                      className="p-6 rounded-3xl bg-black/40 border border-white/5 hover:border-red/20 hover:bg-black/80 hover:-translate-y-0.5 hover:shadow-[0_8px_30px_rgba(239,68,68,0.05)] cursor-pointer transition-all duration-300 flex flex-col justify-between group relative overflow-hidden"
                                    >
                                      {note.isPinned && <Star size={12} className="absolute left-6 top-6 text-red fill-red" />}
                                      <div>
                                        <div className="flex justify-between items-center mb-4">
                                          <span className="text-[10px] text-red font-bold uppercase tracking-wider bg-red/10 px-2.5 py-0.5 rounded-full border border-red/20">{note.category}</span>
                                          <span className="text-[10px] text-text-dim font-mono">{formatDate(note.updatedAt).split(' ')[0]}</span>
                                        </div>
                                        <h4 className="font-bold text-white text-base mb-3 group-hover:text-red transition-colors">{note.title}</h4>
                                        <p className="text-xs text-text-dim leading-relaxed whitespace-pre-line font-arabic mb-6 line-clamp-6">{note.content}</p>
                                      </div>
                                      <div className="pt-4 border-t border-white/5 flex justify-between items-center text-[10px] text-text-dim font-mono">
                                        <span>الأحرف: {note.content.length}</span>
                                        <div className="flex items-center gap-3">
                                          <button 
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              copyDiscordMention(note.content);
                                            }}
                                            className="text-red font-bold hover:underline flex items-center gap-1.5"
                                          >
                                            <Copy size={12} /> النسخ كمنشن
                                          </button>
                                          <span className="text-white/10">|</span>
                                          <button 
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setIsLoadingNotePreview(true);
                                              setSelectedNoteForPreview(note);
                                              setTimeout(() => setIsLoadingNotePreview(false), 440);
                                            }}
                                            className="text-orange font-bold hover:underline flex items-center gap-1.5"
                                          >
                                            <Eye size={12} /> معاينة
                                          </button>
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>

                            <footer className="p-8 bg-black/40 border-t border-white/10 flex justify-end">
                              <button 
                                onClick={() => setSelectedMemberForNotes(null)} 
                                className="btn-luxury-outline border-white/10 hover:border-red/35 px-10 py-3.5 text-xs font-bold uppercase tracking-widest transition-all"
                              >
                                Close Intelligence Logs
                              </button>
                            </footer>
                          </>
                        );
                      })()}
                    </>
                  )}
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Note Preview Overlay Pane */}
          <AnimatePresence>
            {selectedNoteForPreview && (
              <motion.div 
                initial={{ opacity: 0 }} 
                animate={{ opacity: 1 }} 
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/95 backdrop-blur-2xl"
              >
                <motion.div 
                  initial={{ scale: 0.95, y: 30 }}
                  animate={{ scale: 1, y: 0 }}
                  exit={{ scale: 0.95, y: 30 }}
                  className="card w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col p-0 border-orange/30 shadow-[0_0_80px_rgba(255,106,0,0.25)] bg-[#070708]"
                >
                  {isLoadingNotePreview ? (
                    <div className="flex-1 flex flex-col items-center justify-center gap-6 p-24 min-h-[400px]">
                      <div className="w-16 h-16 border-4 border-orange/25 border-t-orange rounded-full animate-spin"></div>
                      <p className="text-orange font-black tracking-widest uppercase text-xs animate-pulse font-mono font-bold">Accessing Note Database...</p>
                    </div>
                  ) : (
                    <>
                      {/* Header */}
                      <header className="p-8 bg-white/[0.03] border-b border-white/10 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                        <div className="flex items-center gap-5">
                          <div className="w-14 h-14 bg-orange/10 rounded-2xl flex items-center justify-center text-orange border border-orange/20 shadow-[0_0_20px_rgba(255,106,0,0.1)]">
                            <StickyNote size={28} />
                          </div>
                          <div>
                            <div className="flex items-center gap-3">
                              <span className="text-[10px] text-orange font-black uppercase tracking-wider bg-orange/10 px-2.5 py-0.5 rounded-full border border-orange/20">
                                {selectedNoteForPreview.category}
                              </span>
                              <span className="text-[10px] text-text-dim/60 font-mono tracking-wider">
                                DOCUMENT ID: #{String(selectedNoteForPreview.id).slice(-6).toUpperCase()}
                              </span>
                            </div>
                            <h3 className="text-xl font-bold text-white mt-1.5">{selectedNoteForPreview.title}</h3>
                          </div>
                        </div>
                        <button 
                          onClick={() => setSelectedNoteForPreview(null)} 
                          className="w-10 h-10 flex items-center justify-center bg-white/5 hover:bg-orange/20 rounded-full transition-all text-white hover:text-orange self-end sm:self-auto"
                        >
                          <X size={18} />
                        </button>
                      </header>

                      {/* Content Area */}
                      <div className="flex-1 overflow-y-auto p-8 custom-scrollbar bg-black/40 grid grid-cols-1 lg:grid-cols-4 gap-8">
                        {/* Note Full Body Text Panel - taking 3/4 space */}
                        <div className="lg:col-span-3 flex flex-col space-y-4">
                          <p className="text-[11px] text-orange/80 font-mono uppercase tracking-[0.2em] font-bold">FULL NOTE TRANSCRIPT</p>
                          <div className="w-full flex-1 p-6 rounded-2xl bg-black/60 border border-white/5 shadow-inner min-h-[250px] overflow-y-auto custom-scrollbar">
                            <div className="whitespace-pre-line text-sm text-white/90 leading-relaxed font-arabic break-words tracking-wide">
                              {renderHighlightedText(selectedNoteForPreview.content)}
                            </div>
                          </div>
                        </div>

                        {/* Diagnostics & Meta Data Panel - taking 1/4 space */}
                        <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/5 flex flex-col justify-between space-y-6">
                          <div>
                            <p className="text-[11px] text-orange/95 font-mono uppercase tracking-[0.2em] font-bold mb-4">TACTICAL DETAILS</p>
                            <div className="space-y-4">
                              <div>
                                <p className="text-[9px] text-text-dim/60 uppercase font-mono">OP_AGENT_NAME</p>
                                <div className="flex items-center gap-2 mt-1">
                                  <div className="w-6 h-6 bg-white/5 rounded-full flex items-center justify-center text-[10px] font-bold text-orange">
                                    {selectedMemberForNotes ? selectedMemberForNotes.user.charAt(0).toUpperCase() : 'A'}
                                  </div>
                                  <p className="text-xs font-bold text-white font-mono">{selectedMemberForNotes ? selectedMemberForNotes.user : 'Unknown'}</p>
                                </div>
                              </div>
                              <div>
                                <p className="text-[9px] text-text-dim/60 uppercase font-mono">LAST_INDEXED</p>
                                <p className="text-xs font-mono text-white/90 mt-1">{formatDate(selectedNoteForPreview.updatedAt)}</p>
                              </div>
                              <div>
                                <p className="text-[9px] text-text-dim/60 uppercase font-mono">DOCUMENT_WEIGHT</p>
                                <p className="text-xs font-mono text-white/90 mt-1">{selectedNoteForPreview.content.length} characters</p>
                              </div>
                              <div>
                                <p className="text-[9px] text-text-dim/60 uppercase font-mono">COPIED_MENTIONS</p>
                                <p className="text-xs font-mono text-white/90 mt-1">
                                  {(selectedNoteForPreview.content.match(/\d{17,19}/g) || []).length} Mentions Found
                                </p>
                              </div>
                            </div>
                          </div>

                          <div className="pt-4 border-t border-white/5 text-[10px] text-text-dim/40 font-mono tracking-widest text-center uppercase">
                            STATE: ENCRYPTED
                          </div>
                        </div>
                      </div>

                      {/* Footer Actions */}
                      <footer className="p-8 bg-black/60 border-t border-white/10 flex flex-col sm:flex-row gap-4 justify-between items-center">
                        <p className="text-[10px] text-text-dim font-mono uppercase tracking-wider text-center sm:text-left">
                          * ANY DISCORD RAW ID DETECTED IS AUTOMATICALLY HIGH-LIGHTED AND PARSED TO &lt;@ID&gt;
                        </p>
                        <div className="flex items-center gap-4 w-full sm:w-auto">
                          <button 
                            onClick={() => copyFullNoteContent(selectedNoteForPreview.content)}
                            className="w-full sm:w-auto btn-luxury py-3 px-8 text-xs font-black tracking-wider flex items-center justify-center gap-2 text-black bg-orange hover:bg-orange/80 shadow-[0_0_20px_rgba(255,106,0,0.2)] hover:scale-[1.02] active:scale-95 transition-all duration-300"
                          >
                            <Copy size={14} /> نسخ كامل محتوى المفكرة
                          </button>
                          <button 
                            onClick={() => setSelectedNoteForPreview(null)}
                            className="w-full sm:w-auto btn-luxury-outline border-white/10 hover:border-orange/30 py-3 px-8 text-xs font-black tracking-wider transition-all duration-300 active:scale-95"
                          >
                            إغلاق المعاينة
                          </button>
                        </div>
                      </footer>
                    </>
                  )}
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

<AnimatePresence>
            {/* Ticket Notifications */}
            <div className="fixed top-6 right-6 z-[200] flex flex-col gap-3 items-end">
              {notifications.map(n => (
                <motion.div
                  key={n.id}
                  initial={{ opacity: 0, x: 80 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 80 }}
                  className="bg-[#111] border border-orange/50 text-white px-5 py-3.5 rounded-2xl font-bold shadow-[0_10px_40px_rgba(255,102,0,0.25)] flex items-center gap-3 backdrop-blur-md cursor-pointer hover:border-orange transition-all"
                  onClick={() => { setActiveSec('tickets'); setActiveTicketId(n.ticketId); setNotifications(prev => prev.filter(x => x.id !== n.id)); }}
                >
                  <TicketIcon size={18} className="text-orange shrink-0" />
                  <span className="text-sm font-black text-gray-100 max-w-[260px]">{n.msg}</span>
                  <button onClick={e => { e.stopPropagation(); setNotifications(prev => prev.filter(x => x.id !== n.id)); }} className="text-white/30 hover:text-white transition-colors ml-1">
                    <X size={14} />
                  </button>
                </motion.div>
              ))}
            </div>

            {toast && (
              <motion.div 
                initial={{ opacity: 0, y: 50, x: '-50%' }}
                animate={{ opacity: 1, y: 0, x: '-50%' }}
                exit={{ opacity: 0, y: 20, x: '-50%' }}
                className="fixed bottom-10 left-1/2 z-[100] bg-[#111] border border-orange/40 text-white px-6 py-3.5 rounded-xl font-bold shadow-[0_10px_40px_rgba(255,102,0,0.2)] flex items-center gap-3 backdrop-blur-md min-w-[300px] justify-center"
              >
                {/* فحص كلمة جاري من كائن التوست بشكل صحيح */}
                {toast.msg.includes("جاري") ? (
                  <div className="w-5 h-5 border-2 border-orange border-t-transparent rounded-full animate-spin shadow-[0_0_10px_#f60]" />
                ) : toast.msg.includes("❌") ? (
                  <XCircle size={20} className="text-red-500" />
                ) : (
                  <CheckCircle2 size={20} className="text-orange" />
                )}
                
                <span className="text-sm font-black text-gray-100">{toast.msg}</span>
              </motion.div>
            )}
          </AnimatePresence>

          {activeSec === 'leaderboard' && isStaff && (
            <motion.div key="leaderboard" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-10 px-[4%] max-w-5xl mx-auto">
              <header className="text-center space-y-4">
                <div className="inline-block p-4 bg-yellow-500/10 rounded-[2rem] border border-yellow-500/20 mb-4">
                  <Trophy className="text-yellow-500" size={48} />
                </div>
                <h1 className="text-4xl font-black font-orbitron tracking-[0.2em]">MT <span className="text-yellow-500">LEADERBOARD</span></h1>
                <p className="text-text-dim text-sm uppercase tracking-[0.5em]">Global Excellence Ranking</p>
              </header>

              <div className="space-y-4 pb-20">
                {stats?.leaderboard.map((u, i) => (
                  <motion.div 
                    initial={{ x: -20, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    transition={{ delay: i * 0.1 }}
                    key={`leaderboard_${u.user}_${i}`} 
                    className={`card flex items-center justify-between p-6 group transition-all ${i === 0 ? 'border-yellow-500/40 bg-yellow-500/5 shadow-[0_0_40px_rgba(234,179,8,0.1)]' : i === 1 ? 'border-gray-400/40' : i === 2 ? 'border-orange/40' : 'border-white/5 opacity-80'}`}
                  >
                    <div className="flex items-center gap-8">
                       <div className="flex items-center justify-center w-12 h-12 relative">
                         {i === 0 && <Star className="absolute -top-3 text-yellow-500 fill-yellow-500 animate-bounce" size={20} />}
                         <span className={`text-4xl font-black font-orbitron ${i === 0 ? 'text-yellow-500' : 'text-white/20'}`}>0{i + 1}</span>
                       </div>
                       <div className="flex items-center gap-4">
                         <div className={`w-14 h-14 rounded-2xl border flex items-center justify-center text-xl font-black ${i === 0 ? 'bg-yellow-500/20 border-yellow-500/40 text-yellow-500' : 'bg-white/5 border-white/10'}`}>
                           {u.user.charAt(0).toUpperCase()}
                         </div>
                         <div>
                           <h4 className="font-bold text-lg">{u.user}</h4>
                           <span className="text-[10px] text-text-dim font-bold uppercase tracking-widest">{u.user === currentUser.user ? '(أنت)' : 'عضو الفريق'}</span>
                         </div>
                       </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-6 md:gap-12 justify-center md:justify-end">
                      <div className="text-center">
                        <p className="text-[9px] text-text-dim uppercase tracking-widest mb-1">تذاكر</p>
                        <p className="font-orbitron font-black text-xl">{u.tickets}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-[9px] text-text-dim uppercase tracking-widest mb-1">باند</p>
                        <p className="font-orbitron font-black text-xl">{u.bans}</p>
                      </div>
                      <div className="h-12 w-[1px] bg-white/5 mx-2 hidden md:block" />
                      <div className="text-center min-w-[80px]">
                        <p className="text-[9px] text-yellow-500 font-bold uppercase tracking-widest mb-1">مجموع النقاط</p>
                        <p className="font-orbitron font-black text-3xl text-yellow-500">{u.total}</p>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}

          {/* BANS SECTION (THE NEW SYSTEM) */}
          {activeSec === 'bans' && isStaff && (
            <motion.div key="bans" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-8 animate-in">
              <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                <div className="flex flex-col border-r-4 border-orange pr-4">
                  <h1 className="text-2xl font-black text-white font-arabic">نظام معلومات الباند</h1>
                  <p className="text-[10px] text-text-dim uppercase tracking-widest font-orbitron">Bans Management System</p>
                </div>
                
                <div className="flex flex-col sm:flex-row w-full md:w-auto gap-4 items-center">
                  <div className="relative w-full sm:w-80 group">
                    <div className="absolute -inset-0.5 bg-orange/20 rounded-2xl blur opacity-0 group-hover:opacity-100 transition-opacity"></div>
                    <Search className="absolute right-4 top-3.5 text-text-dim w-5 h-5 group-hover:text-orange transition-colors" />
                    <input 
                      type="text" 
                      placeholder="بحث (ID, السبب, المسؤول)..." 
                      className="input-field pr-12 text-sm h-12 bg-black/60 border-white/5 focus:border-orange/30 transition-all rounded-xl relative z-10" 
                      value={banSearchQuery}
                      onChange={e => setBanSearchQuery(e.target.value)}
                    />
                  </div>
                  <button className="btn-orange flex items-center justify-center gap-3 whitespace-nowrap h-12 w-full sm:w-auto px-10 shadow-[0_10px_30px_rgba(255,106,0,0.2)] hover:scale-105 active:scale-95 transition-all" onClick={() => setShowBanForm(true)}>
                    <PlusCircle className="w-5 h-5" /> <span>رفع حالة جديدة</span>
                  </button>
                </div>
              </header>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                {/* Bans List */}
                <div className="lg:col-span-8 flex flex-col gap-6">
                  <AnimatePresence mode="popLayout">
                    {filteredBans.length === 0 ? (
                      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="card py-32 text-center text-text-dim space-y-6 border-dashed border-2 border-white/5 rounded-[40px]">
                        <Search className="w-20 h-20 mx-auto opacity-10 animate-pulse" />
                        <p className="text-xl font-arabic">لا توجد سجلات مطابقة لمعايير البحث</p>
                      </motion.div>
                    ) : (
                      filteredBans.map((ban, index) => (
                        <motion.div 
                          layout 
                          initial={{ opacity: 0, x: 20 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, scale: 0.95 }}
                          key={`ban_item_${ban.id}_${index}`} 
                          className="card relative overflow-hidden group hover:border-orange/40 border-orange/10 border-r-[6px] !p-6 transition-all shadow-[0_20px_50px_rgba(0,0,0,0.4)] bg-[#0c0c0c]/80 rounded-[30px]"
                        >
                          <div className="absolute -left-20 -top-20 w-48 h-48 bg-orange/[0.03] blur-[80px] rounded-full pointer-events-none"></div>
                          
                          <div className="flex justify-between items-start mb-6">
                            <div className="flex items-center gap-4">
                              <div className="w-14 h-14 bg-white/[0.03] rounded-2xl border border-orange/20 flex items-center justify-center text-orange font-black text-xl shadow-[inset_0_0_20px_rgba(255,106,0,0.05)] group-hover:scale-110 group-hover:border-orange/50 transition-all duration-500">
                                {ban.type.slice(0, 1).toUpperCase()}
                              </div>
                              <div>
                                 <h3 className="text-white font-black text-xl flex items-center gap-3">
                                  سجل رقم {String(ban.id).slice(-4).toUpperCase()}
                                  <div className="flex gap-2">
                                    <span className={`text-[10px] px-3 py-1 rounded-full font-black uppercase tracking-widest shadow-lg ${ban.type === 'Ban' ? 'bg-red text-white' : (ban.type === 'Hack' ? 'bg-red/20 text-red border border-red/20' : 'bg-yellow-500/20 text-yellow-500 border border-yellow-500/10')}`}>
                                      {ban.type}
                                    </span>
                                  </div>
                                </h3>
                                <div className="flex items-center gap-2 mt-1">
                                  <Clock className="w-3 h-3 text-text-dim" />
                                  <p className="text-[11px] text-text-dim/80 font-mono">{formatDate(ban.createdAt)}</p>
                                </div>
                              </div>
                            </div>
                            
                            {isManager && (
                              <div className="flex gap-2">
                                <button className="w-12 h-12 flex items-center justify-center bg-white/5 hover:bg-orange/20 rounded-xl text-orange transition-all border border-orange/10 hover:border-orange/30 shadow-lg active:scale-95" onClick={() => editBan(ban)}>
                                  <Settings className="w-6 h-6" />
                                </button>
                                <button className="w-12 h-12 flex items-center justify-center bg-white/5 hover:bg-red/20 rounded-xl text-red transition-all border border-red/10 hover:border-red/30 shadow-lg active:scale-95" onClick={() => deleteBan(ban.id)}>
                                  <Trash2 className="w-6 h-6" />
                                </button>
                              </div>
                            )}
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                            <div className="space-y-4">
                              <div className="p-5 bg-white/[0.02] rounded-2xl border border-white/5 space-y-3 hover:border-orange/20 transition-all shadow-inner relative group/field">
                                <div className="flex justify-between items-center">
                                  <p className="text-[10px] text-orange font-black uppercase tracking-widest flex items-center gap-2">Discord ID / ديسكورد</p>
                                  <button onClick={() => copyField('Discord ID', ban.discordId)} className="text-orange hover:text-white transition-colors bg-orange/10 p-1.5 rounded-lg opacity-40 group-hover/field:opacity-100">
                                    <Target className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                                <p className="text-sm font-mono text-white/90 break-all bg-black/40 px-4 py-3 rounded-xl border border-orange/10 shadow-lg select-all">{ban.discordId}</p>
                              </div>

                              <div className="p-6 bg-white/[0.03] rounded-[28px] border border-white/5 space-y-4 hover:border-orange/20 transition-all shadow-2xl relative group/player-info">
                                <div className="flex justify-between items-center mb-1">
                                  <div className="flex items-center gap-3">
                                    <div className="p-2 bg-orange/10 rounded-xl border border-orange/20">
                                      <UserIcon className="w-4 h-4 text-orange" />
                                    </div>
                                    <p className="text-[11px] text-orange font-black uppercase tracking-[0.2em] font-orbitron">Identity Profile / هوية اللاعب</p>
                                  </div>
                                  <button 
                                    onClick={() => copyFullInfo(ban)}
                                    className="flex items-center gap-2 bg-orange text-black px-4 py-2 rounded-xl text-[10px] font-black hover:scale-105 active:scale-95 transition-all shadow-[0_5px_15px_rgba(255,106,0,0.2)] z-20"
                                  >
                                    <Plus className="rotate-45 w-3 h-3" />
                                    نسخ المعلومات كاملة
                                  </button>
                                </div>
                                <div className="bg-[#030303] p-7 rounded-[32px] border border-orange/10 shadow-inner relative group/ids overflow-hidden group-hover:border-orange/30 transition-colors">
                                  <div className="absolute inset-0 bg-gradient-to-br from-orange/[0.03] to-transparent pointer-events-none"></div>
                                  <div className="absolute -right-8 -top-8 text-orange/5 rotate-12 blur-sm group-hover:scale-125 transition-transform">
                                    <Shield size={120} />
                                  </div>
                                  <div className="text-[13px] font-mono text-white/80 leading-relaxed whitespace-pre-wrap break-all pr-4 custom-scrollbar max-h-[350px] overflow-y-auto relative z-10" dir="ltr">
                                    {renderIdentifiers(ban.identifiers)}
                                  </div>
                                </div>
                              </div>
                            </div>
                            
                            <div className="space-y-4 flex flex-col h-full">
                              <div className="p-6 bg-[#080808] rounded-[28px] border border-white/5 flex-1 relative group/reason overflow-hidden min-h-[140px] shadow-xl hover:border-orange/10 transition-all">
                                <div className="absolute -right-6 -bottom-6 opacity-[0.03] text-orange group-hover:scale-110 transition-transform">
                                  <ShieldAlert size={100} />
                                </div>
                                <div className="text-[10px] text-orange font-black uppercase tracking-[0.3em] mb-4 flex items-center gap-2">
                                  <div className="w-1.5 h-1.5 bg-orange rounded-full animate-pulse"></div>
                                  Incident Details / تفاصيل المخالفة
                                </div>
                                <p className="text-[15px] text-gray-100 leading-relaxed font-arabic font-medium relative z-10">{ban.reason}</p>
                              </div>
                              
                              {ban.updatedAt && (
                                <div className="p-5 bg-orange/5 border border-orange/20 rounded-[24px] space-y-3 shadow-lg relative overflow-hidden group/edit">
                                  <div className="absolute top-0 right-0 w-1 h-full bg-orange opacity-40"></div>
                                  <div className="text-[10px] text-orange font-black uppercase tracking-widest flex items-center gap-2">
                                    <div className="p-1.5 bg-orange/20 rounded-lg">
                                      <Settings size={12} />
                                    </div>
                                    تم التعديل بواسطة: <span className="text-white hover:text-orange transition-colors">{ban.updatedBy}</span>
                                  </div>
                                  <div className="flex items-center gap-2 text-[11px] font-mono text-text-dim/70">
                                    <Clock size={10} />
                                    {formatDate(ban.updatedAt)}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="space-y-6 pt-6 border-t border-white/5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6">
                            <div className="flex items-center gap-4">
                              <div className="relative">
                                <div className="absolute -inset-1 bg-orange/20 rounded-full blur-sm"></div>
                                <div className="w-12 h-12 rounded-2xl bg-[#111] border border-orange/30 flex items-center justify-center text-orange font-black text-sm uppercase shadow-xl relative z-10">
                                  {ban.bannedBy[0]}
                                </div>
                              </div>
                              <div>
                                <p className="text-[9px] text-text-dim font-black uppercase tracking-[0.1em] mb-0.5">Authorizing Staff / المسؤول</p>
                                <p className="text-sm text-white font-bold tracking-wide">{ban.bannedBy}</p>
                              </div>
                            </div>
                            
                            <div className="w-full sm:w-auto">
                              <p className="text-[9px] text-text-dim font-black uppercase tracking-[0.2em] mb-3 text-right hidden sm:block">Evidence Storage / المرفقات</p>
                              <div className="flex items-center gap-3 overflow-x-auto no-scrollbar max-w-full pb-2">
                                {ban.evidence.map((ev, i) => (
                                  <div key={i} className="group/ev relative flex-shrink-0">
                                    <div className="w-20 h-20 rounded-2xl bg-[#0a0a0a] border border-white/10 overflow-hidden relative cursor-default shadow-lg group-hover/ev:border-orange/40 transition-all duration-300">
                                      {ev.type === 'image' ? (
                                        <img src={ev.url} className="w-full h-full object-cover opacity-60 group-hover/ev:opacity-90 transition-all duration-500 scale-110 group-hover/ev:scale-100" />
                                      ) : (
                                        <div className="w-full h-full flex flex-col items-center justify-center bg-orange/5 gap-1">
                                          <Video className="w-6 h-6 text-orange opacity-60" />
                                          <span className="text-[8px] text-orange/40 font-black uppercase">Video</span>
                                        </div>
                                      )}
                                      
                                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover/ev:opacity-100 transition-all flex flex-col items-center justify-center gap-2">
                                        <button 
                                          className="w-12 h-8 bg-orange text-black rounded-lg text-[9px] font-black hover:scale-105 active:scale-95 transition-all flex items-center justify-center gap-1.5"
                                          onClick={() => setFullScreenMedia({ url: ev.url, type: ev.type as 'image' | 'video' })}
                                        >
                                          <Eye size={12} />
                                          معاينة
                                        </button>
                                        {isManager && (
                                          <button 
                                            className="w-12 h-6 bg-red/80 text-white rounded-lg text-[9px] font-black hover:bg-red transition-all flex items-center justify-center"
                                            onClick={(e) => { e.stopPropagation(); removeEvidence(ban.id, i); }}
                                          >
                                            <Trash2 size={10} />
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                    <div className="absolute -bottom-2 -right-2 bg-orange/10 border border-orange/20 rounded-lg px-2 py-0.5 text-[8px] text-orange font-black uppercase backdrop-blur-sm shadow-sm z-10">
                                      #{i+1}
                                    </div>
                                  </div>
                                ))}
                                {ban.evidence.length === 0 && (
                                  <div className="flex items-center gap-3 px-6 py-4 bg-white/[0.02] border border-dashed border-white/10 rounded-2xl text-text-dim italic text-xs">
                                    <Archive size={14} />
                                    لا توجد مرفقات أدلة
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </motion.div>
                      ))
                    )}
                  </AnimatePresence>
                </div>

                {/* Sidebar Stats */}
                <aside className="lg:col-span-4 space-y-8">
                  <div className="card space-y-8 bg-[#0c0c0c]/60 sticky top-32 rounded-[32px] border-white/5 shadow-2xl backdrop-blur-md">
                    <div className="flex items-center gap-3 border-b border-white/5 pb-6">
                      <div className="w-12 h-12 bg-orange/10 rounded-2xl flex items-center justify-center text-orange">
                        <BarChart2 />
                      </div>
                      <div>
                        <h2 className="text-xl font-black text-white font-arabic">مركز البيانات</h2>
                        <p className="text-[9px] text-text-dim uppercase tracking-widest font-orbitron">Analytics Overview</p>
                      </div>
                    </div>
                    
                    <div className="space-y-5">
                      <div className="bg-white/[0.02] p-6 rounded-[24px] border border-white/5 flex items-center justify-between group hover:bg-white/[0.04] hover:border-orange/20 transition-all duration-500 shadow-lg">
                        <div className="space-y-1">
                          <p className="text-[10px] text-text-dim font-black uppercase tracking-widest">Total Cases</p>
                          <p className="text-sm font-arabic text-white/50">إجمالي الحالات</p>
                        </div>
                        <span className="text-4xl font-black text-orange drop-shadow-[0_0_10px_rgba(255,106,0,0.3)]">{bans.length}</span>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="bg-white/[0.02] p-5 rounded-[24px] border border-white/5 flex flex-col items-center gap-2 hover:bg-red/5 hover:border-red/20 transition-all">
                          <p className="text-[9px] text-text-dim font-black uppercase tracking-[0.2em]">Bans</p>
                          <span className="text-2xl font-black text-red">{bans.filter(b => b.type === 'Ban').length}</span>
                        </div>
                        <div className="bg-white/[0.02] p-5 rounded-[24px] border border-white/5 flex flex-col items-center gap-2 hover:bg-orange/5 hover:border-orange/20 transition-all">
                          <p className="text-[9px] text-text-dim font-black uppercase tracking-[0.2em]">Hacks</p>
                          <span className="text-2xl font-black text-orange">{bans.filter(b => b.type === 'Hack').length}</span>
                        </div>
                      </div>

                      <div className="bg-white/[0.02] p-6 rounded-[24px] border border-white/5 flex items-center justify-between hover:bg-yellow-500/5 hover:border-yellow-500/20 transition-all">
                        <div className="space-y-1">
                          <p className="text-[10px] text-text-dim font-black uppercase tracking-widest">Glitches/Other</p>
                          <p className="text-xs font-arabic text-white/40">ثغرات وتلاعب</p>
                        </div>
                        <span className="text-3xl font-black text-yellow-500">{bans.filter(b => b.type === 'Glitch').length}</span>
                      </div>
                    </div>

                    <div className="pt-8 border-t border-white/5">
                      <div className="p-6 bg-orange/10 border border-orange/20 rounded-[28px] relative overflow-hidden group">
                        <ShieldAlert className="absolute -right-4 -bottom-4 text-orange/5 w-24 h-24 rotate-12 group-hover:scale-110 transition-transform" />
                        <p className="text-sm font-black text-orange mb-3 flex items-center gap-2 relative z-10">
                           <ShieldCheck className="w-5 h-5 flex-shrink-0" /> بروتوكول التوثيق
                        </p>
                        <p className="text-[11px] text-text-dim leading-loose relative z-10 font-medium font-arabic">
                          نظام Mystery Town يعتمد على الدقة المطلقة. يرجى التأكد من أن جميع الأدلة (Evidence) واضحة وشاملة لجميع السجلات (Logs) المطلوبة قبل حفظ أي حالة جديدة.
                        </p>
                      </div>
                    </div>
                  </div>
                </aside>
              </div>

              {/* Ban Form Modal */}
              <AnimatePresence>
                {showBanForm && (
                  <motion.div 
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    className="fixed inset-0 z-50 flex items-start justify-center p-4 py-10 md:py-20 bg-black/95 backdrop-blur-2xl overflow-y-auto custom-scrollbar"
                  >
                    <motion.div 
                       initial={{ scale: 0.9, opacity: 0, y: 30 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.9, opacity: 0, y: 30 }}
                       className="card w-full max-w-3xl space-y-8 border-orange/30 shadow-[0_0_100px_rgba(255,106,0,0.2)] p-8 md:p-10 rounded-[40px] relative overflow-visible bg-[#0a0a0a]"
                       dir="rtl"
                    >
                      <div className="absolute top-0 right-0 w-32 h-32 bg-orange/5 blur-3xl pointer-events-none"></div>
                      
                      <div className="flex justify-between items-start border-b border-white/5 pb-8">
                        <div className="flex items-center gap-5">
                          <div className="w-16 h-16 bg-orange/10 rounded-2xl border border-orange/20 flex items-center justify-center text-orange shadow-2xl">
                            <Gavel size={32} strokeWidth={2.5} />
                          </div>
                          <div>
                            <h3 className="text-3xl font-black text-white font-arabic">{editingBanId ? 'تعديل وثيقة الحالة' : 'رفع حالة جديدة'}</h3>
                            <p className="text-[10px] text-orange font-black uppercase tracking-[0.3em] mt-2 opacity-60">Authentication & Verification Layer</p>
                          </div>
                        </div>
                        <button onClick={() => { setShowBanForm(false); setEditingBanId(null); }} className="w-12 h-12 flex items-center justify-center bg-white/5 hover:bg-red/20 rounded-full transition-all group">
                          <X className="text-text-dim group-hover:text-red transition-colors w-6 h-6" />
                        </button>
                      </div>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div className="space-y-4">
                          <label className="text-xs font-black text-orange px-2 block text-right uppercase tracking-[0.2em] font-orbitron">Case Type / نوع الحالة</label>
                          <div className="flex bg-black/60 p-1.5 rounded-2xl border border-white/5 shadow-inner">
                            {['Ban', 'Hack', 'Glitch'].map((t) => (
                              <button 
                                key={t}
                                onClick={() => setBanForm({...banForm, type: t as any})}
                                className={`flex-1 py-3.5 rounded-[14px] text-xs font-black transition-all duration-300 ${banForm.type === t ? 'bg-orange text-black shadow-lg scale-100' : 'text-text-dim hover:text-white bg-transparent opacity-60'}`}
                              >
                                {t}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="space-y-4">
                          <label className="text-xs font-black text-orange px-2 block text-right uppercase tracking-[0.2em] font-orbitron">Main Identifier / ديسكورد</label>
                          <div className="relative group/input">
                            <Target className="absolute right-4 top-4 text-text-dim/40 w-5 h-5 group-focus-within/input:text-orange transition-colors" />
                            <input type="text" className="input-field h-14 pr-12 text-sm font-mono bg-black border-white/10 rounded-2xl shadow-inner focus:border-orange/30 group-hover/input:border-white/20 transition-all" placeholder="Enter Discord ID..." value={banForm.discordId} onChange={e => setBanForm({...banForm, discordId: e.target.value})} />
                          </div>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <label className="text-xs font-black text-orange px-2 block text-right uppercase tracking-[0.2em] font-orbitron">Player Identity Details / معلومات اللاعب</label>
                        <div className="relative group/idbox">
                          <div className="absolute -inset-0.5 bg-orange/10 rounded-[32px] blur opacity-0 group-focus-within/idbox:opacity-100 transition-opacity"></div>
                          <textarea 
                            className="w-full bg-[#050505] border border-orange/20 rounded-[32px] p-6 text-sm font-mono text-white/90 focus:border-orange/50 outline-none transition-all min-h-[140px] shadow-inner relative z-10 custom-scrollbar leading-relaxed" 
                            dir="ltr"
                            placeholder="Paste identifiers block here (license, steam, discord, etc...)" 
                            value={banForm.identifiers} 
                            onChange={e => setBanForm({...banForm, identifiers: e.target.value})}
                          ></textarea>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <label className="text-xs font-black text-orange px-2 block text-right uppercase tracking-[0.2em] font-orbitron">Violation Analysis / تحليل المخالفة</label>
                        <textarea className="input-field min-h-[100px] py-4 px-6 text-[13px] bg-black border-white/10 rounded-3xl font-arabic leading-relaxed focus:border-orange/30" placeholder="شرح تفصيلي للمخالفة..." value={banForm.reason} onChange={e => setBanForm({...banForm, reason: e.target.value})}></textarea>
                      </div>

                      <div className="space-y-6">
                        <div className="flex justify-between items-center px-2">
                           <label className="text-xs font-black text-orange uppercase tracking-[0.2em] font-orbitron">Media Documentation / التوثيق المرئي</label>
                           {banEvidenceFiles.length > 0 && <span className="text-[10px] font-black text-orange bg-orange/10 px-3 py-1 rounded-full border border-orange/20 animate-pulse">{banEvidenceFiles.length} FILES ADDED</span>}
                        </div>
                        
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
                          <label className="cursor-pointer bg-black/40 border-2 border-dashed border-white/5 aspect-square rounded-[32px] flex flex-col items-center justify-center gap-4 hover:bg-orange/5 hover:border-orange/20 transition-all group relative shadow-inner overflow-hidden">
                             <input type="file" multiple accept="image/*,video/*" hidden onChange={e => {
                                if (e.target.files) {
                                  const files = Array.from(e.target.files) as File[];
                                  setBanEvidenceFiles([...banEvidenceFiles, ...files]);
                                  files.forEach(async (f: File) => {
                                    const url = await fileToBase64(f);
                                    setMediaPreviews(prev => [...prev, { url, type: f.type.startsWith('image') ? 'image' : 'video' }]);
                                  });
                                }
                             }} />
                             <div className="w-14 h-14 bg-orange/5 rounded-full flex items-center justify-center shadow-lg group-hover:scale-110 group-hover:bg-orange/20 transition-all duration-500">
                               <Plus className="text-orange w-8 h-8" />
                             </div>
                             <span className="text-[9px] font-black text-text-dim group-hover:text-white uppercase tracking-widest px-4 text-center">Drag & Drop Evidence</span>
                          </label>
                          
                          {mediaPreviews.map((m, i) => (
                            <div key={i} className="relative aspect-square bg-black rounded-[32px] border border-orange/20 overflow-hidden group shadow-[0_0_20px_rgba(255,106,0,0.1)] hover:shadow-[0_0_30px_rgba(255,106,0,0.2)] transition-all">
                               <div className="absolute inset-0">
                                  {m.type === 'image' ? (
                                    <img src={m.url} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" />
                                  ) : (
                                    <div className="w-full h-full flex items-center justify-center bg-orange/5 relative overflow-hidden">
                                       <Video size={32} className="text-orange opacity-40" />
                                       <div className="absolute inset-0 flex items-center justify-center">
                                          <div className="w-10 h-10 bg-orange/20 rounded-full flex items-center justify-center border border-orange/40 shadow-inner group-hover:scale-110 transition-all">
                                            <div className="w-0 h-0 border-t-4 border-t-transparent border-l-8 border-l-orange border-b-4 border-b-transparent translate-x-0.5" />
                                          </div>
                                       </div>
                                    </div>
                                  )}
                               </div>
                               <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/80 to-transparent flex justify-between items-center opacity-0 group-hover:opacity-100 transition-opacity">
                                  <span className="text-[8px] font-black text-white uppercase tracking-widest">{m.type}</span>
                               </div>
                               <button 
                                 className="absolute top-3 left-3 w-8 h-8 bg-red/80 hover:bg-red text-white flex items-center justify-center rounded-xl opacity-0 group-hover:opacity-100 transition-all translate-y-2 group-hover:translate-y-0 shadow-lg backdrop-blur-sm z-20" 
                                 onClick={() => {
                                   setBanEvidenceFiles(banEvidenceFiles.filter((_, idx) => idx !== i));
                                   setMediaPreviews(mediaPreviews.filter((_, idx) => idx !== i));
                                 }}
                               >
                                  <Trash2 size={16} />
                               </button>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="pt-6 border-t border-white/5 flex flex-col sm:flex-row gap-5">
                         <button className="flex-[3] bg-orange text-black py-5 rounded-[22px] text-xl font-black font-arabic shadow-[0_15px_40px_rgba(255,106,0,0.3)] hover:-translate-y-1 active:translate-y-0 transition-all hover:shadow-[0_20px_50px_rgba(255,106,0,0.4)]" onClick={addBan}>
                            {editingBanId ? 'حفظ وتعديل الوثائق' : 'توثيق حالة الباند'}
                         </button>
                         <button className="flex-1 bg-white/5 hover:bg-white/10 text-white font-bold py-5 rounded-[22px] border border-white/10 transition-all" onClick={() => { setShowBanForm(false); setEditingBanId(null); }}>
                             إلغاء العملية
                         </button>
                      </div>
                    </motion.div>
                  </motion.div>
                )}
              </AnimatePresence>

            </motion.div>
          )}


          {/* INVESTIGATION HUB SECTION */}
          {activeSec === 'investigation_hub' && isStaff && (
            <motion.div key="investigation_hub" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-8 px-[4%]" dir="rtl">

              {/* Page explainer header */}
              <div className="card glow-hover border-r-[6px] border-orange space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-orange/10 flex items-center justify-center">
                    <Crosshair className="text-orange" size={24} />
                  </div>
                  <h1 className="font-orbitron text-2xl sm:text-3xl font-black"> ملفات تعريف المشبوهين <span className="text-orange"> Suspicious Profiles </span></h1>
                </div>
                <p className="text-text-dim text-sm leading-relaxed max-w-3xl">
                  هذه الصفحة هي نقطة الانطلاق لأي تحقيق في سلوك مشتبه به. كل ملف هنا كيان مستقل عن سجلات الباند — يمكن فتح ملف لمتابعة لاعب مشبوه قبل اتخاذ أي إجراء، وقد ينتهي ملف المشتبه به بإصدار باند فعلي بحقه بعد ثبوت المخالفة، أو بإغلاق الملف وتبرئة اللاعب في حال عدم عدم وجود أدلة كافية تدينه.

                </p>
                <div className="grid sm:grid-cols-2 gap-3 pt-2">
                  <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/5">
                    <p className="text-[11px] font-black text-orange uppercase tracking-widest mb-1">ماذا تستطيع تفعله هنا</p>
                    <p className="text-xs text-text-dim leading-relaxed">فتح ملف جديدة على أي لاعب مشتبه، تصفح الملفات المفتوحة، ومتابعة مستوى الخطورة المحسوب آلياً.</p>
                  </div>
                  <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/5">
                    <p className="text-[11px] font-black text-orange uppercase tracking-widest mb-1">مثال استخدام</p>
                    <p className="text-xs text-text-dim leading-relaxed">هل يتكرر اسم اللاعب في عدة بلاغات؟ افتح له ملفًا، واربط جميع الأدلة والمعلومات المتوفرة، ثم راجع الحالة مع المسؤولين أو فريق العمل، مع الاستفادة من اقتراحات النظام وتوصياته للمساعدة في تقييم الحالة واتخاذ الإجراء المناسب.</p>
                  </div>
                </div>
              </div>

              {/* Stats row */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { val: cases.filter(c => c.status === 'open' || c.status === 'investigating').length, label: 'ملفات نشطة', color: 'text-orange' },
                  { val: cases.filter(c => c.riskLevel === 'critical' || c.riskLevel === 'high').length, label: 'خطورة عالية/حرجة', color: 'text-red' },
                  { val: cases.filter(c => c.status === 'pending_review').length, label: 'بانتظار المراجعة', color: 'text-amber-400' },
                  { val: cases.filter(c => c.status === 'closed_banned' || c.status === 'closed_cleared').length, label: 'ملفات مغلقة', color: 'text-emerald-400' },
                ].map((s, i) => (
                  <div key={i} className="card glow-hover text-center py-6">
                    <p className={`text-3xl font-black font-orbitron ${s.color}`}>{s.val}</p>
                    <p className="text-[11px] text-text-dim mt-1">{s.label}</p>
                  </div>
                ))}
              </div>

              {/* Search + filter + new case */}
              <div className="flex flex-col md:flex-row gap-4 items-stretch md:items-center">
                <div className="relative flex-1">
                  <Search className="absolute right-4 top-1/2 -translate-y-1/2 text-text-dim" size={16} />
                  <input
                    value={caseSearchQuery}
                    onChange={e => setCaseSearchQuery(e.target.value)}
                    placeholder="بحث بـ Discord ID، اسم اللاعب، أو عنوان الملف..."
                    className="input-field pr-11"
                  />
                </div>
                <select value={caseStatusFilter} onChange={e => setCaseStatusFilter(e.target.value as any)} className="input-field md:w-56">
                  <option value="all">كل الحالات</option>
                  <option value="open">مفتوحة</option>
                  <option value="investigating">تحت التحقيق</option>
                  <option value="pending_review">بانتظار المراجعة</option>
                  <option value="closed_banned">مغلقة — تم الباند</option>
                  <option value="closed_cleared">مغلقة — تمت التبرئة</option>
                </select>
                <button className="btn-orange flex items-center justify-center gap-2 md:w-56" onClick={() => setShowNewCaseForm(true)}>
                  <PlusCircle size={18} /> فتح ملف جديدة
                </button>
              </div>

              {/* Case list */}
              <div className="grid gap-4">
                {cases
                  .filter(c => caseStatusFilter === 'all' || c.status === caseStatusFilter)
                  .filter(c => {
                    const q = caseSearchQuery.toLowerCase().trim();
                    if (!q) return true;
                    return `${c.discordId} ${c.playerName || ''} ${c.title}`.toLowerCase().includes(q);
                  })
                  .sort((a, b) => b.updatedAt - a.updatedAt)
                  .map(c => {
                    const riskColors: Record<RiskLevel, string> = {
                      low: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20',
                      medium: 'text-amber-400 bg-amber-400/10 border-amber-400/20',
                      high: 'text-orange bg-orange/10 border-orange/20',
                      critical: 'text-red bg-red/10 border-red/20',
                    };
                    const statusLabels: Record<CaseStatus, string> = {
                      open: 'مفتوحة', investigating: 'تحت التحقيق', pending_review: 'بانتظار المراجعة',
                      closed_banned: 'مغلقة — باند', closed_cleared: 'مغلقة — تبرئة',
                    };
                    return (
                      <div
                        key={c.id}
                        className="card glow-hover cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                        onClick={() => { setActiveCaseId(c.id); setActiveSec('case_tracker'); }}
                      >
                        <div className="flex items-center gap-4 min-w-0">
                          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 border ${riskColors[c.riskLevel]}`}>
                            <Crosshair size={18} />
                          </div>
                          <div className="min-w-0">
                            <p className="font-bold text-white truncate">{c.title}</p>
                            <p className="text-xs text-text-dim font-mono">{c.discordId} {c.playerName ? `• ${c.playerName}` : ''}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 flex-wrap">
                          <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border ${riskColors[c.riskLevel]}`}>
                            {c.riskScore}/100 • {c.riskLevel}
                          </span>
                          <span className="px-3 py-1 rounded-full text-[10px] font-bold bg-white/5 border border-white/10 text-text-dim">
                            {statusLabels[c.status]}
                          </span>
                          <ChevronLeft size={16} className="text-text-dim" />
                        </div>
                      </div>
                    );
                  })}
                {cases.length === 0 && (
                  <div className="card text-center py-16 text-text-dim">
                    <Crosshair size={32} className="mx-auto mb-3 opacity-30" />
                    <p className="text-sm">لا توجد قضايا حالياً — ابدأ بفتح أول ملف تحقيق</p>
                  </div>
                )}
              </div>

              {/* New Case Modal */}
              <AnimatePresence>
                {showNewCaseForm && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[150] bg-black/90 backdrop-blur-md flex items-center justify-center p-6" onClick={() => setShowNewCaseForm(false)}>
                    <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="card max-w-lg w-full space-y-5 border-orange/30" onClick={e => e.stopPropagation()}>
                      <div className="flex justify-between items-center">
                        <h3 className="text-xl font-black font-arabic">فتح ملف تحقيق جديدة</h3>
                        <button onClick={() => setShowNewCaseForm(false)} className="bg-white/5 hover:bg-white/10 p-2 rounded-full"><X size={16} /></button>
                      </div>
                      <input className="input-field" placeholder="Discord ID اللاعب المشتبه" value={newCaseForm.discordId} onChange={e => setNewCaseForm({ ...newCaseForm, discordId: e.target.value })} />
                      <input className="input-field" placeholder="اسم اللاعب (اختياري)" value={newCaseForm.playerName} onChange={e => setNewCaseForm({ ...newCaseForm, playerName: e.target.value })} />
                      <input className="input-field" placeholder="عنوان مختصر للملف" value={newCaseForm.title} onChange={e => setNewCaseForm({ ...newCaseForm, title: e.target.value })} />
                      <textarea className="input-field min-h-[100px]" placeholder="ملخص مبدئي للاشتباه (اختياري)" value={newCaseForm.summary} onChange={e => setNewCaseForm({ ...newCaseForm, summary: e.target.value })} />
                      <button className="btn-gold w-full" onClick={createCase}>فتح ملف</button>
                    </motion.div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}

          {/* CASE TRACKER SECTION */}
          {activeSec === 'case_tracker' && isStaff && (
            <motion.div key="case_tracker" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-8 px-[4%]" dir="rtl">
              {!activeCase ? (
                <div className="card text-center py-16 text-text-dim space-y-4">
                  <GitBranch size={32} className="mx-auto opacity-30" />
                  <p className="text-sm">اختر ملف المشتبه من ملفات المشتبه بهم لمتابعة تفاصيلها</p>
                  <button className="btn-orange" onClick={() => setActiveSec('investigation_hub')}>الذهاب لملفات المشتبه بهم</button>
                </div>
              ) : (() => {
                const c = activeCase;
                const riskColors: Record<RiskLevel, string> = {
                  low: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20',
                  medium: 'text-amber-400 bg-amber-400/10 border-amber-400/20',
                  high: 'text-orange bg-orange/10 border-orange/20',
                  critical: 'text-red bg-red/10 border-red/20',
                };
                const risk = getCaseRisk(c.discordId);
                const linkedEvidence = evidenceItems.filter(e => c.evidenceIds.includes(e.id));
                const possibleBans = bans.filter(b => b.discordId === c.discordId);
                const statusLabels: Record<CaseStatus, string> = {
                  open: 'مفتوحة', investigating: 'تحت التحقيق', pending_review: 'بانتظار المراجعة',
                  closed_banned: 'مغلقة — تم الباند', closed_cleared: 'مغلقة — تمت التبرئة',
                };

                return (
                  <>
                    <div className="flex items-center gap-3">
                      <button onClick={() => { setActiveCaseId(null); setActiveSec('investigation_hub'); }} className="bg-white/5 hover:bg-white/10 p-2.5 rounded-xl transition-all">
                        <ArrowRight size={18} />
                      </button>
                      <div className="flex-1 min-w-0">
                        <h1 className="font-orbitron text-xl sm:text-2xl font-black truncate">{c.title}</h1>
                        <p className="text-xs text-text-dim font-mono">{c.discordId} {c.playerName ? `• ${c.playerName}` : ''} • ملف #{c.id}</p>
                      </div>
                      <button onClick={() => deleteCase(c.id)} className="bg-red/10 hover:bg-red/20 text-red p-2.5 rounded-xl transition-all flex-shrink-0">
                        <Trash2 size={16} />
                      </button>
                    </div>

                    <div className="grid lg:grid-cols-3 gap-6">
                      {/* Left: main info */}
                      <div className="lg:col-span-2 space-y-6">
                        {/* Smart Suspicion Summary */}
                        <div className={`card space-y-4 border ${riskColors[c.riskLevel]}`}>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Sparkles size={18} className="text-orange" />
                              <h3 className="font-black font-arabic">ملخص الاشتباه الذكي</h3>
                            </div>
                            <button onClick={refreshCaseRisk} className="text-[10px] font-bold text-orange hover:underline flex items-center gap-1">
                              <TrendingUp size={12} /> تحديث التقييم
                            </button>
                          </div>
                          <div className="flex items-center gap-4">
                            <div className={`px-4 py-2 rounded-2xl font-black font-orbitron text-2xl border ${riskColors[c.riskLevel]}`}>
                              {c.riskScore}
                            </div>
                            <div>
                              <p className={`text-xs font-black uppercase tracking-widest ${riskColors[c.riskLevel].split(' ')[0]}`}>مستوى الخطورة: {c.riskLevel}</p>
                              <p className="text-[11px] text-text-dim">من 100 نقطة — محسوبة آلياً من سجل اللاعب</p>
                            </div>
                          </div>
                          <p className="text-xs text-text-dim leading-relaxed">{risk.patternSummary}</p>
                          {risk.factors.length > 0 && (
                            <div className="space-y-2 pt-2 border-t border-white/5">
                              {risk.factors.map((f, i) => (
                                <div key={i} className="flex items-center justify-between text-xs">
                                  <span className="text-gray-300">{f.label}</span>
                                  <span className="font-mono text-orange">+{f.points}</span>
                                </div>
                              ))}
                            </div>
                          )}
                          <div className="p-3 rounded-xl bg-orange/5 border border-orange/20 flex items-start gap-2">
                            <Target size={14} className="text-orange flex-shrink-0 mt-0.5" />
                            <p className="text-xs text-orange/90 font-bold leading-relaxed">{c.suggestedAction || risk.suggestedAction}</p>
                          </div>
                        </div>

                        {/* Summary editable display */}
                        <div className="card space-y-3">
                          <h3 className="font-black font-arabic flex items-center gap-2"><FileText size={16} className="text-orange" /> ملخص الملف</h3>
                          <p className="text-sm text-gray-300 leading-relaxed">{c.summary}</p>
                        </div>

                        {/* Linked Evidence */}
                        <div className="card space-y-4">
                          <div className="flex items-center justify-between">
                            <h3 className="font-black font-arabic flex items-center gap-2"><Layers size={16} className="text-orange" /> الأدلة المرتبطة ({linkedEvidence.length})</h3>
                            <button onClick={() => setLinkEvidencePickerCaseId(c.id)} className="text-[11px] font-bold text-orange hover:underline flex items-center gap-1">
                              <Link2 size={12} /> ربط دليل موجود
                            </button>
                          </div>
                          {linkedEvidence.length === 0 ? (
                            <p className="text-xs text-text-dim text-center py-6">لا توجد أدلة مرتبطة بعد</p>
                          ) : (
                            <div className="grid sm:grid-cols-2 gap-3">
                              {linkedEvidence.map(ev => (
                                <div key={ev.id} className="p-3 rounded-xl bg-white/[0.02] border border-white/5 flex items-center gap-3">
                                  <div className="w-9 h-9 rounded-lg bg-orange/10 flex items-center justify-center flex-shrink-0 text-orange">
                                    {ev.type === 'video' ? <Video size={14} /> : ev.type === 'image' ? <ImageIcon size={14} /> : <FileText size={14} />}
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <p className="text-xs font-bold text-white truncate">{ev.name || ev.category}</p>
                                    <p className="text-[10px] text-text-dim">{ev.category}</p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                          <button onClick={() => { setNewEvidenceForm(f => ({ ...f, caseId: c.id, discordId: c.discordId })); setShowNewEvidenceForm(true); }} className="w-full text-center text-xs font-bold text-orange/80 hover:text-orange py-2 border border-dashed border-orange/20 rounded-xl transition-colors">
                            + رفع دليل جديد لهذه الملف
                          </button>
                        </div>

                        {/* Linked Bans */}
                        {possibleBans.length > 0 && (
                          <div className="card space-y-3">
                            <h3 className="font-black font-arabic flex items-center gap-2"><Gavel size={16} className="text-orange" /> سجلات باند لنفس اللاعب</h3>
                            {possibleBans.map(b => (
                              <div key={b.id} className="flex items-center justify-between p-3 rounded-xl bg-white/[0.02] border border-white/5">
                                <div>
                                  <p className="text-xs font-bold text-white">{b.type} — {b.reason.slice(0, 50)}</p>
                                  <p className="text-[10px] text-text-dim">بواسطة {b.bannedBy}</p>
                                </div>
                                {c.linkedBanId === b.id ? (
                                  <span className="text-[10px] font-black text-emerald-400 bg-emerald-400/10 px-2 py-1 rounded-full">مرتبطة</span>
                                ) : (
                                  <button onClick={() => linkExistingBanToCase(b.id)} className="text-[10px] font-bold text-orange hover:underline">ربط بالملف</button>
                                )}
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Timeline */}
                        <div className="card space-y-4">
                          <h3 className="font-black font-arabic flex items-center gap-2"><History size={16} className="text-orange" /> السجل التاريخي للملف</h3>
                          <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                            {[...c.timeline].reverse().map(ev => (
                              <div key={ev.id} className="flex items-start gap-3 text-xs">
                                <div className="w-2 h-2 rounded-full bg-orange mt-1.5 flex-shrink-0" />
                                <div>
                                  <p className="text-gray-300">{ev.text}</p>
                                  <p className="text-[10px] text-text-dim font-mono">{ev.by} • {new Date(ev.timestamp).toLocaleString('ar-SA')}</p>
                                </div>
                              </div>
                            ))}
                          </div>
                          <div className="flex gap-2 pt-2 border-t border-white/5">
                            <input value={caseNoteInput} onChange={e => setCaseNoteInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && addCaseNote()} placeholder="إضافة ملاحظة للسجل..." className="input-field flex-1 !py-2.5 text-xs" />
                            <button onClick={addCaseNote} className="btn-orange !px-4">إضافة</button>
                          </div>
                        </div>
                      </div>

                      {/* Right: actions panel */}
                      <div className="space-y-6">
                        <div className="card space-y-3">
                          <h3 className="font-black font-arabic text-sm">حالة الملف</h3>
                          <select value={c.status} onChange={e => updateCaseStatusHandler(e.target.value as CaseStatus)} className="input-field text-sm">
                            {Object.entries(statusLabels).map(([k, label]) => (
                              <option key={k} value={k}>{label}</option>
                            ))}
                          </select>
                          {c.assignedTo ? (
                            <p className="text-xs text-text-dim">مكلّف بها: <span className="text-orange font-bold">{c.assignedTo}</span></p>
                          ) : (
                            <button onClick={assignCaseToMe} className="btn-orange w-full !py-2.5 text-xs">تكليف نفسي بالملف</button>
                          )}
                        </div>

                        <div className="card space-y-2 text-xs text-text-dim">
                          <div className="flex justify-between"><span>أُنشئت بواسطة</span><span className="text-white font-bold">{c.createdBy}</span></div>
                          <div className="flex justify-between"><span>تاريخ الفتح</span><span className="text-white font-mono">{new Date(c.createdAt).toLocaleDateString('ar-SA')}</span></div>
                          <div className="flex justify-between"><span>آخر تحديث</span><span className="text-white font-mono">{new Date(c.updatedAt).toLocaleDateString('ar-SA')}</span></div>
                        </div>
                      </div>
                    </div>
                  </>
                );
              })()}

              {/* Link Existing Evidence Picker */}
              <AnimatePresence>
                {linkEvidencePickerCaseId !== null && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[150] bg-black/90 backdrop-blur-md flex items-center justify-center p-6" onClick={() => setLinkEvidencePickerCaseId(null)}>
                    <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="card max-w-lg w-full space-y-4 max-h-[70vh] overflow-y-auto border-orange/30" onClick={e => e.stopPropagation()}>
                      <div className="flex justify-between items-center sticky top-0 bg-card pb-2">
                        <h3 className="text-lg font-black font-arabic">اختر دليلاً لربطه بالملف</h3>
                        <button onClick={() => setLinkEvidencePickerCaseId(null)} className="bg-white/5 hover:bg-white/10 p-2 rounded-full"><X size={16} /></button>
                      </div>
                      {evidenceItems.filter(e => !activeCase?.evidenceIds.includes(e.id)).map(ev => (
                        <div key={ev.id} onClick={() => linkEvidenceToCase(ev.id, linkEvidencePickerCaseId!)} className="p-3 rounded-xl bg-white/[0.02] border border-white/5 hover:border-orange/30 cursor-pointer flex items-center justify-between">
                          <div>
                            <p className="text-xs font-bold text-white">{ev.name || ev.category}</p>
                            <p className="text-[10px] text-text-dim">{ev.discordId || 'بدون لاعب محدد'}</p>
                          </div>
                          <Link2 size={14} className="text-orange" />
                        </div>
                      ))}
                      {evidenceItems.length === 0 && <p className="text-xs text-text-dim text-center py-6">لا توجد أدلة في النظام بعد</p>}
                    </motion.div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* New Evidence Upload — inline inside Case Tracker */}
              <AnimatePresence>
                {showNewEvidenceForm && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[150] bg-black/90 backdrop-blur-md flex items-center justify-center p-6 overflow-y-auto" onClick={() => { setShowNewEvidenceForm(false); setNewEvidenceFile(null); }}>
                    <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="card max-w-lg w-full space-y-4 border-orange/30 my-auto" onClick={e => e.stopPropagation()}>
                      <div className="flex justify-between items-center">
                        <h3 className="text-xl font-black font-arabic">رفع دليل جديد للملف</h3>
                        <button onClick={() => { setShowNewEvidenceForm(false); setNewEvidenceFile(null); }} className="bg-white/5 hover:bg-white/10 p-2 rounded-full"><X size={16} /></button>
                      </div>
                      {activeCase && (
                        <div className="text-xs text-text-dim bg-white/[0.02] border border-white/5 rounded-xl px-3 py-2">
                          مرتبط تلقائياً بالملف <span className="text-orange font-bold">#{activeCase.id}</span> — {activeCase.discordId}
                        </div>
                      )}
                      <input className="input-field" placeholder="اسم الدليل" value={newEvidenceForm.name} onChange={e => setNewEvidenceForm({ ...newEvidenceForm, name: e.target.value })} />
                      <select className="input-field" value={newEvidenceForm.category} onChange={e => setNewEvidenceForm({ ...newEvidenceForm, category: e.target.value as EvidenceCategory })}>
                        <option value="screenshot">لقطة شاشة</option>
                        <option value="cheat_video">مقطع غش</option>
                        <option value="chat_log">سجل محادثة</option>
                        <option value="report">بلاغ</option>
                        <option value="witness">شهادة شاهد</option>
                        <option value="other">أخرى</option>
                      </select>
                      <textarea className="input-field min-h-[80px]" placeholder="نص أو وصف الدليل (اختياري إذا رفعت ملف)" value={newEvidenceForm.text} onChange={e => setNewEvidenceForm({ ...newEvidenceForm, text: e.target.value })} />
                      <input className="input-field" placeholder="وسوم مفصولة بفاصلة (مثال: هاك, سرعة, ايم بوت)" value={newEvidenceForm.tags} onChange={e => setNewEvidenceForm({ ...newEvidenceForm, tags: e.target.value })} />
                      <label className="flex items-center gap-2 text-xs text-text-dim cursor-pointer border border-dashed border-white/10 rounded-xl p-3 hover:border-orange/30">
                        <Paperclip size={14} />
                        {newEvidenceFile ? newEvidenceFile.name : 'إرفاق صورة أو فيديو (اختياري)'}
                        <input type="file" accept="image/*,video/*" className="hidden" onChange={e => setNewEvidenceFile(e.target.files?.[0] || null)} />
                      </label>
                      <button className="btn-gold w-full" onClick={createEvidence}>حفظ الدليل</button>
                    </motion.div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}

          {/* ══ INTELLIGENCE ROOM SECTION ══ */}
          {activeSec === 'intelligence_room' && isStaff && (
            <motion.div key="intelligence_room" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-6 px-[4%]" dir="rtl">

              {/* Header */}
              <div className="card glow-hover border-r-[6px] border-orange space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-2xl bg-orange/10 flex items-center justify-center shrink-0">
                      <Network className="text-orange" size={24} />
                    </div>
                    <div>
                      <h1 className="font-orbitron text-2xl sm:text-3xl font-black">Intelligence <span className="text-orange">Room</span></h1>
                      <p className="text-text-dim text-xs mt-0.5">إدارة الحسابات المتعددة • Alt Account Tracker</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="bg-orange/10 border border-orange/30 text-orange font-orbitron font-black text-sm px-3 py-1.5 rounded-xl">
                      {altProfiles.length} ملف
                    </span>
                    {isStaff && (
                      <button className="btn-gold flex items-center gap-2 text-sm" onClick={() => { setIrShowForm(true); setIrEditId(null); setIrForm({ primaryId: '', primaryName: '', linkedIds: '', notes: '' }); }}>
                        <Plus size={16} /> ملف جديد
                      </button>
                    )}
                  </div>
                </div>

                {/* Search */}
                <div className="relative">
                  <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-dim" />
                  <input
                    className="input-field pr-10 text-sm"
                    placeholder="ابحث بأي Discord ID — أساسي أو مرتبط..."
                    value={irSearchQuery}
                    onChange={e => {
                      setIrSearchQuery(e.target.value);
                      if (e.target.value.trim()) addAuditLog('IR: Search', `Searched for ID: ${e.target.value.trim()}`);
                    }}
                  />
                </div>

                {/* Search result alert */}
                {(() => {
                  const q = irSearchQuery.trim();
                  if (!q) return null;
                  const found = irFindProfile(q);
                  if (!found) return (
                    <div className="flex items-center gap-2 text-sm text-text-dim bg-white/5 rounded-xl px-4 py-2.5 border border-white/10">
                      <Search size={14} /> لم يُعثر على هذا الـ Discord ID في أي ملف
                    </div>
                  );
                  const isLinked = found.linkedIds.includes(q) && q !== found.primaryId;
                  return (
                    <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className={`flex items-start gap-3 px-4 py-3 rounded-xl border text-sm font-arabic ${isLinked ? 'bg-amber-500/10 border-amber-500/30' : 'bg-orange/10 border-orange/30'}`}>
                      <AlertTriangle size={16} className={`mt-0.5 shrink-0 ${isLinked ? 'text-amber-400' : 'text-orange'}`} />
                      <div>
                        {isLinked
                          ? <><span className="font-bold text-amber-400">⚠️ تنبيه: حساب متعدد!</span> Discord: <span className="font-mono text-white">{q}</span> مرتبط بالحساب الأساسي <span className="font-mono text-orange">Discord: {found.primaryId}</span>{found.primaryName ? ` (${found.primaryName})` : ''}</>
                          : <><span className="font-bold text-orange">حساب أساسي موجود:</span> <span className="font-mono">Discord: {found.primaryId}</span>{found.primaryName ? ` — ${found.primaryName}` : ''}</>
                        }
                        <div className="text-text-dim text-xs mt-1">حسابات مرتبطة: <span className="font-mono text-white">{found.linkedIds.length ? found.linkedIds.map(id => `Discord: ${id}`).join(' • ') : '—'}</span></div>
                      </div>
                    </motion.div>
                  );
                })()}
              </div>

              {/* New/Edit Profile Form */}
              <AnimatePresence>
                {irShowForm && isStaff && (
                  <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="card border border-orange/30 space-y-4">
                    <div className="flex items-center justify-between">
                      <h2 className="font-orbitron font-black text-lg">{irEditId ? 'تعديل الملف' : 'ملف جديد'}</h2>
                      <button onClick={() => { setIrShowForm(false); setIrEditId(null); }} className="bg-white/5 hover:bg-white/10 p-2 rounded-xl transition-all"><X size={16} /></button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-text-dim mb-1.5">Discord ID الأساسي *</label>
                        <input className="input-field text-sm font-mono" placeholder="مثال: Discord: 123456789" value={irForm.primaryId} onChange={e => setIrForm(f => ({ ...f, primaryId: e.target.value }))} />
                      </div>
                      <div>
                        <label className="block text-xs text-text-dim mb-1.5">اسم اللاعب (اختياري)</label>
                        <input className="input-field text-sm" placeholder="مثال: NeGuin" value={irForm.primaryName} onChange={e => setIrForm(f => ({ ...f, primaryName: e.target.value }))} />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs text-text-dim mb-1.5">الحسابات المرتبطة — Discord IDs (كل ID في سطر أو مفصول بفاصلة)</label>
                      <textarea className="input-field text-sm font-mono h-24 resize-none" placeholder={"123456789\n987654321\n112233445"} value={irForm.linkedIds} onChange={e => setIrForm(f => ({ ...f, linkedIds: e.target.value }))} />
                    </div>
                    <div>
                      <label className="block text-xs text-text-dim mb-1.5">ملاحظات (اختياري)</label>
                      <textarea className="input-field text-sm h-16 resize-none" placeholder="أي معلومات إضافية..." value={irForm.notes} onChange={e => setIrForm(f => ({ ...f, notes: e.target.value }))} />
                    </div>
                    <div className="flex gap-3">
                      <button className="btn-gold flex-1" onClick={irSaveProfile}>{irEditId ? 'حفظ التعديلات' : 'إنشاء الملف'}</button>
                      <button className="bg-white/5 hover:bg-white/10 px-4 rounded-xl transition-all text-sm" onClick={() => { setIrShowForm(false); setIrEditId(null); }}>إلغاء</button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Profile Cards */}
              {(() => {
                const q = irSearchQuery.trim().toLowerCase();
                const filtered = altProfiles.filter(p =>
                  !q ||
                  p.primaryId.toLowerCase().includes(q) ||
                  p.linkedIds.some(id => id.toLowerCase().includes(q)) ||
                  (p.primaryName || '').toLowerCase().includes(q)
                );
                if (filtered.length === 0) return (
                  <div className="card text-center text-text-dim py-12 space-y-3">
                    <Network size={40} className="mx-auto opacity-20" />
                    <p className="font-arabic">لا توجد ملفات{q ? ' تطابق البحث' : ''}</p>
                  </div>
                );
                return (
                  <div className="space-y-4">
                    {filtered.map(p => {
                      const [newIdInput, setNewIdInput] = [irLinkedInput, setIrLinkedInput];
                      return (
                        <motion.div key={p.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="card glow-hover border border-white/10 space-y-4">
                          {/* Profile Header */}
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-xl bg-orange/10 border border-orange/30 flex items-center justify-center shrink-0">
                                <UserCheck size={18} className="text-orange" />
                              </div>
                              <div>
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-orbitron font-black text-sm text-white">{p.primaryName || 'Unknown'}</span>
                                  <span className="font-mono text-orange text-xs bg-orange/10 px-2 py-0.5 rounded-lg border border-orange/20">Discord: {p.primaryId}</span>
                                  <span className="text-[10px] text-text-dim bg-white/5 px-2 py-0.5 rounded-lg uppercase tracking-wider">Primary</span>
                                </div>
                                <div className="text-[11px] text-text-dim mt-0.5">
                                  {p.linkedIds.length} حساب مرتبط • بواسطة {p.createdBy} • {new Date(p.createdAt).toLocaleDateString('ar')}
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              {(isManager || p.createdBy === currentUser.user) && (
                                <button onClick={() => irEditProfile(p)} className="bg-white/5 hover:bg-orange/10 hover:text-orange border border-white/10 hover:border-orange/30 px-3 py-1.5 rounded-xl text-xs transition-all flex items-center gap-1.5">
                                  <Settings size={12} /> تعديل
                                </button>
                              )}
                              {isManager && (
                                <button onClick={() => irDeleteProfile(p.id)} className="bg-white/5 hover:bg-red-500/10 hover:text-red-400 border border-white/10 hover:border-red-500/30 px-3 py-1.5 rounded-xl text-xs transition-all flex items-center gap-1.5">
                                  <Trash2 size={12} /> حذف
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Linked IDs */}
                          <div className="bg-black/20 rounded-xl p-3 border border-white/5 space-y-2">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-[10px] font-bold text-text-dim uppercase tracking-widest font-orbitron">Linked Accounts</span>
                              <span className="text-xs text-orange font-bold">{p.linkedIds.length} حساب</span>
                            </div>
                            {p.linkedIds.length === 0
                              ? <p className="text-xs text-text-dim text-center py-2">لا توجد حسابات مرتبطة</p>
                              : (
                                <div className="flex flex-wrap gap-2">
                                  {p.linkedIds.map(lid => (
                                    <div key={lid} className="flex items-center gap-1.5 bg-white/5 border border-white/10 rounded-lg px-2.5 py-1">
                                      <GitMerge size={11} className="text-orange/60" />
                                      <span className="font-mono text-xs text-white">Discord: {lid}</span>
                                      {(isManager || p.createdBy === currentUser?.user) && (
                                        <button onClick={() => irRemoveLinkedId(p.id, lid)} className="text-text-dim hover:text-red-400 transition-colors ml-1">
                                          <X size={11} />
                                        </button>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )
                            }
                            {/* Add new linked ID inline — manager أو صاحب الملف فقط */}
                            {(isManager || p.createdBy === currentUser?.user) && (
                              <div className="flex gap-2 mt-2 pt-2 border-t border-white/5">
                                <input
                                  className="input-field text-xs font-mono flex-1 py-1.5"
                                  placeholder="أضف Discord ID مرتبط... مثال: 123456789"
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') {
                                      const val = (e.target as HTMLInputElement).value.trim();
                                      if (val) { irAddLinkedId(p.id, val); (e.target as HTMLInputElement).value = ''; }
                                    }
                                  }}
                                />
                                <button
                                  className="bg-orange/10 hover:bg-orange/20 border border-orange/30 text-orange px-3 rounded-xl text-xs transition-all"
                                  onClick={e => {
                                    const inp = (e.currentTarget.previousElementSibling as HTMLInputElement);
                                    const val = inp.value.trim();
                                    if (val) { irAddLinkedId(p.id, val); inp.value = ''; }
                                  }}
                                >+ إضافة</button>
                              </div>
                            )}
                          </div>

                          {p.notes && (
                            <div className="text-xs text-text-dim bg-white/5 rounded-xl px-3 py-2 border border-white/5">
                              <span className="text-orange font-bold">ملاحظة: </span>{p.notes}
                            </div>
                          )}
                        </motion.div>
                      );
                    })}
                  </div>
                );
              })()}
            </motion.div>
          )}

          {/* ══ YARA RULES SECTION ══ */}
          {activeSec === 'yara_rules' && isStaff && (
            <motion.div key="yara_rules" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-6 px-[4%]" dir="rtl">

              {/* Header */}
              <div className="card glow-hover border-r-[6px] border-orange space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-2xl bg-orange/10 flex items-center justify-center shrink-0">
                      <FileCode className="text-orange" size={24} />
                    </div>
                    <div>
                      <h1 className="font-orbitron text-2xl sm:text-3xl font-black">YARA <span className="text-orange">Rules</span></h1>
                      <p className="text-text-dim text-xs mt-0.5">قواعد الكشف والتحليل • Detection & Analysis Rules</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="bg-orange/10 border border-orange/30 text-orange font-orbitron font-black text-sm px-3 py-1.5 rounded-xl">
                      {yaraRules.length} قاعدة
                    </span>
                    {isStaff && (
                      <button className="btn-gold flex items-center gap-2 text-sm" onClick={() => { setYaraShowForm(true); setYaraEditId(null); setYaraForm({ name: '', description: '', rule: '', tags: '' }); }}>
                        <Plus size={16} /> قاعدة جديدة
                      </button>
                    )}
                  </div>
                </div>

                {/* Search */}
                <div className="relative">
                  <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-dim" />
                  <input
                    className="input-field pr-10 text-sm"
                    placeholder="ابحث باسم القاعدة أو الوصف أو الـ Tags..."
                    value={yaraSearchQuery}
                    onChange={e => {
                      setYaraSearchQuery(e.target.value);
                      if (e.target.value.trim()) addAuditLog('YARA: Search', `Searched YARA rules: ${e.target.value.trim()}`);
                    }}
                  />
                </div>
              </div>

              {/* Add/Edit Form */}
              <AnimatePresence>
                {yaraShowForm && isStaff && (
                  <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="card border border-orange/30 space-y-4">
                    <div className="flex items-center justify-between">
                      <h2 className="font-orbitron font-black text-lg">{yaraEditId ? 'تعديل القاعدة' : 'إضافة قاعدة YARA'}</h2>
                      <button onClick={() => { setYaraShowForm(false); setYaraEditId(null); }} className="bg-white/5 hover:bg-white/10 p-2 rounded-xl transition-all"><X size={16} /></button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-text-dim mb-1.5">اسم القاعدة *</label>
                        <input className="input-field text-sm font-mono" placeholder="مثال: detect_cheat_dll" value={yaraForm.name} onChange={e => setYaraForm(f => ({ ...f, name: e.target.value }))} />
                      </div>
                      <div>
                        <label className="block text-xs text-text-dim mb-1.5">التاغات (مفصولة بفاصلة)</label>
                        <input className="input-field text-sm" placeholder="cheat, dll, memory" value={yaraForm.tags} onChange={e => setYaraForm(f => ({ ...f, tags: e.target.value }))} />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs text-text-dim mb-1.5">الوصف</label>
                      <input className="input-field text-sm" placeholder="وصف مختصر للقاعدة..." value={yaraForm.description} onChange={e => setYaraForm(f => ({ ...f, description: e.target.value }))} />
                    </div>
                    <div>
                      <label className="block text-xs text-text-dim mb-1.5">نص القاعدة (YARA) *</label>
                      <textarea
                        className="input-field text-sm font-mono h-52 resize-y"
                        style={{ fontFamily: 'monospace', tabSize: 4, direction: 'ltr', textAlign: 'left' }}
                        placeholder={"rule detect_example {\n  meta:\n    description = \"...\"\n  strings:\n    $a = \"example\"\n  condition:\n    $a\n}"}
                        value={yaraForm.rule}
                        onChange={e => setYaraForm(f => ({ ...f, rule: e.target.value }))}
                      />
                    </div>
                    <div className="flex gap-3">
                      <button className="btn-gold flex-1" onClick={yaraSave}>{yaraEditId ? 'حفظ التعديلات' : 'إضافة القاعدة'}</button>
                      <button className="bg-white/5 hover:bg-white/10 px-4 rounded-xl transition-all text-sm" onClick={() => { setYaraShowForm(false); setYaraEditId(null); }}>إلغاء</button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Rules Grid */}
              {(() => {
                const q = yaraSearchQuery.trim().toLowerCase();
                const filtered = yaraRules.filter(r =>
                  !q ||
                  r.name.toLowerCase().includes(q) ||
                  r.description.toLowerCase().includes(q) ||
                  r.tags.some(t => t.toLowerCase().includes(q))
                );
                if (filtered.length === 0) return (
                  <div className="card text-center text-text-dim py-12 space-y-3">
                    <FileCode size={40} className="mx-auto opacity-20" />
                    <p className="font-arabic">لا توجد قواعد YARA{q ? ' تطابق البحث' : ''}.</p>
                    {isStaff && !yaraShowForm && <button className="btn-gold text-sm mt-2" onClick={() => setYaraShowForm(true)}>+ أضف أول قاعدة</button>}
                  </div>
                );
                return (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {filtered.map(r => (
                      <motion.div key={r.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="card glow-hover border border-white/10 space-y-3">
                        {/* Rule Header */}
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="w-8 h-8 rounded-lg bg-orange/10 flex items-center justify-center shrink-0">
                              <Code size={14} className="text-orange" />
                            </div>
                            <div className="min-w-0">
                              <div className="font-orbitron font-black text-sm text-white truncate">{r.name}</div>
                              <div className="text-[11px] text-text-dim">بواسطة {r.addedBy} • {new Date(r.createdAt).toLocaleDateString('ar')}</div>
                            </div>
                          </div>
                          {/* Action buttons */}
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              onClick={() => yaraCopy(r)}
                              className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-xl border transition-all font-orbitron ${yaraCopied === r.id ? 'bg-green-500/20 border-green-500/40 text-green-400' : 'bg-white/5 border-white/10 hover:bg-orange/10 hover:border-orange/30 hover:text-orange'}`}
                            >
                              <Copy size={11} /> {yaraCopied === r.id ? 'تم!' : 'نسخ'}
                            </button>
                            {(isManager || r.addedBy === currentUser.user) && (
                              <button onClick={() => { setYaraEditId(r.id); setYaraForm({ name: r.name, description: r.description, rule: r.rule, tags: r.tags.join(', ') }); setYaraShowForm(true); }} className="bg-white/5 hover:bg-orange/10 hover:text-orange border border-white/10 hover:border-orange/30 px-2.5 py-1.5 rounded-xl text-xs transition-all flex items-center gap-1.5">
                                <Settings size={11} /> تعديل
                              </button>
                            )}
                            {isManager && (
                              <button onClick={() => yaraDelete(r.id)} className="bg-white/5 hover:bg-red-500/10 hover:text-red-400 border border-white/10 hover:border-red-500/30 px-2.5 py-1.5 rounded-xl text-xs transition-all flex items-center gap-1.5">
                                <Trash2 size={11} /> حذف
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Description */}
                        {r.description && <p className="text-xs text-text-dim font-arabic leading-relaxed">{r.description}</p>}

                        {/* Tags */}
                        {r.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {r.tags.map(t => (
                              <span key={t} className="text-[10px] bg-orange/10 border border-orange/20 text-orange px-2 py-0.5 rounded-lg font-mono">{t}</span>
                            ))}
                          </div>
                        )}

                        {/* Rule Preview */}
                        <div
                          className="bg-black/40 rounded-xl border border-white/10 p-3 cursor-pointer group relative overflow-hidden"
                          onClick={() => addAuditLog('YARA: View Rule', `Viewed YARA rule: "${r.name}"`)}
                        >
                          <pre className="text-[11px] font-mono text-green-400/80 leading-relaxed overflow-x-auto max-h-36 overflow-y-auto" style={{ direction: 'ltr', textAlign: 'left' }}>{r.rule}</pre>
                          <div className="absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-black/60 to-transparent pointer-events-none" />
                        </div>

                        {/* Updated info */}
                        {r.updatedAt !== r.createdAt && (
                          <div className="text-[10px] text-text-dim flex items-center gap-1">
                            <History size={10} /> آخر تعديل: {new Date(r.updatedAt).toLocaleString('ar')}
                          </div>
                        )}
                      </motion.div>
                    ))}
                  </div>
                );
              })()}
            </motion.div>
          )}


          {/* PC-CHECK SECTION */}
          {activeSec === 'pc_check' && isStaff && (
            <motion.div key="pc_check" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-6 px-[4%]" dir="rtl">

              {/* Header */}
              <div className="card glow-hover border-r-[6px] border-orange space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-2xl bg-orange/10 flex items-center justify-center shrink-0">
                      <Cpu className="text-orange" size={24} />
                    </div>
                    <div>
                      <h1 className="font-orbitron text-2xl sm:text-3xl font-black">PC-<span className="text-orange">CHECK</span></h1>
                      <p className="text-text-dim text-xs mt-0.5">سجلات فحص الأجهزة (HWID) • Hardware Fingerprint Checks</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="bg-orange/10 border border-orange/30 text-orange font-orbitron font-black text-sm px-3 py-1.5 rounded-xl">
                      {pcChecks.length} سجل
                    </span>
                    {isStaff && (
                      <button className="btn-gold flex items-center gap-2 text-sm" onClick={() => { setPcShowForm(true); setPcEditId(null); setPcForm({ player: '', isCheater: false, pin: '', hwid: '', notes: '' }); }}>
                        <Plus size={16} /> فحص جديد
                      </button>
                    )}
                  </div>
                </div>

                {/* Search + Filter */}
                <div className="flex flex-col sm:flex-row gap-3">
                  <div className="relative flex-1">
                    <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-dim" />
                    <input
                      className="input-field pr-10 text-sm"
                      placeholder="ابحث باسم اللاعب، Pin، أو HWID..."
                      value={pcSearchQuery}
                      onChange={e => {
                        setPcSearchQuery(e.target.value);
                        if (e.target.value.trim()) addAuditLog('PC-CHECK: Search', `Searched PC-CHECK records: ${e.target.value.trim()}`);
                      }}
                    />
                  </div>
                  <select value={pcFilter} onChange={e => setPcFilter(e.target.value as any)} className="input-field sm:w-48 text-sm">
                    <option value="all">كل السجلات</option>
                    <option value="cheaters">مغشوشين فقط</option>
                    <option value="clean">سليمين فقط</option>
                  </select>
                </div>
              </div>

              {/* Add/Edit Form */}
              <AnimatePresence>
                {pcShowForm && isStaff && (
                  <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="card border border-orange/30 space-y-4">
                    <div className="flex items-center justify-between">
                      <h2 className="font-orbitron font-black text-lg">{pcEditId ? 'تعديل سجل الفحص' : 'إضافة فحص جهاز جديد'}</h2>
                      <button onClick={() => { setPcShowForm(false); setPcEditId(null); }} className="bg-white/5 hover:bg-white/10 p-2 rounded-xl transition-all"><X size={16} /></button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-text-dim mb-1.5">Player *</label>
                        <input className="input-field text-sm" placeholder="اسم اللاعب" value={pcForm.player} onChange={e => setPcForm(f => ({ ...f, player: e.target.value }))} />
                      </div>
                      <div>
                        <label className="block text-xs text-text-dim mb-1.5">Cheater</label>
                        <div className="flex bg-black/40 p-1 rounded-xl border border-white/5">
                          <button type="button" onClick={() => setPcForm(f => ({ ...f, isCheater: false }))} className={`flex-1 py-2 rounded-lg text-xs font-black transition-all ${!pcForm.isCheater ? 'bg-emerald-500/20 text-emerald-400' : 'text-text-dim'}`}>
                            لا
                          </button>
                          <button type="button" onClick={() => setPcForm(f => ({ ...f, isCheater: true }))} className={`flex-1 py-2 rounded-lg text-xs font-black transition-all ${pcForm.isCheater ? 'bg-red/20 text-red' : 'text-text-dim'}`}>
                            نعم
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-text-dim mb-1.5">Pin</label>
                        <input className="input-field text-sm font-mono" placeholder="Pin Code" value={pcForm.pin} onChange={e => setPcForm(f => ({ ...f, pin: e.target.value }))} />
                      </div>
                      <div>
                        <label className="block text-xs text-text-dim mb-1.5">Hwid</label>
                        <input className="input-field text-sm font-mono" placeholder="S-1-5-21-..." dir="ltr" value={pcForm.hwid} onChange={e => setPcForm(f => ({ ...f, hwid: e.target.value }))} />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs text-text-dim mb-1.5">ملاحظات إضافية (اختياري)</label>
                      <textarea className="input-field text-sm min-h-[80px]" placeholder="أي تفاصيل إضافية عن الفحص..." value={pcForm.notes} onChange={e => setPcForm(f => ({ ...f, notes: e.target.value }))} />
                    </div>
                    <button className="btn-gold w-full" onClick={pcSaveCheck}>{pcEditId ? 'حفظ التعديلات' : 'حفظ السجل'}</button>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Records List */}
              <div className="grid gap-3">
                {filteredPcChecks.map(r => (
                  <div key={r.id} className={`card glow-hover space-y-3 border ${r.isCheater ? 'border-red/20' : 'border-white/5'}`}>
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${r.isCheater ? 'bg-red/10 text-red' : 'bg-emerald-500/10 text-emerald-400'}`}>
                          {r.isCheater ? <ShieldX size={18} /> : <MonitorCheck size={18} />}
                        </div>
                        <div className="min-w-0">
                          <p className="font-bold text-white truncate">{r.player}</p>
                          <span className={`text-[10px] font-black uppercase tracking-widest ${r.isCheater ? 'text-red' : 'text-emerald-400'}`}>
                            Cheater: {r.isCheater ? 'نعم' : 'لا'}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {(isManager || r.checkedBy === currentUser.user) && (
                          <button onClick={() => pcStartEdit(r)} className="bg-white/5 hover:bg-orange/10 hover:text-orange border border-white/10 hover:border-orange/30 px-2.5 py-1.5 rounded-xl text-xs transition-all flex items-center gap-1.5">
                            <Settings size={11} /> تعديل
                          </button>
                        )}
                        {isManager && (
                          <button onClick={() => pcDeleteCheck(r.id)} className="bg-white/5 hover:bg-red-500/10 hover:text-red-400 border border-white/10 hover:border-red-500/30 px-2.5 py-1.5 rounded-xl text-xs transition-all flex items-center gap-1.5">
                            <Trash2 size={11} /> حذف
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-mono bg-black/30 rounded-xl p-3 border border-white/5" dir="ltr">
                      <div className="flex justify-between sm:flex-col sm:gap-0.5">
                        <span className="text-text-dim">Pin:</span>
                        <span className="text-white break-all">{r.pin || '—'}</span>
                      </div>
                      <div className="flex justify-between sm:flex-col sm:gap-0.5">
                        <span className="text-text-dim">Hwid:</span>
                        <span className="text-orange break-all">{r.hwid || '—'}</span>
                      </div>
                    </div>
                    {r.notes && <p className="text-xs text-text-dim leading-relaxed">{r.notes}</p>}
                    <div className="flex items-center justify-between text-[10px] text-text-dim pt-2 border-t border-white/5">
                      <span>فحص بواسطة: <span className="text-white font-bold">{r.checkedBy}</span></span>
                      <span className="font-mono">{new Date(r.updatedAt).toLocaleString('ar-SA')}</span>
                    </div>
                  </div>
                ))}
                {filteredPcChecks.length === 0 && (
                  <div className="card text-center py-16 text-text-dim">
                    <Cpu size={32} className="mx-auto mb-3 opacity-30" />
                    <p className="text-sm">{pcChecks.length === 0 ? 'لا توجد سجلات فحص حالياً — ابدأ بإضافة أول سجل' : 'لا توجد نتائج مطابقة لمعايير البحث'}</p>
                  </div>
                )}
              </div>
            </motion.div>
          )}


          {/* TICKETS SECTION */}
          {(activeSec === 'tickets') && (
            <motion.div key="tickets" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-8 h-full">
              <div className="flex flex-col md:flex-row justify-between items-center gap-4">
                <div className="border-r-4 border-orange pr-4">
                  <h2 className="text-2xl font-black text-white font-arabic">مركز التواصل والدعم</h2>
                  <p className="text-[10px] text-text-dim uppercase tracking-widest font-orbitron">Support Command Center</p>
                </div>
                {currentUser.role === UserRole.ADMIN && (
                  <div className="flex gap-4 w-full md:w-auto">
                    <button className={`flex-1 md:px-8 py-3 rounded-2xl border transition-all duration-300 font-bold text-xs ${ticketViewMode === 'my' ? 'border-orange bg-orange/10 text-orange shadow-[0_0_15px_rgba(255,106,0,0.1)]' : 'border-white/10 hover:bg-white/5 text-text-dim font-arabic'}`} onClick={() => setTicketViewMode('my')}>
                      تذاكري النشطة
                    </button>
                    <button className={`flex-1 md:px-8 py-3 rounded-2xl border transition-all duration-300 font-bold text-xs ${ticketViewMode === 'create' ? 'border-orange bg-orange/10 text-orange shadow-[0_0_15px_rgba(255,106,0,0.1)]' : 'border-white/10 hover:bg-white/5 text-text-dim font-arabic'}`} onClick={() => setTicketViewMode('create')}>
                      فتح تذكـرة
                    </button>
                  </div>
                )}
              </div>

              {ticketViewMode === 'create' && currentUser.role === UserRole.ADMIN ? (
                 <div className="card max-w-xl mx-auto space-y-6 shadow-2xl border-orange/10 p-8">
                   <div className="text-center space-y-2 mb-4">
                     <h3 className="text-2xl font-black text-white font-arabic">فتح تذكرة تواصل</h3>
                     <p className="text-xs text-text-dim uppercase tracking-widest font-orbitron">New Support Request</p>
                   </div>
                   <input type="text" placeholder="عنوان الموضوع للمراجعة" className="input-field h-14" value={ticketForm.subject} onChange={e => setTicketForm({...ticketForm, subject: e.target.value})} />
                   <textarea placeholder="اشرح المشكلة أو الطلب بالتفصيل هنا..." className="input-field min-h-[180px] p-5 leading-relaxed" value={ticketForm.body} onChange={e => setTicketForm({...ticketForm, body: e.target.value})}></textarea>
                   <div className="flex items-center justify-between p-4 bg-white/5 rounded-2xl border border-white/5">
                    <label className="cursor-pointer bg-orange/10 px-6 py-3 rounded-xl border border-orange/20 hover:bg-orange/20 transition-all font-bold text-sm text-orange flex items-center gap-2">
                      <input type="file" accept="image/*,video/*" hidden onChange={e => setTicketFile(e.target.files?.[0] || null)} />
                      <Paperclip className="w-4 h-4" /> رفع مرفق
                    </label>
                    <span className="text-[11px] text-text-dim font-mono max-w-[200px] truncate">{ticketFile ? `✓ ${ticketFile.name}` : 'لا توجد مرفقات حالياً'}</span>
                   </div>
                   <button className="btn-orange w-full py-5 text-lg font-black font-arabic shadow-xl hover:-translate-y-1 active:translate-y-0 transition-all" onClick={sendTicket}>إرسال التذكرة الآن</button>
                 </div>
              ) : ticketViewMode === 'directory' ? (
                <div className="space-y-10 min-h-[700px] animate-in slide-in-from-bottom-5 duration-500">
                  <div className="flex justify-between items-center bg-white/[0.02] p-8 rounded-[40px] border border-white/5 shadow-2xl backdrop-blur-md">
                    <div className="flex items-center gap-6">
                      <div className="w-16 h-16 bg-orange/10 rounded-[28px] flex items-center justify-center text-orange border border-orange/20 shadow-lg">
                        <Eye size={32} />
                      </div>
                      <div>
                        <h2 className="text-3xl font-black text-white font-arabic">الفهرس الشامل للتذاكر</h2>
                        <p className="text-xs text-text-dim mt-1 uppercase tracking-[0.4em] font-orbitron">Central Ticket Repository</p>
                      </div>
                    </div>
                    <div className="flex gap-4">
                      <div className="relative w-72">
                         <Search className="absolute right-4 top-3.5 text-text-dim w-5 h-5 pointer-events-none" />
                         <input 
                           type="text" 
                           placeholder="بحث سريع في الفهرس..." 
                           className="input-field pr-12 h-12 text-sm" 
                           value={ticketSearchQuery}
                           onChange={e => setTicketSearchQuery(e.target.value)}
                         />
                      </div>
                      <button className="bg-white/5 hover:bg-white/10 px-8 h-12 rounded-2xl text-sm font-black transition-all border border-white/10" onClick={() => setTicketViewMode('all')}>إغلاق الفهرس</button>
                    </div>
                  </div>

                  <div className="grid gap-12 text-right">
                      <div className="space-y-8 text-right">
                        <div className="flex items-center gap-4 px-4 justify-end">
                           <h3 className="text-2xl font-black text-white font-arabic">إجمالي التذاكر النشطة</h3>
                           <div className="w-2 h-8 bg-orange rounded-full"></div>
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          {(isManager || isLogs
                            ? tickets.filter(t => t.status !== 'done') 
                            : tickets.filter(t => (t.creator === currentUser?.user || t.assignedTo === currentUser?.user) && t.status !== 'done')
                          ).filter(t => t.subject.toLowerCase().includes(ticketSearchQuery.toLowerCase()) || t.creator.toLowerCase().includes(ticketSearchQuery.toLowerCase()))
                          .map((t, index) => (
                            <div key={`ticket_grid_item_${t.id}_${index}`} className="card group hover:scale-[1.02] transition-all duration-500 border-white/5 hover:border-orange/30 !p-2 rounded-[32px] overflow-hidden" onClick={() => { setActiveTicketId(t.id); setTicketViewMode('all'); }}>
                              <div className="flex items-stretch bg-white/[0.01] group-hover:bg-orange/[0.02] transition-colors rounded-[30px] p-6">
                                <div className="flex-1 space-y-4 text-right">
                                  <div className="flex items-center justify-between">
                                    <span className={`text-[10px] font-black px-4 py-1.5 rounded-full uppercase tracking-widest ${t.status === 'open' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' : 'bg-orange/20 text-orange border border-orange/40'}`}>
                                      {t.status === 'open' ? 'تذكرة مفتوحة' : 'قيد المراجعة'}
                                    </span>
                                    <span className="text-[11px] font-mono text-text-dim/60">ID: #{String(t.id).slice(-6)}</span>
                                  </div>
                                  <h4 className="text-xl font-bold text-white group-hover:text-orange transition-colors font-arabic">{t.subject}</h4>
                                  <div className="flex items-center gap-4 pt-4 border-t border-white/5 justify-end">
                                    <div className="flex items-center gap-2 text-xs text-text-dim font-mono text-right">
                                      <Clock size={14} />
                                      {formatDate(t.createdAt)}
                                    </div>
                                    <div className="w-[1px] h-4 bg-white/10"></div>
                                    <div className="flex items-center gap-2">
                                      <span className="text-sm font-bold text-gray-300 font-arabic">{t.creator}</span>
                                      <div className="w-8 h-8 rounded-xl bg-orange/10 flex items-center justify-center text-orange text-xs font-black border border-orange/20">
                                        {t.creator[0].toUpperCase()}
                                      </div>
                                    </div>
                                  </div>
                                </div>
                                <div className="flex items-center justify-center border-l border-white/5 ml-4 group-hover:border-orange/20 transition-colors px-6">
                                   <div className="w-12 h-12 bg-white/5 rounded-2xl flex items-center justify-center text-text-dim group-hover:bg-orange group-hover:text-black transition-all">
                                      <ChevronLeft size={24} />
                                   </div>
                                   <button 
                                      onClick={(e) => { e.stopPropagation(); openTicketModal(t); }}
                                      className="text-[10px] font-black text-orange bg-orange/10 px-3 py-1.5 rounded-lg border border-orange/20 hover:bg-orange hover:text-black transition-all whitespace-nowrap"
                                   >
                                      استعراض التذكرة
                                   </button>
                                </div>
                              </div>
                            </div>
                          ))}
                          {(isManager || isLogs
                            ? tickets.filter(t => t.status !== 'done') 
                            : tickets.filter(t => (t.creator === currentUser?.user || t.assignedTo === currentUser?.user) && t.status !== 'done')
                          ).length === 0 && (
                            <div className="py-20 text-center space-y-4 opacity-30">
                              <Archive size={48} className="mx-auto" />
                              <p className="font-arabic">لا توجد حالات مسجلة في هذا التصنيف حالياً</p>
                            </div>
                          )}
                        </div>
                      </div>
                  </div>
                </div>
               ) : (
                 <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 h-[600px] bg-black/20 rounded-[32px] p-2 border border-white/5">
                  {/* Sidebar */}
                  <div className="lg:col-span-4 bg-[#0c0c0c]/80 rounded-[28px] border border-white/5 overflow-hidden flex flex-col shadow-inner">
                    <div className="bg-white/[0.03] p-4 border-b border-white/5 space-y-4">
                      <div className="flex items-center justify-between px-2">
                        <span className="text-xs font-black text-orange font-orbitron uppercase tracking-widest">Support Inbox</span>
                        <TicketIcon className="w-4 h-4 text-orange opacity-50" />
                      </div>
                      <div className="relative group">
                        <Search className="absolute right-3 top-2.5 text-text-dim w-4 h-4 group-focus-within:text-orange transition-colors" />
                        <input 
                          type="text" 
                          placeholder="بحث في التذاكر الحالية..." 
                          className="w-full bg-black/40 border border-white/5 rounded-xl px-10 py-2 text-[10px] focus:border-orange/30 outline-none transition-all"
                          value={ticketSearchQuery}
                          onChange={e => setTicketSearchQuery(e.target.value)}
                        />
                      </div>
                      <button 
                        className="w-full py-2 bg-orange/10 hover:bg-orange/20 border border-orange/20 rounded-xl text-[10px] font-black text-orange transition-all flex items-center justify-center gap-2"
                        onClick={() => { setTicketViewMode('directory'); }}
                      >
                        <Archive size={12} /> الاطلاع على جميع التكتات (عرض الشبكة)
                      </button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
                      {(isManager || isLogs
                        ? tickets.filter(t => t.status !== 'done') 
                        : tickets.filter(t => (t.creator === currentUser?.user || t.assignedTo === currentUser?.user) && t.status !== 'done')
                      ).filter(t => t.subject.toLowerCase().includes(ticketSearchQuery.toLowerCase()) || t.creator.toLowerCase().includes(ticketSearchQuery.toLowerCase())).map((t, idx) => (
                        <div key={`ticket_sidebar_${t.id}_${idx}`} className={`p-5 rounded-2xl border border-white/5 cursor-pointer transition-all duration-300 group relative overflow-hidden ${activeTicketId === t.id ? 'border-orange/40 bg-orange/5 shadow-lg' : 'hover:bg-white/[0.04]'}`} onClick={() => setActiveTicketId(t.id)}>
                          <div className="flex justify-between items-start relative z-10 mb-2">
                            <span className={`font-bold text-sm group-hover:text-orange transition-colors ${activeTicketId === t.id ? 'text-orange' : 'text-white'}`}>{t.subject}</span>
                            <span className={`text-[9px] font-black px-3 py-1.5 rounded-xl uppercase tracking-widest shadow-inner ${t.status === 'open' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' : 'bg-orange/20 text-orange border border-orange/40 shadow-[0_0_15px_rgba(255,106,0,0.1)]'}`}>
                              {t.status === 'open' ? '• مفتوحة' : '• قيد العمل'}
                            </span>
                          </div>
                          <div className="flex items-center justify-between relative z-10">
                            <div className="flex items-center gap-2 text-[10px] text-text-dim">
                              <div className="w-5 h-5 bg-white/10 rounded-full flex items-center justify-center font-black text-[8px]">{t.creator[0]}</div>
                              <span>{t.creator}</span>
                            </div>
                            <span className="text-[8px] font-mono text-text-dim/60">#{String(t.id).slice(-4)}</span>
                          </div>
                          <div className="mt-3 opacity-0 group-hover:opacity-100 transition-opacity">
                             <button 
                               onClick={(e) => { e.stopPropagation(); openTicketModal(t); }}
                               className="w-full py-2 bg-orange text-black rounded-xl text-[10px] font-black shadow-lg hover:scale-[1.02] active:scale-95 transition-all"
                             >
                               استعراض التذكرة (Detailed View)
                             </button>
                          </div>
                          {activeTicketId === t.id && <motion.div layoutId="ticketActive" className="absolute left-0 top-0 w-1 h-full bg-orange" />}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Chat Area */}
                  <div className="lg:col-span-8 bg-[#0c0c0c]/40 rounded-[28px] border border-white/5 flex flex-col overflow-hidden shadow-2xl relative">
                    <div className="absolute inset-0 bg-orange/[0.02] pointer-events-none"></div>
                    {activeTicket ? (
                      <>
                        <div className="p-6 bg-white/[0.02] border-b border-white/5 flex justify-between items-center z-10 backdrop-blur-md">
                          <div className="flex items-center gap-4">
                            <div className="w-10 h-10 bg-orange/10 rounded-xl flex items-center justify-center text-orange border border-orange/20">
                              <TicketIcon size={20} />
                            </div>
                            <div>
                               <h4 className="font-bold text-white text-base truncate max-w-[200px] sm:max-w-md">{activeTicket.subject}</h4>
                               <p className="text-[10px] text-text-dim mt-1">المعرف: #{activeTicket.id}</p>
                            </div>
                          </div>
                          {currentUser.role !== UserRole.ADMIN && (
                             <div className="flex gap-4 shrink-0">
                               <button className="bg-red/10 text-red border border-red/20 h-10 px-6 rounded-2xl text-xs font-black hover:bg-red hover:text-white transition-all shadow-lg active:scale-95" onClick={() => updateTicketStatus('done')}>إغلاق التذكرة</button>
                               {activeTicket.status === 'open' && <button className="bg-orange text-black h-10 px-6 rounded-2xl text-xs font-black hover:scale-105 transition-all shadow-[0_5px_20px_rgba(255,106,0,0.3)] active:scale-95" onClick={() => updateTicketStatus('working')}>استلام لوقز</button>}
                             </div>
                          )}
                        </div>
                        <div className="flex-1 overflow-y-auto p-8 flex flex-col gap-6 custom-scrollbar z-10">
                          {[...activeTicket.msgs].sort((a,b) => (a.timestamp || 0) - (b.timestamp || 0)).map((m, i) => (
                            <div key={i} className={`flex flex-col group ${m.sender === 'system' ? 'items-center' : (m.sender === 'logs' ? 'items-end' : 'items-start')}`}>
                              {m.sender !== 'system' && (
                                <div className={`flex items-center gap-2 mb-2 text-[9px] font-black tracking-widest uppercase px-2 ${m.sender === 'logs' ? 'flex-row-reverse text-orange' : 'text-text-dim'}`}>
                                  <span>{m.senderName}</span>
                                  <span className="opacity-30 font-mono">{formatDate(m.timestamp || 0)}</span>
                                </div>
                              )}
                              <div className={`max-w-[85%] p-5 rounded-[24px] shadow-2xl transition-all relative group/bubble ${m.sender === 'system' ? 'bg-white/5 border border-white/10 text-orange font-bold text-[10px] py-2 px-8 rounded-full' : (m.sender === 'logs' ? 'bg-orange text-black font-semibold rounded-br-none shadow-[0_10px_30px_rgba(255,106,0,0.2)]' : 'bg-[#1a1a1a] border border-white/10 text-gray-200 rounded-bl-none')}`}>
                                {m.sender === 'logs' && <div className="absolute top-0 right-0 w-2 h-2 bg-orange translate-x-1/2 -translate-y-1/2 rotate-45"></div>}
                                {m.sender === 'admin' && <div className="absolute top-0 left-0 w-2 h-2 bg-[#1a1a1a] -translate-x-1/2 -translate-y-1/2 rotate-45 border-l border-t border-white/10"></div>}
                                
                                {m.type === 'text' ? (
                                  <p className="leading-relaxed whitespace-pre-wrap text-[13px]">{m.text}</p>
                                ) : (
                                  <div className="space-y-3">
                                    {m.type === 'image' ? (
                                      <div className="relative group/img overflow-hidden rounded-xl border border-black/20 shadow-lg">
                                        <img src={m.url} className="max-h-[450px] w-full object-cover cursor-pointer group-hover/img:scale-105 transition-transform duration-500" onClick={() => setFullScreenMedia(m.url ? { url: m.url, type: 'image' } : null)} />
                                        <div className="absolute inset-0 bg-black/20 group-hover/img:bg-transparent transition-colors pointer-events-none"></div>
                                      </div>
                                    ) : (
                                      <video src={m.url} className="rounded-xl max-h-[450px] w-full shadow-2xl border border-black/20" controls autoPlay muted playsInline preload="metadata" />
                                    )}
                                    <div className={`flex justify-between items-center text-[9px] uppercase tracking-widest font-black ${m.sender === 'logs' ? 'text-black/40' : 'text-white/20'}`}>
                                      <span>{m.type} Attachment</span>
                                      <ImageIcon size={10} />
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                          <div className="h-4" />
                        </div>
                        {/* Typing Indicator */}
                        {typingUsers.filter(t => String(t.ticketId) === String(activeTicketId) && t.user !== currentUser?.user).length > 0 && (
                          <div className="px-6 py-2 flex items-center gap-2">
                            <div className="flex gap-1">
                              <span className="w-1.5 h-1.5 bg-orange rounded-full animate-bounce" style={{animationDelay:'0ms'}}></span>
                              <span className="w-1.5 h-1.5 bg-orange rounded-full animate-bounce" style={{animationDelay:'150ms'}}></span>
                              <span className="w-1.5 h-1.5 bg-orange rounded-full animate-bounce" style={{animationDelay:'300ms'}}></span>
                            </div>
                            <span className="text-[10px] text-orange/70 font-bold">
                              {typingUsers.filter(t => String(t.ticketId) === String(activeTicketId) && t.user !== currentUser?.user).map(t => t.user).join(', ')} يكتب...
                            </span>
                          </div>
                        )}
                        <div className="p-3 bg-white/[0.02] border-t border-white/5 flex gap-3 items-center z-10 backdrop-blur-sm">
                           <label className="cursor-pointer p-3 bg-white/5 rounded-xl hover:bg-white/10 text-text-dim hover:text-orange transition-all shrink-0 border border-white/5 shadow-lg group">
                              <input type="file" hidden accept="image/*,video/*" onChange={e => {
                                const f = e.target.files?.[0];
                                if (f) {
                                  setReplyFile(f);
                                  alert(`تم اختيار: ${f.name}`);
                                }
                              }} />
                              <Paperclip size={18} className="group-hover:rotate-45 transition-transform" />
                           </label>
                           <div className="flex-1 relative">
                             <input 
                               type="text" 
                               placeholder={replyFile ? `✓ READY: ${replyFile.name}` : "اكتب ردك هنا..."} 
                               className={`input-field !mb-0 text-xs h-12 pr-6 pl-10 rounded-xl transition-all ${replyFile ? '!border-orange !bg-orange/5' : ''}`} 
                               value={replyInput} 
                               onChange={e => {
                                 setReplyInput(e.target.value);
                                 if (realtimeChannelRef.current && currentUser && activeTicketId) {
                                   realtimeChannelRef.current.send({ type: 'broadcast', event: 'typing', payload: { user: currentUser.user, ticketId: activeTicketId } });
                                 }
                               }} 
                               onKeyDown={e => e.key === 'Enter' && sendReply()} 
                             />
                           </div>
                           <button className="btn-orange p-3 flex shrink-0 rounded-xl shadow-orange-btn hover:scale-105 transition-all" onClick={sendReply}>
                             <ChevronLeft strokeWidth={3} size={18} />
                           </button>
                        </div>
                      </>
                    ) : (
                      <div className="flex-1 flex flex-col items-center justify-center text-text-dim gap-6 opacity-40">
                        <div className="p-8 bg-white/5 rounded-full border border-white/10 mb-2">
                          <TicketIcon size={64} strokeWidth={1} />
                        </div>
                        <h3 className="text-xl font-black font-arabic">يرجى تحديد تذكرة لمتابعتها</h3>
                        <p className="text-xs">سيظهر سجل المحادثة الكامل والملفات هنا</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {/* CLOSED TICKETS SECTION (Archived) */}
          {activeSec === 'closed_tickets' && isManager && (
            <motion.div key="closed_tickets" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-8">
               <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                  <div className="border-r-4 border-red pr-4">
                    <h2 className="text-3xl font-black text-white font-arabic">سجل التذاكر المغلقة (Archive)</h2>
                    <p className="text-xs text-text-dim mt-1 uppercase tracking-[0.3em] font-orbitron">Historical Support Archives</p>
                  </div>
                  <div className="relative w-full md:w-80">
                    <Search className="absolute right-3 top-3.5 text-text-dim w-5 h-5 pointer-events-none" />
                    <input 
                      type="text" 
                      placeholder="بحث في الأرشيف..." 
                      className="input-field pr-12 h-12 shadow-2xl focus:border-red/40" 
                      value={closedTicketsSearchQuery}
                      onChange={e => setClosedTicketsSearchQuery(e.target.value)}
                    />
                  </div>
               </div>

               <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-[700px] bg-black/20 rounded-[32px] p-2 border border-white/5">
                  <div className="lg:col-span-4 bg-[#0c0c0c]/80 rounded-[28px] border border-white/5 overflow-hidden flex flex-col shadow-inner">
                    <div className="bg-red/5 p-6 text-right font-black text-red border-b border-red/10 flex items-center justify-between">
                      <span className="text-sm font-arabic">الأرشيف المغلق</span>
                      <Archive className="w-4 h-4 opacity-50" />
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
                      {tickets
                        .filter(t => 
                          t.subject.toLowerCase().includes(closedTicketsSearchQuery.toLowerCase()) ||
                          t.creator.toLowerCase().includes(closedTicketsSearchQuery.toLowerCase()) ||
                          (t.closedBy || '').toLowerCase().includes(closedTicketsSearchQuery.toLowerCase())
                        )
                        .map((t, idx) => (
                        <div key={`closed_ticket_${t.id}_${idx}`} className={`p-5 rounded-2xl border border-white/5 cursor-pointer transition-all duration-300 group relative overflow-hidden ${activeTicketId === t.id ? 'border-red/40 bg-red/5 shadow-lg' : 'hover:bg-white/[0.04]'}`} onClick={() => openTicketModal(t)}>
                          <p className="font-bold text-sm text-white mb-2 group-hover:text-red transition-colors">{t.subject}</p>
                          <div className="flex justify-between items-center text-[9px] text-text-dim">
                            <span className="flex items-center gap-1"><UserIcon size={10} /> {t.creator}</span>
                            <span className="flex items-center gap-1 text-red/60 uppercase font-black tracking-widest"><CheckCircle2 size={10} /> {t.closedBy}</span>
                          </div>
                          {activeTicketId === t.id && <motion.div layoutId="archiveActive" className="absolute left-0 top-0 w-1 h-full bg-red" />}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="lg:col-span-8 bg-[#0c0c0c]/40 rounded-[28px] border border-white/5 flex flex-col overflow-hidden relative shadow-2xl">
                    <div className="absolute inset-0 bg-red/[0.01] pointer-events-none"></div>
                    {activeTicket && activeTicket.status === 'done' ? (
                      <>
                        <div className="p-6 bg-white/[0.02] border-b border-white/5 flex justify-between items-center z-10 backdrop-blur-md">
                          <div className="flex items-center gap-4">
                            <div className="w-10 h-10 bg-red/10 rounded-xl flex items-center justify-center text-red border border-red/20 shadow-lg">
                              <Archive size={20} />
                            </div>
                            <div>
                               <h4 className="font-bold text-white text-base truncate max-w-[200px] sm:max-w-md">{activeTicket.subject}</h4>
                               <p className="text-[10px] text-text-dim mt-1">المعرف: #{activeTicket.id} | تم الإغلاق: {formatDate(activeTicket.closedAt || 0)}</p>
                            </div>
                          </div>
                          <div className="flex flex-col items-end">
                             <span className="text-[9px] font-black text-red bg-red/10 px-3 py-1 rounded-full border border-red/20 uppercase tracking-widest">Archived</span>
                          </div>
                        </div>
                        <div className="flex-1 overflow-y-auto p-8 flex flex-col gap-6 custom-scrollbar z-10 opacity-80 filter grayscale-[0.3]">
                          {[...activeTicket.msgs].sort((a,b) => (a.timestamp || 0) - (b.timestamp || 0)).map((m, i) => (
                            <div key={i} className={`flex flex-col group ${m.sender === 'system' ? 'items-center' : (m.sender === 'logs' ? 'items-end' : 'items-start')}`}>
                              {m.sender !== 'system' && (
                                <div className={`flex items-center gap-2 mb-2 text-[9px] font-black tracking-widest uppercase px-2 ${m.sender === 'logs' ? 'flex-row-reverse text-red' : 'text-text-dim'}`}>
                                  <span>{m.senderName}</span>
                                  <span className="opacity-30 font-mono">{formatDate(m.timestamp || 0)}</span>
                                </div>
                              )}
                              <div className={`lux-bubble relative group/msg ${m.sender === 'system' ? 'bg-white/5 border-white/10 text-white/40 text-[10px] py-2 px-6' : (m.sender === 'logs' ? 'bg-red/10 border-red/20 text-white chat-bubble-logs' : 'bg-white/[0.03] border-white/10 text-gray-300 chat-bubble-admin')}`}>
                                {m.type === 'text' && <p className="leading-relaxed font-arabic whitespace-pre-wrap">{m.text}</p>}
                                {m.type !== 'text' && (
                                  <div className="space-y-3">
                                    {m.type === 'image' ? (
                                      <img src={m.url} className="rounded-xl max-w-full h-auto cursor-zoom-in hover:scale-[1.02] transition-transform shadow-2xl" alt="Attachment" onClick={() => window.open(m.url, '_blank')} />
                                    ) : (
                                      <video src={m.url} controls className="rounded-xl max-w-full h-auto shadow-2xl" />
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </>
                    ) : (
                      <div className="flex-1 flex flex-col items-center justify-center text-text-dim gap-6 opacity-40">
                        <div className="p-8 bg-white/5 rounded-full border border-white/10 mb-2">
                          <XCircle size={64} strokeWidth={1} />
                        </div>
                        <h3 className="text-xl font-black font-arabic">يرجى تحديد تذكرة مؤرشفة للمراجعة</h3>
                      </div>
                    )}
                  </div>
               </div>
            </motion.div>
          )}

          {/* MANAGE SECTION */}
          {activeSec === 'manage' && isManager && (
            <motion.div key="manage" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-12">
               <div className="card !p-0 overflow-hidden border-orange/20 shadow-[0_0_50px_rgba(255,106,0,0.05)]">
                 <div className="bg-aside p-6 border-b border-white/5 flex justify-between items-center">
                    <div>
                      <h2 className="text-2xl font-black text-white font-arabic">لوحة التحكم بالصلاحيات</h2>
                      <p className="text-xs text-text-dim mt-1 uppercase tracking-widest font-orbitron">Member Access Control</p>
                    </div>
                    <Users className="text-orange w-8 h-8 opacity-50" />
                 </div>
                 <div className="overflow-x-auto">
                    <table className="w-full text-right border-collapse">
                      <thead>
                        <tr className="text-orange text-[10px] font-black uppercase tracking-[0.2em] border-b border-white/5 bg-white/[0.02]">
                          <th className="p-6">المستخدم</th>
                          <th className="p-6">الرتبة الحالية</th>
                          <th className="p-6">تغيير الرتبة</th>
                          <th className="p-6">الحالة</th>
                          <th className="p-6">الإجراءات</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {users.filter(u => u.user !== 'admin' && u.user !== currentUser.user).map((u, i) => (
                          <tr key={`manage_user_${u.user}_${i}`} className="group hover:bg-white/[0.02] transition-all">
                            <td className="p-6">
                              <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-orange/10 rounded-full border border-orange/20 flex items-center justify-center font-black text-orange">
                                  {u.user[0].toUpperCase()}
                                </div>
                                <span className="font-bold text-white">{u.user}</span>
                              </div>
                            </td>
                            <td className="p-6">
                              <span className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest ${u.role === UserRole.MANAGER ? 'bg-red/10 text-red border border-red/20' : (u.role === UserRole.LOGS ? 'bg-orange/10 text-orange border border-orange/20' : 'bg-blue-500/10 text-blue-400 border border-blue-500/20')}`}>
                                {u.role}
                              </span>
                            </td>
                            <td className="p-6">
                               <select 
                                 className="bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-[11px] font-bold text-white focus:border-orange/50 transition-all outline-none"
                                 value={u.role}
                                 onChange={async (e) => {
                                   const newRole = e.target.value as UserRole;
                                   const updated = { ...u, role: newRole };
                                   await putItem('users', updated);
                                   setUsers(users.map(usr => usr.user === u.user ? updated : usr));
                                   await addAuditLog('Change Role', `Changed ${u.user} role to ${newRole}`);
                                 }}
                               >
                                 <option value={UserRole.ADMIN}>Staff / إداري</option>
                                 <option value={UserRole.LOGS}>Logs Team / عضو لوقز</option>
                                 <option value={UserRole.MANAGER}>Manager / منجـر</option>
                               </select>
                            </td>
                            <td className="p-6">
                              <span className={`px-3 py-1 rounded-lg text-[10px] font-black ${u.status === 'active' ? 'text-green-400' : 'text-red-500 bg-red-500/5'}`}>
                                {u.status === 'active' ? '✓ ACTIVE' : '⚠ PENDING'}
                              </span>
                            </td>
                            <td className="p-6">
                              <div className="flex gap-3">
                                {u.status === 'pending' && (
                                  <button 
                                    className="px-5 py-2 bg-orange text-black rounded-xl text-xs font-black shadow-[0_5px_15px_rgba(255,106,0,0.2)] hover:scale-105 transition-transform" 
                                    onClick={() => approveUser(u.user)}
                                  >
                                    قبول
                                  </button>
                                )}
                                <button 
                                  className="w-12 h-12 flex items-center justify-center bg-red/10 text-red rounded-xl hover:bg-red/20 transition-all border border-red/20 active:scale-95 shadow-lg" 
                                  onClick={() => deleteUser(u.user)}
                                >
                                  <Trash2 size={24} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                 </div>
               </div>
            </motion.div>
          )}

          {/* AUDIT LOGS SECTION */}
          {activeSec === 'audit_logs' && isManager && (
            <motion.div key="audit_logs" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-8">
               <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                  <div className="border-r-4 border-orange pr-4">
                    <h2 className="text-3xl font-black text-white font-arabic">سجل العمليات الكامل (Audit Logs)</h2>
                    <p className="text-xs text-text-dim mt-1 uppercase tracking-[0.3em] font-orbitron">Centralized Security Ledger</p>
                  </div>
                  <div className="relative w-full md:w-80">
                    <Search className="absolute right-3 top-3.5 text-text-dim w-5 h-5" />
                    <input 
                      type="text" 
                      placeholder="بحث في السجلات..." 
                      className="input-field pr-12 h-12" 
                      value={auditLogSearchQuery}
                      onChange={e => setAuditLogSearchQuery(e.target.value)}
                    />
                  </div>
               </div>

               <div className="space-y-3">
                  {auditLogs
                    .filter(log => 
                      log.action.toLowerCase().includes(auditLogSearchQuery.toLowerCase()) || 
                      log.userName.toLowerCase().includes(auditLogSearchQuery.toLowerCase()) ||
                      log.details.toLowerCase().includes(auditLogSearchQuery.toLowerCase())
                    )
                    .map((log, index) => (
                    <motion.div 
                      layout
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      key={`audit_log_${log.id}_${index}`} 
                      className="card !p-0 overflow-hidden hover:bg-white/[0.02] border-white/5 transition-all group shadow-[0_10px_40px_rgba(0,0,0,0.3)]"
                    >
                      <div className="flex items-stretch min-h-[100px]">
                        <div className="w-1.5 bg-orange opacity-40 group-hover:opacity-100 transition-opacity"></div>
                        <div className="flex-1 p-6 grid grid-cols-1 md:grid-cols-4 gap-6 items-center">
                          <div className="flex items-center gap-4">
                             <div className="w-12 h-12 bg-orange/10 rounded-2xl flex items-center justify-center font-black text-white border border-orange/20 shadow-lg group-hover:scale-105 transition-transform">
                               {log.userName[0].toUpperCase()}
                             </div>
                             <div>
                               <p className="text-[9px] text-text-dim font-black uppercase tracking-[0.2em] mb-1">Executor / المنفذ</p>
                               <p className="text-sm font-black text-white font-orbitron">{log.userName}</p>
                             </div>
                          </div>
                          <div>
                            <p className="text-[9px] text-text-dim font-black uppercase tracking-[0.2em] mb-1">Action / العملية</p>
                            <span className="text-[10px] font-black px-3 py-1 bg-white/5 border border-white/10 rounded-lg text-orange uppercase tracking-wider">{log.action}</span>
                          </div>
                          <div className="md:col-span-1">
                            <p className="text-[9px] text-text-dim font-black uppercase tracking-[0.2em] mb-1">Timestamp / التاريخ</p>
                            <p className="text-[11px] font-mono opacity-70 text-white">{formatDate(log.timestamp)}</p>
                          </div>
                          <div className="bg-black/60 p-5 rounded-2xl border border-white/5 group-hover:border-orange/20 transition-colors flex-1 w-full relative">
                             <div className="absolute top-2 right-2 opacity-5">
                               <ShieldAlert size={40} />
                             </div>
                             <p className="text-[11px] leading-relaxed text-gray-300 italic font-arabic relative z-10">{log.details}</p>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                  {auditLogs.length === 0 && (
                    <div className="py-20 text-center text-text-dim opacity-30 italic">لا توجد سجلات حالياً</div>
                  )}
               </div>
            </motion.div>
          )}

          {/* GOALS SECTION */}
          {activeSec === 'goals' && (
            <motion.div key="goals" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="card p-10 space-y-10">
               <h2 className="text-3xl text-orange font-black border-r-4 border-orange pr-6 font-orbitron">أهداف عمل قسم Logs Team</h2>
               <div className="space-y-6">
                 {[
                   { icon: <Search />, title: "الرقابة والرصد التقني", body: "ممارسة أعلى مستويات الرقابة التقنية على كافة السجلات والعمليات داخل النظام، ورصد أي نشاط مشبوه أو محاولات عبث تمس أمن واستقرار السيرفر." },
                   { icon: <Gavel />, title: "ترسيخ العدالة الإدارية", body: "المساهمة في دعم العدالة الإدارية عبر تقديم أدلة رقمية دقيقة وموثوقة، تضمن اتخاذ القرارات وفق أسس عادلة واحترافية بعيدة عن الاجتهادات الشخصية." },
                   { icon: <ShieldAlert />, title: "حماية سرية المعلومات", body: "الحفاظ التام على خصوصية بيانات المجتمع والمعلومات الحساسة، والتعامل معها وفق أعلى معايير السرية والمهنية المعتمدة داخل الإدارة." },
                   { icon: <Target />, title: "التوثيق وإعداد التقارير", body: "إعداد تقارير رقابية وأمنية دورية تُرفع للإدارة العليا، تتضمن المستجدات والحالات المرصودة والإجراءات المتخذة والتوصيات اللازمة لتعزيز الأمن التنظيمي." },
                 ].map((goal, i) => (
                   <div key={i} className="flex gap-6 items-start bg-zinc-900/40 p-6 rounded-3xl border-r-4 border-orange transition-all duration-300 hover:bg-orange/10 hover:shadow-[0_0_30px_rgba(255,106,0,0.2)] hover:scale-[1.01] group cursor-default">
                     <div className="text-orange shrink-0 bg-orange/10 p-4 rounded-2xl">{goal.icon}</div>
                     <div>
                       <h4 className="text-lg font-bold mb-2">{goal.title}</h4>
                       <p className="text-text-dim text-sm leading-relaxed">{goal.body}</p>
                     </div>
                   </div>
                 ))}
               </div>
            </motion.div>
          )}

          {activeSec === 'team' && (
            <motion.div key="team" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-8">
               <div>
                 <div className="section-title text-xl text-orange font-bold border-r-4 border-orange pr-4 mb-10 font-orbitron">Managers</div>
                 <div className="flex flex-wrap justify-center gap-8 pb-4">
                   <TeamCard img="https://i.postimg.cc/67PvHZ08/ce8f0b8d33b78b374f1bb5befb384664.webp" name="Hazem" role="Manager" />
                   <TeamCard img="https://i.postimg.cc/bGrnHgQn/a600e837cb02c2686385ec98c653b650.webp" name="Abdulmalik" role="Manager" highlight />
                   <TeamCard img="https://i.postimg.cc/McHBb5yj/1a193e863f6c77744178d5e35aa5b2f4.webp" name="ERIC" role="Manager" />
                 </div>
               </div>

               <div className="flex flex-col items-center">
                 <div className="section-title text-xl text-orange font-bold border-r-4 border-orange pr-4 mb-4 font-orbitron self-start">Leader</div>
                 <TeamCard img="https://i.postimg.cc/d7fyWCB1/08dc51c773720277f5ff1070bab6d13e.webp" name="Meshal" role="Team Leader" />
               </div>

               <div>
                 <div className="section-title text-xl text-orange font-bold border-r-4 border-orange pr-4 mb-8 font-orbitron">Members</div>
                 <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-7 gap-4">
                   {[
                     { img: "https://i.postimg.cc/B8zKhFgL/e8aae06603194b6be3576ea76bff3281.webp", name: "Qm7md" },
                     { img: "https://i.postimg.cc/8FY6yvHF/4f061a337c25e1054e07f6e4e35e76b6.webp", name: "Saad" },
                     { img: "https://i.postimg.cc/KKWM9TNR/9ce4c94a556a96c2bfe1333cb8ee0dc5.webp", name: "Mjeed" },
                     { img: "https://i.postimg.cc/GBfyMDQ9/770dd8597a42a19217a035305a352aee.webp", name: "Mod" },
                     { img: "https://i.postimg.cc/JyFkTXqh/a983d12b6e78113d823387c14c442b61.webp", name: "Rakan" },
                     { img: "https://i.postimg.cc/LqW1yPT8/60b49929b666ef976263261f2d59357d.webp", name: "WL2" },
                     { img: "https://i.postimg.cc/v1KVPnzH/1756a6bd283fd95ccd48509c92e75af6.webp", name: "RT" },
                   ].map((m, i) => (
                     <TeamCard key={i} img={m.img} name={m.name} role="Member" small />
                   ))}
                 </div>
               </div>
            </motion.div>
          )}

          {/* PRE-WL HACKS PAGE */}
          {activeSec === 'pre_wl_hacks' && isStaff && (
            <motion.div key="pre_wl_hacks" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-6 px-[4%]" dir="rtl">

              {/* Header — same as PC-CHECK */}
              <div className="card glow-hover border-r-[6px] border-red-500 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-2xl bg-red-500/10 flex items-center justify-center shrink-0">
                      <ShieldAlert className="text-red-400" size={24} />
                    </div>
                    <div>
                      <h1 className="font-orbitron text-2xl sm:text-3xl font-black">الهاكات قبل <span className="text-red-400">الوايت لست</span></h1>
                      <p className="text-text-dim text-xs mt-0.5">سجلات اللاعبين المرصودين أو المبندين قبل دخول الوايت لست</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="bg-red-500/10 border border-red-500/30 text-red-400 font-orbitron font-black text-sm px-3 py-1.5 rounded-xl">
                      {preWLHacks.length} سجل
                    </span>
                    {isStaff && (
                      <button className="btn-gold flex items-center gap-2 text-sm" onClick={() => { setPreWLShowForm(true); setPreWLEditId(null); setPreWLForm({ rawText: '', bannedFrom: '', hackActive: 'yes', imageBase64: '' }); }}>
                        <Plus size={16} /> إضافة سجل
                      </button>
                    )}
                  </div>
                </div>

                {/* Search + Filter — same layout as PC-CHECK */}
                <div className="flex flex-col sm:flex-row gap-3">
                  <div className="relative flex-1">
                    <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-dim" />
                    <input
                      className="input-field pr-10 text-sm"
                      placeholder="ابحث باسم اللاعب، License، Steam، Discord، XBL، IP..."
                      value={preWLSearch}
                      onChange={e => { setPreWLSearch(e.target.value); if (e.target.value.trim()) addAuditLog('Pre-WL: بحث', `بحث: ${e.target.value.trim()}`); }}
                      dir="ltr"
                    />
                  </div>
                  <select value={preWLFilter} onChange={e => setPreWLFilter(e.target.value as any)} className="input-field sm:w-48 text-sm">
                    <option value="all">كل السجلات</option>
                    <option value="active">متفعل فقط</option>
                    <option value="inactive">غير متفعل فقط</option>
                  </select>
                </div>
              </div>

              {/* Add/Edit Form — same as PC-CHECK form */}
              <AnimatePresence>
                {preWLShowForm && isStaff && (
                  <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="card border border-red-500/30 space-y-4">
                    <div className="flex items-center justify-between">
                      <h2 className="font-orbitron font-black text-lg">{preWLEditId ? 'تعديل السجل' : 'إضافة سجل جديد'}</h2>
                      <button onClick={() => { setPreWLShowForm(false); setPreWLEditId(null); }} className="bg-white/5 hover:bg-white/10 p-2 rounded-xl transition-all"><X size={16} /></button>
                    </div>

                    {/* Raw text paste */}
                    <div>
                      <label className="block text-xs text-text-dim mb-1.5">بيانات اللاعب — الصق النص كاملاً *</label>
                      <textarea
                        className="input-field text-sm min-h-[140px] font-mono resize-y"
                         placeholder={`FARS.94
license:(license:82e0973cd8dc22f8...)
steam:(steam:11000015bf85d3b)
discord:(discord:884529862147203123)
xbl:(xbl:2535466718541234)
liveid:(live:914799877748386)
ip:(ip:176.45.175.252)`}
                        value={preWLForm.rawText}
                        onChange={e => setPreWLForm(f => ({ ...f, rawText: e.target.value }))}
                        dir="ltr"
                      />
                      {/* Live preview */}
                      {preWLForm.rawText.trim() && (() => {
                        const p = parsePreWLRaw(preWLForm.rawText);
                        const rows: [string, string][] = [];
                        if (p.playerName) rows.push(['اسم اللاعب', p.playerName]);
                        p.licenses.forEach((v, i) => rows.push([i === 0 ? 'License' : `License${i + 1}`, v]));
                        p.steams.forEach((v, i) => rows.push([i === 0 ? 'Steam' : `Steam ${i + 1}`, v]));
                        p.discords.forEach((v, i) => rows.push([i === 0 ? 'Discord' : `Discord ${i + 1}`, v]));
                        if (p.xbl) rows.push(['XBL', p.xbl]);
                        if (p.liveId) rows.push(['Live ID', p.liveId]);
                        if (p.ip) rows.push(['IP', p.ip]);
                        return rows.length > 0 ? (
                          <div className="mt-2 p-3 rounded-xl bg-green-500/5 border border-green-500/20 grid grid-cols-1 sm:grid-cols-2 gap-1">
                            {rows.map(([l, v]) => (
                              <div key={l} className="flex items-center gap-2 text-xs">
                                <span className="text-text-dim w-24 shrink-0">{l}:</span>
                                <span className="text-green-400 font-mono truncate">{v}</span>
                              </div>
                            ))}
                          </div>
                        ) : null;
                      })()}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {/* Banned from */}
                      <div>
                        <label className="block text-xs text-text-dim mb-1.5">متبند من أي سيرفر؟ *</label>
                        <input className="input-field text-sm" placeholder="اسم السيرفر..." value={preWLForm.bannedFrom} onChange={e => setPreWLForm(f => ({ ...f, bannedFrom: e.target.value }))} />
                      </div>
                      {/* Hack active — same toggle style as PC-CHECK cheater */}
                      <div>
                        <label className="block text-xs text-text-dim mb-1.5">هل الهاك متفعل؟ *</label>
                        <div className="flex bg-black/40 p-1 rounded-xl border border-white/5">
                          <button type="button" onClick={() => setPreWLForm(f => ({ ...f, hackActive: 'no' }))} className={`flex-1 py-2 rounded-lg text-xs font-black transition-all ${preWLForm.hackActive === 'no' ? 'bg-emerald-500/20 text-emerald-400' : 'text-text-dim'}`}>
                            لا — غير متفعل
                          </button>
                          <button type="button" onClick={() => setPreWLForm(f => ({ ...f, hackActive: 'yes' }))} className={`flex-1 py-2 rounded-lg text-xs font-black transition-all ${preWLForm.hackActive === 'yes' ? 'bg-red-500/20 text-red-400' : 'text-text-dim'}`}>
                            نعم — متفعل
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Image upload */}
                    <div>
                      <label className="block text-xs text-text-dim mb-1.5">صورة مرفقة (اختياري)</label>
                      <div className="flex items-center gap-3">
                        <label htmlFor="prewl-img-upload" className="cursor-pointer bg-orange/10 px-4 py-2.5 rounded-xl border border-orange/20 hover:bg-orange/20 transition-all text-sm text-orange flex items-center gap-2">
                          <Upload size={14} /> {preWLForm.imageBase64 ? 'تغيير الصورة' : 'رفع صورة'}
                        </label>
                        <input type="file" accept="image/*" id="prewl-img-upload" className="hidden" onChange={preWLImageUpload} />
                        {preWLForm.imageBase64 && (
                          <div className="relative">
                            <img src={preWLForm.imageBase64} className="h-14 w-14 rounded-xl object-cover border border-white/10 cursor-pointer" onClick={() => setFullScreenMedia({ url: preWLForm.imageBase64!, type: 'image' })} />
                            <button className="absolute -top-1.5 -right-1.5 bg-red-500 rounded-full p-0.5 hover:bg-red-600 transition-colors" onClick={() => setPreWLForm(f => ({ ...f, imageBase64: '' }))}><X size={10} /></button>
                          </div>
                        )}
                      </div>
                    </div>

                    <button className="btn-gold w-full" onClick={preWLSave}>{preWLEditId ? 'حفظ التعديلات' : 'حفظ السجل'}</button>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Detail view — fixed full-screen overlay, same style as Evidence / Ban Form modals */}
              <AnimatePresence>
                {preWLView === 'detail' && preWLSelected && (() => {
                  const hack = preWLHacks.find(h => h.id === preWLSelected.id) || preWLSelected;
                  return (
                    <motion.div
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                      className="fixed inset-0 z-[150] bg-black/95 backdrop-blur-2xl flex items-center justify-center p-4"
                      dir="rtl"
                      onClick={() => { setPreWLSelected(null); setPreWLView('list'); }}
                    >
                      <motion.div
                        initial={{ opacity: 0, scale: 0.97, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97, y: 16 }}
                        className="card border border-orange/20 w-full max-w-4xl max-h-[92vh] shadow-[0_0_80px_rgba(255,106,0,0.12)] flex flex-col overflow-hidden !p-0"
                        onClick={e => e.stopPropagation()}
                      >
                        {/* Detail header — fixed, never scrolls */}
                        <div className="flex items-start justify-between gap-4 flex-wrap p-7 border-b border-white/5 shrink-0">
                          <div className="space-y-2">
                            <div className="flex items-center gap-3 flex-wrap">
                              <h2 className="font-orbitron font-black text-2xl text-white">{hack.playerName || 'غير معروف'}</h2>
                              <span className={`px-3.5 py-1.5 rounded-full text-xs font-black border ${hack.hackActive === 'yes' ? 'bg-red-500/15 text-red-400 border-red-500/30' : 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'}`}>
                                حالة الهاك: {hack.hackActive === 'yes' ? 'متفعل 🔴' : 'غير متفعل 🟢'}
                              </span>
                            </div>
                            <p className="text-sm text-text-dim flex items-center gap-1.5"><Server size={13} /> متبند من: <span className="text-white font-bold">{hack.bannedFrom}</span></p>
                          </div>
                          <div className="flex items-center gap-2">
                            <button className="bg-white/5 hover:bg-orange/10 hover:text-orange border border-white/10 hover:border-orange/30 px-3.5 py-2 rounded-xl text-xs transition-all flex items-center gap-1.5" onClick={() => preWLCopyAll(hack)}>
                              {preWLCopied === 'all-' + hack.id ? <><Check size={12} className="text-green-400" /> تم!</> : <><Copy size={12} /> نسخ الكل</>}
                            </button>
                            <button className="bg-white/5 hover:bg-white/10 p-2.5 rounded-xl transition-all" onClick={() => { setPreWLSelected(null); setPreWLView('list'); }}><X size={16} /></button>
                          </div>
                        </div>

                        {/* Scrollable body */}
                        <div className="flex-1 overflow-y-auto custom-scrollbar p-7 space-y-6">
                        {/* Identifiers with copy buttons */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                          {(() => {
                            const fields: [string, string, string][] = [];
                            if (hack.playerName) fields.push(['اسم اللاعب', 'name', hack.playerName]);
                            (hack.licenses?.length ? hack.licenses : [hack.license, hack.license2].filter(Boolean))
                              .forEach((v, i) => fields.push([i === 0 ? 'License' : `License${i + 1}`, `license${i > 0 ? i + 1 : ''}`, v]));
                            (hack.steams?.length ? hack.steams : [hack.steam].filter(Boolean))
                              .forEach((v, i) => fields.push([i === 0 ? 'Steam' : `Steam ${i + 1}`, `steam${i > 0 ? i + 1 : ''}`, v]));
                            (hack.discords?.length ? hack.discords : [hack.discord].filter(Boolean))
                              .forEach((v, i) => fields.push([i === 0 ? 'Discord' : `Discord ${i + 1}`, `discord${i > 0 ? i + 1 : ''}`, v]));
                            if (hack.xbl) fields.push(['XBL', 'xbl', hack.xbl]);
                            if (hack.liveId) fields.push(['Live ID', 'liveId', hack.liveId]);
                            if (hack.ip) fields.push(['IP Address', 'ip', hack.ip]);
                            return fields.map(([label, field, val]) => (
                              <div key={field} className="flex items-center gap-3 p-3.5 rounded-xl bg-green-500/5 border border-green-500/15">
                                <div className="flex-1 min-w-0">
                                  <p className="text-[11px] text-text-dim mb-1">{label}</p>
                                  <p className="text-[15px] font-mono text-green-400 break-all">{val}</p>
                                </div>
                                <button className="shrink-0 bg-white/5 hover:bg-green-500/10 hover:text-green-400 border border-white/10 hover:border-green-500/30 p-2 rounded-lg transition-all" onClick={() => preWLCopyField(hack.id, field, val)}>
                                  {preWLCopied === field + '-' + hack.id ? <Check size={13} className="text-green-400" /> : <Copy size={13} />}
                                </button>
                              </div>
                            ));
                          })()}
                        </div>

                        {/* Image */}
                        {hack.imageBase64 && (
                          <div>
                            <p className="text-xs text-text-dim mb-2">الصورة المرفقة</p>
                            <img src={hack.imageBase64} className="h-48 rounded-xl object-cover border border-white/10 cursor-pointer hover:opacity-90 transition-opacity" onClick={() => setFullScreenMedia({ url: hack.imageBase64!, type: 'image' })} />
                          </div>
                        )}

                        {/* Raw text */}
                        <div>
                          <p className="text-xs text-text-dim mb-2">النص الأصلي</p>
                          <pre className="bg-black/40 rounded-xl p-4 text-xs font-mono text-white/70 overflow-x-auto border border-white/5 whitespace-pre-wrap" dir="ltr">{hack.rawText}</pre>
                        </div>

                        {/* Meta */}
                        <div className="grid sm:grid-cols-2 gap-3 text-xs text-text-dim border-t border-white/5 pt-4">
                          <span>أضافه: <span className="text-white font-bold">{hack.createdBy}</span> <span className="text-orange">({hack.createdByRole})</span> • {new Date(hack.createdAt).toLocaleString('ar-SA')}</span>
                          {hack.updatedBy && <span>آخر تعديل: <span className="text-white font-bold">{hack.updatedBy}</span> <span className="text-orange">({hack.updatedByRole})</span> • {new Date(hack.updatedAt!).toLocaleString('ar-SA')}</span>}
                        </div>

                        {/* Activity Timeline */}
                        {hack.timeline && hack.timeline.length > 0 && (
                          <div className="space-y-3 border-t border-white/5 pt-4">
                            <h4 className="text-xs font-black text-orange uppercase tracking-widest font-orbitron flex items-center gap-2"><Clock size={12} /> Activity Timeline</h4>
                            <div className="space-y-2">
                              {[...hack.timeline].reverse().map((ev, i) => (
                                <div key={i} className="flex gap-3 text-xs">
                                  <div className="w-1.5 h-1.5 rounded-full bg-orange mt-1.5 shrink-0" />
                                  <div>
                                    <span className="text-white font-bold">{ev.action}</span>
                                    <span className="text-text-dim"> — {ev.by} </span>
                                    <span className="text-orange text-[10px]">({ev.byRole})</span>
                                    <span className="text-text-dim font-mono text-[10px] block">{new Date(ev.at).toLocaleString('ar-SA')}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        </div>
                      </motion.div>
                    </motion.div>
                  );
                })()}
              </AnimatePresence>

              {/* Records list — same card style as PC-CHECK */}
              <div className="grid gap-3">
                {preWLFiltered.map(hack => (
                  <div
                    key={hack.id}
                    className={`card glow-hover space-y-3 border cursor-pointer ${hack.hackActive === 'yes' ? 'border-red-500/20' : 'border-white/5'}`}
                    onClick={() => {
                        setPreWLSelected(hack);
                        setPreWLView('detail');
                      }}
                  >
                    <div className="flex items-start justify-between gap-4">
                      {/* Icon + name + status */}
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${hack.hackActive === 'yes' ? 'bg-red-500/10 text-red-400' : 'bg-emerald-500/10 text-emerald-400'}`}>
                          {hack.hackActive === 'yes' ? <ShieldAlert size={18} /> : <ShieldCheck size={18} />}
                        </div>
                        <div className="min-w-0">
                          <p className="font-bold text-white truncate">{hack.playerName || 'غير معروف'}</p>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`text-[10px] font-black uppercase tracking-widest ${hack.hackActive === 'yes' ? 'text-red-400' : 'text-emerald-400'}`}>
                              حالة الهاك: {hack.hackActive === 'yes' ? 'متفعل 🔴' : 'غير متفعل 🟢'}
                            </span>
                            <span className="text-[10px] text-text-dim">🚫 {hack.bannedFrom}</span>
                          </div>
                        </div>
                      </div>
                      {/* Action buttons */}
                      <div className="flex items-center gap-2 shrink-0" onClick={e => e.stopPropagation()}>
                        <button
                          onClick={() => preWLCopyAll(hack)}
                          className="bg-white/5 hover:bg-orange/10 hover:text-orange border border-white/10 hover:border-orange/30 px-2.5 py-1.5 rounded-xl text-xs transition-all flex items-center gap-1.5"
                        >
                          {preWLCopied === 'all-' + hack.id ? <Check size={11} className="text-green-400" /> : <Copy size={11} />}
                          {preWLCopied === 'all-' + hack.id ? 'تم!' : 'نسخ'}
                        </button>
                        {(isManager || hack.createdBy === currentUser?.user) && (
                          <button onClick={() => { setPreWLShowForm(true); preWLStartEdit(hack); }} className="bg-white/5 hover:bg-orange/10 hover:text-orange border border-white/10 hover:border-orange/30 px-2.5 py-1.5 rounded-xl text-xs transition-all flex items-center gap-1.5">
                            <Settings size={11} /> تعديل
                          </button>
                        )}
                        {isManager && (
                          <button onClick={() => preWLDelete(hack.id)} className="bg-white/5 hover:bg-red-500/10 hover:text-red-400 border border-white/10 hover:border-red-500/30 px-2.5 py-1.5 rounded-xl text-xs transition-all flex items-center gap-1.5">
                            <Trash2 size={11} /> حذف
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Identifiers grid — same style as PC-CHECK data grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs font-mono bg-black/30 rounded-xl p-3 border border-white/5" dir="ltr">
                      {[['License', hack.license], ['Steam', hack.steam], ['Discord', hack.discord], ['XBL', hack.xbl], ['Live ID', hack.liveId], ['IP', hack.ip]].filter(([,v]) => v).map(([l, v]) => (
                        <div key={l} className="flex flex-col gap-0.5">
                          <span className="text-text-dim text-[10px]">{l}:</span>
                          <span className="text-green-400 break-all">{v}</span>
                        </div>
                      ))}
                    </div>

                    {hack.imageBase64 && (
                      <img src={hack.imageBase64} className="h-20 rounded-xl object-cover border border-white/10 cursor-pointer hover:opacity-80 transition-opacity" onClick={e => { e.stopPropagation(); setFullScreenMedia({ url: hack.imageBase64!, type: 'image' }); }} />
                    )}

                    <div className="flex items-center justify-between text-[10px] text-text-dim pt-2 border-t border-white/5">
                      <span>أضافه: <span className="text-white font-bold">{hack.createdBy}</span> <span className="text-orange">({hack.createdByRole})</span></span>
                      <span className="font-mono">{new Date(hack.createdAt).toLocaleString('ar-SA')}</span>
                    </div>
                  </div>
                ))}

                {/* Empty state — same as PC-CHECK */}
                {preWLFiltered.length === 0 && (
                  <div className="card text-center py-16 text-text-dim">
                    <ShieldAlert size={32} className="mx-auto mb-3 opacity-30" />
                    <p className="text-sm">{preWLHacks.length === 0 ? 'لا توجد سجلات حالياً — ابدأ بإضافة أول سجل' : 'لا توجد نتائج مطابقة لمعايير البحث'}</p>
                  </div>
                )}
              </div>



            </motion.div>
          )}

          {/* PROFILE SECTION */}
          {activeSec === 'profile' && (
            <motion.div key="profile" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="card max-w-lg mx-auto space-y-6">
               <h2 className="text-2xl text-orange font-black text-center mb-6">إعدادات الحساب</h2>
               <div className="space-y-4">
                 <div>
                   <label className="text-xs text-text-dim block mb-2">تغيير اسم المستخدم</label>
                   <input type="text" className="input-field" placeholder={currentUser.user} value={authInputs.user} onChange={e => setAuthInputs({...authInputs, user: e.target.value})} />
                 </div>
                 <div>
                   <label className="text-xs text-text-dim block mb-2">تغيير كلمة المرور</label>
                   <input type="password" className="input-field" placeholder="كلمة المرور الجديدة" value={authInputs.pass} onChange={e => setAuthInputs({...authInputs, pass: e.target.value})} />
                 </div>
                 <button className="btn-orange w-full" onClick={updateProfile}>حفظ التغييرات</button>
               </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Command Palette — بحث شامل (Ctrl+K) */}
      <AnimatePresence>
        {commandPaletteOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-md flex items-start justify-center pt-[12vh] px-4"
            onClick={() => setCommandPaletteOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, y: -20, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -20, scale: 0.97 }}
              transition={{ duration: 0.18 }}
              className="w-full max-w-2xl bg-[#0a0a0a] border border-orange/30 rounded-3xl shadow-[0_0_60px_rgba(255,106,0,0.15)] overflow-hidden"
              onClick={e => e.stopPropagation()}
              dir="rtl"
            >
              <div className="flex items-center gap-3 px-5 py-4 border-b border-white/5">
                <Search size={18} className="text-orange flex-shrink-0" />
                <input
                  autoFocus
                  value={commandQuery}
                  onChange={e => { setCommandQuery(e.target.value); setCommandSelectedIndex(0); }}
                  onKeyDown={e => {
                    if (e.key === 'ArrowDown') { e.preventDefault(); setCommandSelectedIndex(i => Math.min(i + 1, commandResults.length - 1)); }
                    else if (e.key === 'ArrowUp') { e.preventDefault(); setCommandSelectedIndex(i => Math.max(i - 1, 0)); }
                    else if (e.key === 'Enter' && commandResults[commandSelectedIndex]) { navigateToSearchResult(commandResults[commandSelectedIndex]); }
                  }}
                  placeholder="بحث عن لاعب، ملف باند، دليل، أو حساب مرتبط... (Discord ID, اسم, سبب)"
                  className="flex-1 bg-transparent outline-none text-white placeholder:text-gray-600 text-sm font-arabic"
                />
                <span className="text-[9px] font-mono text-text-dim border border-white/10 rounded px-1.5 py-0.5">ESC</span>
              </div>

              <div className="max-h-[50vh] overflow-y-auto">
                {!commandQuery.trim() ? (
                  <div className="px-5 py-10 text-center text-text-dim text-xs font-arabic space-y-2">
                    <p>ابحث بأي طريقة — Discord ID، اسم لاعب، سبب باند، أو وصف دليل</p>
                    <p className="opacity-60">النتائج تشمل: القضايا، البلاوات، الأدلة، Intelligence Room، واللاعبين</p>
                  </div>
                ) : commandResults.length === 0 ? (
                  <div className="px-5 py-10 text-center text-text-dim text-xs font-arabic">لا توجد نتائج مطابقة لـ "{commandQuery}"</div>
                ) : (
                  <div className="py-2">
                    {commandResults.map((r, i) => {
                      const kindMeta: Record<string, { icon: any; color: string; label: string }> = {
                        case: { icon: Crosshair, color: 'text-orange', label: 'ملف' },
                        ban: { icon: Gavel, color: 'text-red', label: 'باند' },
                        evidence: { icon: Layers, color: 'text-blue-400', label: 'دليل' },
                        altProfile: { icon: Network, color: 'text-purple-400', label: 'Intelligence Room' },
                        player: { icon: UserIcon, color: 'text-emerald-400', label: 'لاعب' },
                        preWlHack: { icon: ShieldAlert, color: 'text-red-400', label: 'Pre WL Hack' },
                        pcCheck: { icon: MonitorCheck, color: 'text-cyan-400', label: 'PC Check' },
                      };
                      const meta = kindMeta[r.kind] || { icon: Search, color: 'text-text-dim', label: '' };
                      const Icon = meta.icon;
                      return (
                        <div
                          key={`${r.kind}-${r.id}`}
                          onClick={() => navigateToSearchResult(r)}
                          onMouseEnter={() => setCommandSelectedIndex(i)}
                          className={`flex items-center gap-3 px-5 py-3 cursor-pointer transition-colors ${i === commandSelectedIndex ? 'bg-orange/10 border-r-2 border-orange' : 'hover:bg-white/[0.03]'}`}
                        >
                          <div className={`w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center flex-shrink-0 ${meta.color}`}>
                            <Icon size={15} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-white font-bold truncate">{r.title}</p>
                            <p className="text-[11px] text-text-dim truncate">{r.subtitle}</p>
                          </div>
                          {i === commandSelectedIndex && <CornerDownLeft size={13} className="text-orange flex-shrink-0" />}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Confirmation Modal */}
      <AnimatePresence>
        {confirmModal.show && (
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[110] bg-black/90 backdrop-blur-md flex items-center justify-center p-6"
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="card max-w-sm w-full text-center space-y-6 border-orange/40 shadow-[0_0_50px_rgba(255,106,0,0.2)] bg-black/80"
              dir="rtl"
            >
              <div className="w-16 h-16 bg-orange/10 rounded-full flex items-center justify-center mx-auto border border-orange/20">
                <ShieldAlert className="text-orange w-8 h-8" />
              </div>
              <div className="space-y-2">
                <h3 className="text-xl font-black text-white font-arabic">{confirmModal.title}</h3>
                <p className="text-xs text-text-dim leading-relaxed">{confirmModal.message}</p>
              </div>
              <div className="flex gap-4 pt-2">
                <button 
                  className="btn-orange flex-1 !py-3 font-black font-arabic shadow-lg"
                  onClick={() => {
                    confirmModal.onConfirm();
                    setConfirmModal({ ...confirmModal, show: false });
                  }}
                >
                  تأكيد العملية
                </button>
                <button 
                  className="flex-1 bg-white/5 hover:bg-white/10 text-white font-bold rounded-xl transition-all border border-white/10"
                  onClick={() => setConfirmModal({ ...confirmModal, show: false })}
                >
                  إلغاء
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Media Modal */}
      <AnimatePresence>
        {fullScreenMedia && (
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[150] bg-black/95 backdrop-blur-3xl flex items-center justify-center p-4 md:p-12 overflow-hidden"
            onClick={() => setFullScreenMedia(null)}
          >
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-orange/10 via-transparent to-transparent opacity-30"></div>
            
            <motion.button 
              initial={{ opacity: 0, rotate: -90 }}
              animate={{ opacity: 1, rotate: 0 }}
              className="absolute top-6 right-6 w-12 h-12 flex items-center justify-center bg-white/5 hover:bg-orange text-white hover:text-black rounded-full transition-all z-[160] border border-white/10 hover:border-orange hover:shadow-[0_0_20px_rgba(255,106,0,0.5)]"
              onClick={() => setFullScreenMedia(null)}
            >
              <X size={24} />
            </motion.button>

            <motion.div 
              initial={{ scale: 0.8, opacity: 0, y: 40 }} 
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.8, opacity: 0, y: 40 }}
              className="relative max-w-7xl w-full h-full flex items-center justify-center pointer-events-none"
            >
              <div className="absolute -inset-4 bg-orange/20 rounded-[40px] blur-2xl opacity-20 animate-pulse"></div>
              
              <div 
                className="relative bg-[#050505] p-2 rounded-[32px] border-2 border-orange/40 shadow-[0_0_50px_rgba(0,0,0,0.8),0_0_30px_rgba(255,106,0,0.2)] pointer-events-auto overflow-hidden group"
                onClick={e => e.stopPropagation()}
              >
                {fullScreenMedia.type === 'video' ? (
                  <video src={fullScreenMedia.url} controls autoPlay className="max-w-full max-h-[85vh] rounded-[24px] outline-none" />
                ) : (
                  <img src={fullScreenMedia.url} className="max-w-full max-h-[85vh] rounded-[24px] object-contain shadow-2xl" />
                )}
                
                <div className="absolute top-6 left-6 flex items-center gap-3 bg-black/60 backdrop-blur-md px-4 py-2 rounded-xl border border-white/10 opacity-0 group-hover:opacity-100 transition-opacity">
                  <div className="w-2 h-2 bg-orange rounded-full animate-ping"></div>
                  <span className="text-[10px] text-white font-black uppercase tracking-widest font-orbitron">MT Logs High-Def Evidence</span>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* DB Setup & Diagnostics Helper Modal */}
      <AnimatePresence>
        {showDbDiagnostics && (
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[150] bg-black/95 backdrop-blur-md flex items-center justify-center p-6 overflow-y-auto"
            onClick={() => setShowDbDiagnostics(false)}
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="card max-w-2xl w-full space-y-6 border-orange/40 shadow-[0_0_80px_rgba(255,106,0,0.15)] bg-black/95 p-8 rounded-[40px]"
              onClick={e => e.stopPropagation()}
              dir="rtl"
            >
              <div className="flex justify-between items-center border-b border-white/5 pb-4">
                <div className="flex items-center gap-3">
                  <Terminal className="text-orange" size={24} />
                  <h3 className="text-xl font-black text-white font-arabic">مركز تشخيص قاعدة البيانات (Supabase Hub)</h3>
                </div>
                <button onClick={() => setShowDbDiagnostics(false)} className="bg-white/5 hover:bg-white/10 p-2 rounded-full transition-all">
                  <X size={18} />
                </button>
              </div>

              <div className="space-y-4 text-right">
                <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/5 space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-text-dim font-arabic">مستوى الاتصال السحابي:</span>
                    {supabase ? (
                      <span className="text-emerald-400 font-bold text-xs bg-emerald-400/10 px-3 py-1 rounded-full">متصل</span>
                    ) : (
                      <span className="text-amber-400 font-bold text-xs bg-amber-400/10 px-3 py-1 rounded-full">غير معد محلياً (IndexedDB)</span>
                    )}
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-text-dim font-arabic">حالة الاستعلامات والاتصال الفعلي:</span>
                    {diagnosticsState.hasErrors ? (
                      <span className="text-amber-400 font-bold text-xs bg-amber-400/10 px-3 py-1 rounded-full flex items-center gap-1">محدود (يرجى مراجعة الجداول)</span>
                    ) : (
                      <span className="text-emerald-400 font-bold text-xs bg-emerald-400/10 px-3 py-1 rounded-full">متصل</span>
                    )}
                  </div>
                </div>

                {diagnosticsState.hasErrors && (
                  <div className="p-4 bg-red/10 border border-red/20 rounded-2xl space-y-2">
                    <h4 className="text-xs font-black text-red uppercase tracking-wider font-orbitron">Last Detected Error Message / تفاصيل الخطأ الأخير:</h4>
                    <p className="text-xs text-gray-300 font-mono select-all bg-black/40 p-3 rounded-xl border border-white/5">{diagnosticsState.lastErrorMessage}</p>
                    <p className="text-[11px] text-text-dim leading-relaxed font-arabic">
                      * هذا الخطأ يعود غالباً إلى عدم إنشاء الجداول في حساب Supabase الخاص بك، أو عدم تفعيل سياسات المرور العامة (RLS) للمستخدمين غير المسجلين.
                    </p>
                  </div>
                )}

                <div className="space-y-3">
                  <h4 className="text-sm font-bold text-white font-arabic">حالة اتصال الجداول في السحابة:</h4>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {['users', 'tickets', 'bans', 'audit_logs', 'personal_notes'].map(table => {
                      const err = diagnosticsState.tableErrors[table];
                      return (
                        <div key={table} className={`p-4 rounded-xl border flex flex-col justify-between h-24 ${err ? 'bg-red/5 border-red/20' : 'bg-white/[0.02] border-white/5'}`}>
                          <span className="text-xs font-mono font-bold text-gray-200">{table}</span>
                          <span className={`text-[10px] font-bold ${err ? 'text-red/90' : 'text-emerald-400'}`}>
                            {err ? 'خطأ في الاستعلام' : 'متصل وجاهز'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function TeamCard({ img, name, role, highlight, small }: { img: string, name: string, role: string, highlight?: boolean, small?: boolean, key?: any }) {
  return (
    <div className={`card glow-hover flex flex-col items-center flex-shrink-0 transition-transform ${highlight ? 'scale-110 !border-orange z-10' : ''} ${small ? 'p-4 min-w-[140px]' : 'p-8 min-w-[220px]'}`}>
      <img src={img} className={`${small ? 'w-20 h-20' : 'w-32 h-32'} rounded-full border-4 border-[#222] object-cover mb-4`} />
      <h4 className={`${small ? 'text-sm' : 'text-lg'} font-bold`}>{name}</h4>
      <p className="text-[10px] text-text-dim uppercase tracking-tighter">{role}</p>
    </div>
  );
}
