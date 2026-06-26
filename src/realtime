// ═══════════════════════════════════════════════════════
//  realtime.ts — Realtime عبر Broadcast
//  يستمع على events اللي Edge Function تبعثها بعد كل تعديل
//  anon key يكفي هنا — Broadcast لا يحتاج RLS مفتوح
// ═══════════════════════════════════════════════════════
import { createClient, RealtimeChannel } from '@supabase/supabase-js';

// ── client مخصص للـ Realtime فقط (anon key) ──
const realtimeClient = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  {
    realtime: { params: { eventsPerSecond: 10 } },
    auth: { persistSession: false },
  }
);

// ── أنواع ──
export type DbTable =
  | 'users' | 'tickets' | 'bans' | 'audit_logs' | 'personal_notes'
  | 'cases' | 'evidence_items' | 'alt_profiles' | 'yara_rules'
  | 'pc_checks' | 'pre_wl_hacks' | 'reports';

export type DbAction = 'insert' | 'upsert' | 'update' | 'delete';

export interface DbChangeEvent {
  table: DbTable;
  action: DbAction;
  data: any | null;   // البيانات الجديدة (null عند delete)
  actor: string;      // اسم المستخدم اللي نفّذ العملية
  ts: string;         // ISO timestamp
}

type EventKey = `${DbTable}:${DbAction}` | `${DbTable}:*` | '*';
type Handler = (event: DbChangeEvent) => void;

// ═══════════════════════════════════════════════════════
//  RealtimeManager — singleton يدير الاشتراك كله
// ═══════════════════════════════════════════════════════
class RealtimeManager {
  private channel: RealtimeChannel | null = null;
  private handlers = new Map<string, Set<Handler>>();
  private status: 'disconnected' | 'connecting' | 'connected' | 'error' = 'disconnected';
  private statusListeners = new Set<(s: typeof this.status) => void>();

  /** الاتصال — استدعيه مرة وحدة عند تسجيل الدخول */
  connect() {
    if (this.channel) return;

    this.setStatus('connecting');

    this.channel = realtimeClient
      .channel('db-changes')
.on('broadcast', { event: '*' }, ({ event, payload }) => {
  console.log('REALTIME RECEIVED', event, payload);
  this.dispatch(event, payload as DbChangeEvent);
})
      .subscribe((status) => {
        if (status === 'SUBSCRIBED')         this.setStatus('connected');
        else if (status === 'CLOSED')        this.setStatus('disconnected');
        else if (status === 'CHANNEL_ERROR') this.setStatus('error');
      });
  }

  /** قطع الاتصال — عند تسجيل الخروج */
  disconnect() {
    if (!this.channel) return;
    realtimeClient.removeChannel(this.channel);
    this.channel = null;
    this.handlers.clear();
    this.setStatus('disconnected');
  }

  /**
   * الاشتراك في event معين
   * @param key  مثال: 'tickets:insert' | 'bans:*' | '*'
   * @returns دالة إلغاء الاشتراك
   */
  on(key: EventKey, handler: Handler): () => void {
    if (!this.handlers.has(key)) this.handlers.set(key, new Set());
    this.handlers.get(key)!.add(handler);
    return () => this.handlers.get(key)?.delete(handler);
  }

  /** مراقبة حالة الاتصال */
  onStatusChange(listener: (s: typeof this.status) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.status); // أرسل الحالة الحالية فوراً
    return () => this.statusListeners.delete(listener);
  }

  getStatus() { return this.status; }

  // ── داخلي ──
  private dispatch(event: string, payload: DbChangeEvent) {
    // 'tickets:insert' → نفّذ handlers لـ 'tickets:insert' + 'tickets:*' + '*'
    const [table] = event.split(':');
    const keys = [event, `${table}:*`, '*'];
    for (const k of keys) {
      this.handlers.get(k)?.forEach(h => {
        try { h(payload); } catch (e) { console.error('[Realtime] handler error:', e); }
      });
    }
  }

  private setStatus(s: typeof this.status) {
    this.status = s;
    this.statusListeners.forEach(l => l(s));
  }
}

export const realtime = new RealtimeManager();
