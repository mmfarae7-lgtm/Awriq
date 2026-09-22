import type { ConnectionStatus, InstitutionType } from '../types'

export function formatRelativeTime(dateString: string | null): string {
  if (!dateString) return '—'
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMinutes = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMinutes < 1) return 'منذ لحظات'
  if (diffMinutes < 60) return `منذ ${diffMinutes} دقيقة`
  if (diffHours < 24) return `منذ ${diffHours} ساعة`
  if (diffDays < 30) return `منذ ${diffDays} يوم`
  return date.toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' })
}

export function getConnectionStatusInfo(status: ConnectionStatus): {
  label: string
  color: string
  dotColor: string
} {
  switch (status) {
    case 'connected':
      return { label: 'متصل', color: '#4F8A5B', dotColor: '#4F8A5B' }
    case 'delayed':
      return { label: 'متأخر', color: '#C58A3A', dotColor: '#C58A3A' }
    case 'offline':
      return { label: 'غير متصل', color: '#C94B4B', dotColor: '#C94B4B' }
    default:
      return { label: 'غير معروف', color: '#68727A', dotColor: '#68727A' }
  }
}

export function getInstitutionTypeLabel(type: InstitutionType): string {
  switch (type) {
    case 'school': return 'مدرسة'
    case 'institute': return 'معهد'
    case 'education_center': return 'مركز تعليمي'
    default: return type
  }
}

export function getInstitutionTypeIcon(type: InstitutionType): string {
  switch (type) {
    case 'school': return 'school'
    case 'institute': return 'building'
    case 'education_center': return 'book-open'
    default: return 'building'
  }
}

export function formatNumber(num: number): string {
  return num.toLocaleString('ar-EG')
}

export function formatDate(dateString: string | null): string {
  if (!dateString) return '—'
  return new Date(dateString).toLocaleDateString('ar-EG', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.substring(0, maxLength) + '...'
}

export function generateSystemId(type: InstitutionType, sequence: number): string {
  const prefix = type === 'school' ? 'SCH' : type === 'institute' ? 'INS' : 'EDU'
  return `${prefix}-${String(sequence).padStart(6, '0')}`
}

export function generateTicketNumber(): string {
  const year = new Date().getFullYear()
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0')
  return `TKT-${year}-${random}`
}
