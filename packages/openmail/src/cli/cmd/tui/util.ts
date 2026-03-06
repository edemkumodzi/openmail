export function formatRelativeTime(date: Date): string {
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const minutes = Math.floor(diff / 60_000)
  const hours = Math.floor(diff / 3_600_000)
  const days = Math.floor(diff / 86_400_000)

  if (minutes < 0) {
    const futureMinutes = Math.abs(minutes)
    if (futureMinutes < 60) return `in ${futureMinutes}m`
    const futureHours = Math.floor(futureMinutes / 60)
    return `in ${futureHours}h`
  }
  if (minutes < 1) return "now"
  if (minutes < 60) return `${minutes}m`
  if (hours < 24) return `${hours}h`
  if (days < 7) return `${days}d`
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

export function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
}

export function formatDuration(start: Date, end: Date): string {
  const diff = end.getTime() - start.getTime()
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  if (remainingMinutes === 0) return `${hours}h`
  return `${hours}h${remainingMinutes}m`
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1_048_576).toFixed(1)} MB`
}

export function formatDayLabel(date: Date): string {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const diff = target.getTime() - today.getTime()
  const days = Math.round(diff / 86_400_000)

  if (days === 0) return "Today"
  if (days === 1) return "Tomorrow"
  if (days === -1) return "Yesterday"
  if (days > 1 && days < 7) return date.toLocaleDateString("en-US", { weekday: "long" })
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
}

export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str
  return str.slice(0, maxLength - 1) + "\u2026"
}

export function groupEventsByDay<T extends { start: Date }>(events: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const event of events) {
    const key = event.start.toDateString()
    const list = groups.get(key) ?? []
    list.push(event)
    groups.set(key, list)
  }
  return groups
}
