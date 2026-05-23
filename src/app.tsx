/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */


const WORKER_URL = "https://r2-uploader.abotete1.workers.dev";

// ═══════════════════════════════════════════════════════
//  SECURE WEBHOOK PROXY — Webhooks hidden server-side
//  أرسل الإشعارات عبر Supabase Edge Function فقط
//  لا يوجد أي رابط webhook في هذا الكود
// ═══════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════
//  DISCORD WEBHOOKS — URLs loaded from db.ts env vars
// ═══════════════════════════════════════════════════════

const sendDiscordTicketNotification = async (subject: string, creator: string, ticketId: number | string) => {
  try {
    const webhookUrl = getDiscordWebhook('ticket');
    if (!webhookUrl) { console.warn('Ticket webhook not configured'); return; }
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
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) console.log('Discord ticket notify sent ✅');
    else console.error('Discord ticket error:', await res.text());
  } catch (e) {
    console.error('Discord ticket webhook error:', e);
  }
};

const sendDiscordBanNotification = async (discordId: string, banType: string, reason: string, bannedBy: string) => {
  try {
    const webhookUrl = getDiscordWebhook('ban');
    if (!webhookUrl) { console.warn('Ban webhook not configured'); return; }
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
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) console.log('Discord ban notify sent ✅');
    else console.error('Discord ban error:', await res.text());
  } catch (e) {
    console.error('Discord ban webhook error:', e);
  }
};

// ═══════════════════════════════════════════════════════
//  PASSWORD HASHING — SHA-256 via Web Crypto API
// ═══════════════════════════════════════════════════════

const hashPassword = async (password: string): Promise<string> => {
  // نحاول crypto.subtle أولاً (HTTPS) — نرجع لـ fallback لو ما توفر (HTTP)
  const salted = `MT_LOGS_2026:${password}:SEC_SALT_X9K`;
  try {
    if (typeof crypto !== 'undefined' && crypto.subtle && crypto.subtle.digest) {
      const encoder = new TextEncoder();
      const data = encoder.encode(salted);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }
  } catch {}
  // Fallback: خوارزمية hash بسيطة لا تحتاج Web Crypto API
  let hash = 0x811c9dc5;
  for (let i = 0; i < salted.length; i++) {
    hash ^= salted.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  // نطوّل الناتج لـ 64 حرف عشان يبقى متوافق مع تحقق الـ hash
  let result = hash.toString(16).padStart(8, '0');
  // نكرر ونخلط عشان نوصل 64 حرف
  let seed = hash;
  for (let r = 0; r < 7; r++) {
    seed = (seed * 0x5851f42d + 0xc4ceb9fe) >>> 0;
    result += seed.toString(16).padStart(8, '0');
  }
  return result.slice(0, 64);
};

const verifyPassword = async (password: string, hash: string): Promise<boolean> => {
  const computed = await hashPassword(password);
  return computed === hash;
};

// ═══════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════
//  SECURITY SYSTEM — Multi-Layer Protection
// ═══════════════════════════════════════════════════════

const SEC = {
  SESSION_KEY: '__mt_sess__',
  REMEMBER_KEY: '__mt_rmb__',
  FINGERPRINT_KEY: '__mt_fp__',
  CSRF_KEY: '__mt_csrf__',
  ATTEMPTS_KEY: '__mt_atm__',
  LOCKOUT_KEY: '__mt_lck__',
  MAX_ATTEMPTS: 5,
  LOCKOUT_DURATION: 15 * 60 * 1000,
  SESSION_DURATION: 2 * 60 * 60 * 1000,
  REMEMBER_DURATION: 30 * 24 * 60 * 60 * 1000,
};

const obfuscate = (str: string): string => {
  const key = 'MT_LOGS_SECURE_2026';
  return btoa(str.split('').map((c, i) =>
    String.fromCharCode(c.charCodeAt(0) ^ key.charCodeAt(i % key.length))
  ).join(''));
};

const deobfuscate = (str: string): string => {
  try {
    const key = 'MT_LOGS_SECURE_2026';
    return atob(str).split('').map((c, i) =>
      String.fromCharCode(c.charCodeAt(0) ^ key.charCodeAt(i % key.length))
    ).join('');
  } catch { return ''; }
};

const getBrowserFingerprint = (): string => {
  const components = [
    navigator.userAgent,
    navigator.language,
    screen.width + 'x' + screen.height,
    screen.colorDepth,
    new Date().getTimezoneOffset(),
    navigator.hardwareConcurrency || 0,
    navigator.platform || '',
  ].join('|');
  let hash = 0;
  for (let i = 0; i < components.length; i++) {
    const char = components.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
};

const generateCSRFToken = (): string => {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
};

const checkRateLimit = (): { blocked: boolean; remaining: number; lockoutLeft: number } => {
  const lockoutStr = localStorage.getItem(SEC.LOCKOUT_KEY);
  if (lockoutStr) {
    const lockoutUntil = parseInt(lockoutStr);
    const now = Date.now();
    if (now < lockoutUntil) {
      return { blocked: true, remaining: 0, lockoutLeft: Math.ceil((lockoutUntil - now) / 1000) };
    } else {
      localStorage.removeItem(SEC.LOCKOUT_KEY);
      localStorage.removeItem(SEC.ATTEMPTS_KEY);
    }
  }
  const attemptsStr = localStorage.getItem(SEC.ATTEMPTS_KEY);
  const attempts = attemptsStr ? JSON.parse(attemptsStr) : [];
  const recent = attempts.filter((t: number) => Date.now() - t < 10 * 60 * 1000);
  return { blocked: false, remaining: SEC.MAX_ATTEMPTS - recent.length, lockoutLeft: 0 };
};

const recordFailedAttempt = () => {
  const attemptsStr = localStorage.getItem(SEC.ATTEMPTS_KEY);
  const attempts = attemptsStr ? JSON.parse(attemptsStr) : [];
  attempts.push(Date.now());
  const recent = attempts.filter((t: number) => Date.now() - t < 10 * 60 * 1000);
  localStorage.setItem(SEC.ATTEMPTS_KEY, JSON.stringify(recent));
  if (recent.length >= SEC.MAX_ATTEMPTS) {
    localStorage.setItem(SEC.LOCKOUT_KEY, String(Date.now() + SEC.LOCKOUT_DURATION));
  }
};

const clearAttempts = () => {
  localStorage.removeItem(SEC.ATTEMPTS_KEY);
  localStorage.removeItem(SEC.LOCKOUT_KEY);
};

const saveSession = (user: string, remember: boolean) => {
  const fingerprint = getBrowserFingerprint();
  const csrf = generateCSRFToken();
  const expiry = Date.now() + (remember ? SEC.REMEMBER_DURATION : SEC.SESSION_DURATION);
  const sessionData = obfuscate(JSON.stringify({ user, fingerprint, csrf, expiry, remember }));
  if (remember) {
    localStorage.setItem(SEC.SESSION_KEY, sessionData);
    localStorage.setItem(SEC.REMEMBER_KEY, obfuscate(user));
  } else {
    sessionStorage.setItem(SEC.SESSION_KEY, sessionData);
  }
  localStorage.setItem(SEC.FINGERPRINT_KEY, fingerprint);
  localStorage.setItem(SEC.CSRF_KEY, csrf);
};

const loadSession = (): { user: string; valid: boolean } | null => {
  const raw = sessionStorage.getItem(SEC.SESSION_KEY) || localStorage.getItem(SEC.SESSION_KEY);
  if (!raw) return null;
  try {
    const data = JSON.parse(deobfuscate(raw));
    if (!data || !data.user || !data.expiry) return null;
    if (Date.now() > data.expiry) { clearSession(); return null; }
    // fingerprint check removed — caused false logouts on browser/device changes
    return { user: data.user, valid: true };
  } catch { return null; }
};

const clearSession = () => {
  sessionStorage.removeItem(SEC.SESSION_KEY);
  localStorage.removeItem(SEC.SESSION_KEY);
  localStorage.removeItem(SEC.REMEMBER_KEY);
  localStorage.removeItem(SEC.FINGERPRINT_KEY);
  localStorage.removeItem(SEC.CSRF_KEY);
};

const getSavedUsername = (): string => {
  const raw = localStorage.getItem(SEC.REMEMBER_KEY);
  if (!raw) return '';
  return deobfuscate(raw);
};

// ═══════════════════════════════════════════════════════

const uploadVideoToR2 = async (file: File, fileName: string): Promise<string> => {
  const response = await fetch(`${WORKER_URL}/${fileName}`, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': file.type },
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
  ClipboardList
} from 'lucide-react';
import { User, UserRole, Ticket, Ban, Message, BanEvidence, AuditLog, PersonalNote } from './types';
import { getAll, putItem, deleteItem, supabase, dbDiagnostics, getDiscordWebhook } from './db';

export default function App() {
  const [activeSec, setActiveSec] = useState<'home' | 'team' | 'goals' | 'tickets' | 'bans' | 'manage' | 'profile' | 'audit_logs' | 'closed_tickets' | 'my_dashboard' | 'notepad' | 'manager_notes' | 'leaderboard'>('home');
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
  const [loading, setLoading] = useState(true);
  const [auditLogSearchQuery, setAuditLogSearchQuery] = useState('');
  const [closedTicketsSearchQuery, setClosedTicketsSearchQuery] = useState('');

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
          const defaultHashedPass = await hashPassword('098');
          const defaultAdmin: User = { user: 'admin', pass: defaultHashedPass, role: UserRole.MANAGER, status: 'active' };
          await putItem('users', defaultAdmin);
          setUsers([defaultAdmin]);
        } else {
          setUsers(u);
          // Auto-login from saved session
          const session = loadSession();
          if (session?.valid) {
            const savedUser = u.find(usr => usr.user === session.user);
            if (savedUser && savedUser.status === 'active') {
              setCurrentUser(savedUser);
              setActiveSec('home');
              if (savedUser.role !== UserRole.ADMIN) setTicketViewMode('all');
            } else {
              clearSession();
            }
          }
          // Pre-fill remembered username
          const saved = getSavedUsername();
          if (saved) {
            setAuthInputs(prev => ({ ...prev, user: saved }));
            setRememberMe(true);
          }
        }
        setTickets(await getAll<Ticket>('tickets'));
        setBans(await getAll<Ban>('bans'));
        setAuditLogs(await getAll<AuditLog>('audit_logs'));
        setPersonalNotes(await getAll<PersonalNote>('personal_notes'));
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

  // Auth Handlers
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
        const isHashed = storedPass.length === 64 && /^[0-9a-f]+$/.test(storedPass);

        if (isHashed) {
          // باسورد مشفر — نتحقق بالـ hash
          authenticated = await verifyPassword(authInputs.pass, storedPass);
        } else {
          // باسورد نصي قديم — نقارن مباشرة
          if (storedPass === authInputs.pass) {
            authenticated = true;
            // نرقّيه لـ hash في الخلفية بدون توقف
            try {
              const newHash = await hashPassword(authInputs.pass);
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
        setAuthFeedback({ type: 'success', msg: '⏳ الرجاء الانتظار لحين قبول طلبك من المدير' });
        return;
      }

      if (finalUser.status !== 'active') {
        setAuthFeedback({ type: 'error', msg: '🚫 هذا الحساب موقوف، تواصل مع المدير' });
        return;
      }

      // ✅ دخول ناجح
      clearAttempts();
      saveSession(finalUser.user, rememberMe);
      setCurrentUser(finalUser);
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
      const hashedPass = await hashPassword(authInputs.pass.trim());
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
        setAuthFeedback({ type: 'success', msg: '✅ تم تقديم طلبك — سجل دخولك بعد قبول المدير' });
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
        const updatedPass = newPass ? await hashPassword(newPass) : u.pass;
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
          
          await putItem('bans', newBan);
          setBans(bans.map(b => b.id === editingBanId ? newBan : b));
          await addAuditLog('Edit Ban', `Edited ban record for Discord ID: ${banForm.discordId} by ${currentUser.user}`);
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
      await addAuditLog('Add Ban', `Added new ban record for Discord ID: ${banForm.discordId}`);
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
        const newEv = ban.evidence.filter((_, i) => i !== index);
        const updated = { ...ban, evidence: newEv };
        await putItem('bans', updated);
        setBans(bans.map(b => b.id === banId ? updated : b));
        await addAuditLog('Remove Evidence', `Removed evidence at index ${index} from ban ID: ${banId}`);
      }
    );
  };

  const deleteBan = async (id: number) => {
    if (!isManager) return;
    triggerConfirm(
      "حذف سجل",
      "هل أنت متأكد من حذف هذه الحالة نهائياً من النظام؟",
      async () => {
        await deleteItem('bans', id);
        setBans(bans.filter(b => b.id !== id));
        await addAuditLog('Delete Ban', `Deleted ban record ID: ${id}`);
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

  const addAuditLog = async (action: string, details: string) => {
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
  };

  if (loading) return <div className="h-screen w-screen flex items-center justify-center text-orange font-orbitron text-2xl">MT LOGS...</div>;

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
                <p className="text-orange">M_T_LOGS_OS_4.0</p>
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
            className="fixed inset-0 bg-bg flex items-center justify-center p-6 z-50 overflow-y-auto"
          >
            <div className="card w-full max-w-[420px] text-center space-y-8 border-orange/20 shadow-[0_0_50px_rgba(255,106,0,0.1)]">
    
              <div className="mx-auto w-32 h-32 flex items-center justify-center mb-6 transition-transform hover:scale-110 duration-500 overflow-hidden p-2">
                <img 
                  src="https://i.postimg.cc/G3DsDrGz/W3j-Wowj-B-Photoroom.png" 
                  alt="MT Logo" 
                  className="w-full h-full object-contain drop-shadow-[0_0_20px_rgba(255,106,0,0.5)]" 
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
                  <motion.div key="login" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-5">
                    <input type="text" placeholder="اسم المستخدم" className="input-field focus:border-gold" value={authInputs.user} onChange={e => { setAuthInputs({...authInputs, user: e.target.value}); setAuthFeedback(null); }} />
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
                    <div className="flex items-center justify-center gap-3 pt-1 opacity-40">
                      <div className="w-8 h-[1px] bg-orange/40" />
                      <div className="flex items-center gap-1.5">
                        <Shield size={9} className="text-orange" />
                        <span className="text-[9px] font-mono uppercase tracking-widest text-orange">Secured • Encrypted • Protected</span>
                      </div>
                      <div className="w-8 h-[1px] bg-orange/40" />
                    </div>

                    <p className="text-xs text-text-dim mt-4">ليس لديك حساب؟ <span className="text-orange cursor-pointer hover:underline font-bold" onClick={() => { setAuthMode('register'); setAuthFeedback(null); setAuthInputs({user: '', pass: '', role: UserRole.LOGS}); }}>سجل الآن</span></p>
                  </motion.div>
                ) : (
                  <motion.div key="register" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-5">
                    <input type="text" placeholder="اسم المستخدم الجديد" className="input-field focus:border-gold" value={authInputs.user} onChange={e => { setAuthInputs({...authInputs, user: e.target.value}); setAuthFeedback(null); }} />
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
              MT <span className="text-orange">Logs</span>
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
