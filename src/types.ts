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
