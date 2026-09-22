export type InstitutionType = 'school' | 'institute' | 'education_center'
export type InstitutionStatus = 'active' | 'disabled' | 'suspended'
export type ConnectionStatus = 'connected' | 'delayed' | 'offline'
export type HeartbeatStatus = 'ok' | 'warning' | 'error' | 'maintenance'
export type NotificationType = 'info' | 'warning' | 'error' | 'success' | 'security'
export type TicketPriority = 'low' | 'medium' | 'high' | 'critical'
export type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed'
export type SettingsCategory = 'general' | 'security' | 'notifications' | 'api' | 'connection' | 'appearance' | 'localization' | 'system'
export type RoleName = 'super_admin' | 'central_admin' | 'support' | 'developer' | 'viewer'
export type AgentMode = 'read_only' | 'analyze' | 'fix_with_approval' | 'full_development' | 'emergency'
export type AgentSessionStatus = 'idle' | 'connecting' | 'analyzing' | 'working' | 'testing' | 'waiting_approval' | 'deploying' | 'completed' | 'failed' | 'stopped'
export type AgentTaskStatus = 'pending' | 'analyzing' | 'running' | 'waiting_approval' | 'completed' | 'failed' | 'cancelled'
export type TokenStatus = 'active' | 'revoked' | 'expired' | 'rotated'
export type ProjectEnvironment = 'development' | 'staging' | 'production'
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired'
export type DeploymentStatus = 'pending' | 'deploying' | 'successful' | 'failed' | 'rolled_back'
export type SecurityEventSeverity = 'low' | 'medium' | 'high' | 'critical'

export interface Project {
  id: string
  institution_id: string
  name: string
  description: string | null
  repository_url: string | null
  environment: ProjectEnvironment
  root_path: string
  agent_status: 'connected' | 'disconnected' | 'connecting' | 'error'
  last_agent_connection_at: string | null
  last_agent_run_at: string | null
  last_deployment_at: string | null
  build_status: string | null
  test_status: string | null
  health_status: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface AccessToken {
  id: string
  project_id: string
  institution_id: string
  name: string
  token_hash: string
  token_prefix: string
  scopes: string[]
  environment: string
  status: TokenStatus
  created_by: string | null
  expires_at: string | null
  last_used_at: string | null
  last_ip: string | null
  rotated_from: string | null
  created_at: string
  updated_at: string
}

export interface AgentSession {
  id: string
  user_id: string
  institution_id: string
  project_id: string
  token_id: string | null
  mode: AgentMode
  status: AgentSessionStatus
  permissions: Record<string, unknown>
  started_at: string
  ended_at: string | null
  created_at: string
}

export interface AgentTask {
  id: string
  session_id: string
  project_id: string
  title: string
  description: string | null
  status: AgentTaskStatus
  priority: TicketPriority
  result: Record<string, unknown> | null
  error: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
}

export interface AgentRun {
  id: string
  session_id: string
  task_id: string | null
  project_id: string
  user_id: string
  started_at: string
  ended_at: string | null
  status: 'running' | 'completed' | 'failed' | 'stopped'
  actions: Record<string, unknown>[]
  commands: Record<string, unknown>[]
  files_changed: Record<string, unknown>[]
  tests_run: boolean
  tests_passed: boolean | null
  result: string | null
  error: string | null
  created_at: string
}

export interface AgentApproval {
  id: string
  session_id: string
  run_id: string | null
  user_id: string
  action_type: 'file_delete' | 'file_modify' | 'command_execute' | 'deploy' | 'database_write' | 'config_change' | 'git_push' | 'git_reset'
  description: string
  risk_level: 'low' | 'medium' | 'high' | 'critical'
  files_affected: string[]
  commands: string[]
  status: ApprovalStatus
  reviewed_by: string | null
  reviewed_at: string | null
  created_at: string
}

export interface DeploymentRecord {
  id: string
  project_id: string
  institution_id: string
  run_id: string | null
  version: string | null
  previous_version: string | null
  status: DeploymentStatus
  environment: string
  health_check_passed: boolean | null
  health_check_details: Record<string, unknown> | null
  rollback_id: string | null
  rollback_reason: string | null
  deployed_by: string | null
  deployed_at: string | null
  created_at: string
}

export interface SecurityEvent {
  id: string
  event_type: string
  severity: SecurityEventSeverity
  institution_id: string | null
  project_id: string | null
  user_id: string | null
  description: string
  metadata: Record<string, unknown>
  ip_address: string | null
  is_resolved: boolean
  resolved_at: string | null
  created_at: string
}

export interface Institution {
  id: string
  institution_id: string
  tenant_id: string
  system_id: string
  name: string
  name_ar: string | null
  type: InstitutionType
  system_name: string | null
  domain: string | null
  logo_url: string | null
  image_url: string | null
  governorate: string | null
  city: string | null
  address: string | null
  contact_email: string | null
  contact_phone: string | null
  notes: string | null
  status: InstitutionStatus
  is_favorite: boolean
  student_count: number
  teacher_count: number
  last_heartbeat_at: string | null
  last_sync_at: string | null
  system_version: string | null
  connection_status: ConnectionStatus
  created_at: string
  updated_at: string
}

export interface InstitutionAdmin {
  id: string
  institution_id: string
  name: string
  email: string | null
  phone: string | null
  role: string
  is_primary: boolean
  created_at: string
  updated_at: string
}

export interface SystemConnection {
  id: string
  institution_id: string
  connection_type: string
  endpoint_url: string | null
  status: string
  last_test_at: string | null
  last_test_result: string | null
  last_test_success: boolean | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface Heartbeat {
  id: string
  institution_id: string
  system_id: string
  system_version: string | null
  status: HeartbeatStatus
  payload: Record<string, unknown>
  received_at: string
}

export interface SystemVersion {
  id: string
  institution_id: string
  version: string
  release_date: string | null
  is_current: boolean
  notes: string | null
  changelog: string | null
  created_at: string
}

export interface Notification {
  id: string
  user_id: string | null
  institution_id: string | null
  type: NotificationType
  title: string
  title_ar: string | null
  message: string | null
  message_ar: string | null
  is_read: boolean
  metadata: Record<string, unknown>
  created_at: string
}

export interface AuditLog {
  id: string
  user_id: string | null
  action: string
  resource: string | null
  resource_id: string | null
  institution_id: string | null
  ip_address: string | null
  user_agent: string | null
  metadata: Record<string, unknown>
  created_at: string
}

export interface ActivityLog {
  id: string
  user_id: string | null
  action: string
  resource: string | null
  resource_id: string | null
  institution_id: string | null
  details: string | null
  metadata: Record<string, unknown>
  created_at: string
}

export interface SystemSetting {
  id: string
  key: string
  value: string | null
  value_json: string | null
  category: SettingsCategory
  description: string | null
  is_public: boolean
  created_at: string
  updated_at: string
}

export interface SupportTicket {
  id: string
  ticket_number: string
  institution_id: string | null
  created_by: string
  subject: string
  description: string | null
  priority: TicketPriority
  status: TicketStatus
  assigned_to: string | null
  resolved_at: string | null
  created_at: string
  updated_at: string
}

export interface SupportTicketComment {
  id: string
  ticket_id: string
  user_id: string
  comment: string
  is_internal: boolean
  created_at: string
}

export interface Role {
  id: string
  name: string
  name_ar: string
  description: string | null
  is_system_role: boolean
  created_at: string
  updated_at: string
}

export interface Permission {
  id: string
  code: string
  name: string
  name_ar: string
  description: string | null
  category: string
  created_at: string
}

export interface UserProfile {
  id: string
  user_id: string
  full_name: string | null
  full_name_ar: string | null
  avatar_url: string | null
  phone: string | null
  is_active: boolean
  last_login_at: string | null
  created_at: string
  updated_at: string
}

export interface UserWithRoles extends UserProfile {
  email?: string
  roles: Role[]
}
