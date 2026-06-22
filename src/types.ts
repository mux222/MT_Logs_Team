export enum UserRole {
  MANAGER = 'manager',
  LOGS = 'logs',
  ADMIN = 'admin',
}

export interface User {
  user: string;
  pass: string;
  role: UserRole;
  status: 'pending' | 'active';
}

export interface AuditLog {
  id: number;
  userId: string;
  userName: string;
  action: string;
  details: string;
  timestamp: number;
}

export interface Message {
  sender: 'admin' | 'logs' | 'system';
  senderName: string;
  type: 'text' | 'image' | 'video';
  text?: string;
  url?: string;
  timestamp: number;
}

export interface Ticket {
  id: number;
  subject: string;
  creator: string;
  category: 'logs' | 'manager';
  status: 'open' | 'working' | 'done';
  createdAt: string;
  closedAt?: number;
  assignedTo?: string;
  closedBy?: string;
  msgs: Message[];
}

export interface BanEvidence {
  type: 'image' | 'video';
  url: string;
  name: string;
}

export interface Ban {
  id: number;
  discordId: string;
  type: 'Ban' | 'Hack' | 'Glitch';
  reason: string;
  identifiers: string;
  bannedBy: string;
  evidence: BanEvidence[];
  createdAt: number;
  updatedAt?: number;
  updatedBy?: string;
  notes?: string;
}

export interface PersonalNote {
  id: number;
  userId: string;
  title: string;
  content: string;
  category: string;
  isPinned: boolean;
  createdAt: number;
  updatedAt: number;
}

// ═══════════════════════════════════════════════════════
//  INVESTIGATION SYSTEM — Cases, Evidence, Timeline
// ═══════════════════════════════════════════════════════

export type CaseStatus = 'open' | 'investigating' | 'pending_review' | 'closed_banned' | 'closed_cleared';
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface CaseEvent {
  id: number;
  type: 'created' | 'note' | 'evidence_added' | 'evidence_removed' | 'status_change' | 'risk_change' | 'linked_ban' | 'assigned' | 'reopened';
  text: string;
  by: string;
  timestamp: number;
}

export interface InvestigationCase {
  id: number;
  discordId: string;
  playerName?: string;
  title: string;
  status: CaseStatus;
  riskLevel: RiskLevel;
  riskScore: number; // 0-100
  summary: string;
  suggestedAction?: string;
  assignedTo?: string;
  linkedBanId?: number | string | null;
  evidenceIds: number[];
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  timeline: CaseEvent[];
}

export type EvidenceCategory = 'cheat_video' | 'screenshot' | 'chat_log' | 'report' | 'witness' | 'other';

export interface EvidenceItem {
  id: number;
  caseId?: number | null;
  discordId?: string;
  type: 'image' | 'video' | 'text' | 'link';
  url?: string;
  text?: string;
  name?: string;
  category: EvidenceCategory;
  tags: string[];
  addedBy: string;
  createdAt: number;
}

// ═══════════════════════════════════════════════════════
//  INTELLIGENCE ROOM — Alt Account Linking (Quick ID tracker)
// ═══════════════════════════════════════════════════════

export interface AltProfile {
  id: number;
  primaryId: string;
  primaryName?: string;
  linkedIds: string[];
  notes?: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

// ═══════════════════════════════════════════════════════
//  YARA RULES — Detection & Analysis Rules
// ═══════════════════════════════════════════════════════

export interface YaraRule {
  id: number;
  name: string;
  description: string;
  rule: string;
  tags: string[];
  addedBy: string;
  createdAt: number;
  updatedAt: number;
}

// ═══════════════════════════════════════════════════════
//  PC-CHECK — Hardware Fingerprint (HWID) Check Records
// ═══════════════════════════════════════════════════════

export interface PCCheckRecord {
  id: number;
  player: string;
  isCheater: boolean;
  pin: string;
  hwid: string;
  notes?: string;
  checkedBy: string;
  createdAt: number;
  updatedAt: number;
}
