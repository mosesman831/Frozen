// Mirrors frozen-common proto.rs shapes (snake_case over the pipe).

export type RuleKind =
  | 'domain' | 'wildcard' | 'url' | 'keyword' | 'regex'
  | 'path' | 'title' | 'app' | 'folder' | 'yt_channel'

export interface Rule {
  kind: RuleKind
  value: string
  negated: boolean
}

export type Lock =
  | { type: 'none' }
  | { type: 'timer'; until: number }
  | { type: 'range'; start_hm: string; end_hm: string }
  | { type: 'password'; hash?: string }
  | { type: 'random_text'; len: number; perfect: boolean; hash?: string }
  | { type: 'restart' }
  | { type: 'allowance'; seconds: number }
  | { type: 'enforced' }
  | { type: 'frozen' }

export interface BlockInfo {
  id: string
  name: string
  enabled: boolean
  allow_mode: boolean
  block_all_internet: boolean
  rules: Rule[]
  exceptions?: string[]
  schedule_kind?: string
  schedule_grid?: number[]
  schedule_start?: string
  schedule_end?: string
  lock: Lock
  allowance_seconds?: number
  allowance_remaining?: number
  pomodoro_phase?: string | null
  force_close?: boolean
  active: boolean
  break_until?: number | null
}

export interface Flags {
  stats_enabled?: boolean
  paused?: boolean | number
  paused_until?: number
  pomodoro_phase?: string | null
  pomodoro_remaining_s?: number
  frozen_until?: number | null
  frozen_locked?: boolean
  [k: string]: unknown
}

export interface BlockListInfo {
  rev: number
  blocks: BlockInfo[]
  flags: Flags
}

export interface BridgeStatus {
  connected: boolean
  detail?: string
}

export interface AuditEntry {
  ts: number
  actor: string
  action: string
  detail: string
}
