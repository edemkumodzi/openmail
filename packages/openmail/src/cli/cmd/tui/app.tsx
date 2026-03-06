import { createMemo, createSignal, createEffect, on, onMount, onCleanup, Show, Switch, Match } from "solid-js"
import { createStore } from "solid-js/store"
import { useKeyboard, useTerminalDimensions, useRenderer } from "@opentui/solid"
import { TextAttributes } from "@opentui/core"
import { exec } from "child_process"
import { Mail } from "../../../mail/types.js"
import { MockData } from "../../../mail/mock.js"
import { MailClient } from "../../../client/index.js"
import { createTheme } from "./theme.js"
import { SettingsManager } from "./settings.js"
import { EmptyBorder } from "./component/border.js"
import { Sidebar } from "./component/sidebar.js"
import { ThreadList } from "./component/thread-list.js"
import { ThreadView, type ThreadViewHandle } from "./component/thread-view.js"
import { CalendarSidebar } from "./component/calendar-sidebar.js"
import { KeybindBar, type KeyHint } from "./component/keybind-bar.js"
import { SettingsView, getSettingItems, cycleSettingValue } from "./component/settings.js"
import { SearchView, searchThreads } from "./component/search.js"
import { ComposeView, nextField, prevField, COMPOSE_FIELDS, type ComposeField, type ComposeState } from "./component/compose.js"
import { LinksPopup } from "./component/links-popup.js"

type View = "inbox" | "thread" | "settings" | "search" | "compose"
type Focus = "threads" | "sidebar"

interface AppState {
  view: View
  previousView: View
  focus: Focus
  activeFolder: string
  activeLabel: string | null
  selectedSidebarIndex: number
  selectedThreadIndex: number
  activeThread: Mail.ThreadDetail | null
  showCalendar: boolean
  settingsSelectedIndex: number
  searchQuery: string
  searchSelectedIndex: number
  searchTyping: boolean
  composeTo: string
  composeSubject: string
  composeBody: string
  composeField: ComposeField
  selectedMessageIndex: number
  showLinksPopup: boolean
  linksPopupSelectedIndex: number
}

export function App() {
  const dimensions = useTerminalDimensions()
  const renderer = useRenderer()
  const theme = createTheme()

  const [state, setState] = createStore<AppState>({
    view: "inbox",
    previousView: "inbox",
    focus: "threads",
    activeFolder: "folder:INBOX",
    activeLabel: null,
    selectedSidebarIndex: 0,
    selectedThreadIndex: 0,
    activeThread: null,
    showCalendar: true, // legacy — no longer toggled, calendar auto-shows when space permits
    settingsSelectedIndex: 0,
    searchQuery: "",
    searchSelectedIndex: 0,
    searchTyping: true,
    composeTo: "",
    composeSubject: "",
    composeBody: "",
    composeField: "to",
    selectedMessageIndex: 0,
    showLinksPopup: false,
    linksPopupSelectedIndex: 0,
  })

  // Data sources — populated from server or fallback to mock data
  const [allThreads, setAllThreads] = createSignal<Mail.ThreadSummary[]>(MockData.threads)
  const [folders, setFolders] = createSignal<Mail.Folder[]>(MockData.folders)
  const [labels, setLabels] = createSignal<Mail.Label[]>(MockData.labels)
  const [events, setEvents] = createSignal<Mail.CalEvent[]>(MockData.events)
  let threadViewHandle: ThreadViewHandle | undefined

  const [serverConnected, setServerConnected] = createSignal(false)
  const [syncStatus, setSyncStatus] = createSignal<"synced" | "syncing" | "offline" | "error">("offline")
  const [accountEmail, setAccountEmail] = createSignal(MockData.me.email)

  // Fetch threads from server with current folder/label filter
  const fetchThreads = async () => {
    if (!serverConnected()) return
    try {
      const opts: { folderId?: string; labelId?: string } = {}
      // When filtering by label, don't also filter by folder (show label across all folders)
      if (state.activeLabel) {
        opts.labelId = state.activeLabel
      } else if (state.activeFolder) {
        opts.folderId = state.activeFolder
      }
      const result = await MailClient.listThreads(opts)
      setAllThreads(result.items)
    } catch {
      // keep current data on error
    }
  }

  // Try to connect to server and load data
  onMount(async () => {
    try {
      const port = (globalThis as any).__openmail_server_port ?? 4580
      const bootEmail = (globalThis as any).__openmail_account_email
      if (bootEmail) setAccountEmail(bootEmail)

      MailClient.init({ baseUrl: `http://localhost:${port}` })
      const ok = await MailClient.health()

      if (ok) {
        setServerConnected(true)
        setSyncStatus("synced")

        // Load folders, labels, accounts, and threads for active folder
        const [folderResult, labelResult, accounts] = await Promise.all([
          MailClient.listFolders().catch(() => null),
          MailClient.listLabels().catch(() => null),
          MailClient.listAccounts().catch(() => null),
        ])

        if (folderResult && folderResult.length > 0) setFolders(folderResult)
        if (labelResult && labelResult.length > 0) setLabels(labelResult)
        if (accounts && accounts.length > 0) setAccountEmail(accounts[0].email)

        // Fetch threads for the default active folder
        await fetchThreads()

        // Subscribe to SSE for real-time updates
        const unsubscribe = MailClient.subscribe((event) => {
          // Re-fetch threads on relevant events
          if (event.type.startsWith("thread.") || event.type.startsWith("message.") || event.type === "sync.completed") {
            fetchThreads()
          }
          if (event.type.startsWith("folder.") || event.type === "sync.completed") {
            MailClient.listFolders().then((r) => setFolders(r)).catch(() => {})
          }
          if (event.type.startsWith("label.") || event.type === "sync.completed") {
            MailClient.listLabels().then((r) => setLabels(r)).catch(() => {})
          }
          if (event.type.startsWith("sync.")) {
            if (event.type === "sync.started") setSyncStatus("syncing")
            else if (event.type === "sync.completed") setSyncStatus("synced")
            else if (event.type === "sync.error") setSyncStatus("error")
          }
        })

        onCleanup(() => {
          unsubscribe()
          MailClient.disconnect()
        })
      }
    } catch {
      // Server not available — stay on mock data
    }
  })

  // Re-fetch threads when folder or label filter changes
  createEffect(on(
    () => [state.activeFolder, state.activeLabel],
    () => { fetchThreads() },
    { defer: true }
  ))

  // Sidebar items: folders + labels as one navigable list
  // The "Labels" header row is skipped during navigation
  const sidebarItemCount = () => folders().length + labels().length
  const labelStartIndex = () => folders().length

  const isFolderIndex = (idx: number) => idx < folders().length
  const labelIndexToLabel = (idx: number) => labels()[idx - labelStartIndex()]

  // Threads are already filtered server-side by active folder/label
  const threads = () => allThreads()

  const settings = () => SettingsManager.get()
  // Responsive layout: auto-collapse panels if terminal is too narrow
  const MIN_EMAIL_WIDTH = 30
  const CHROME_WIDTH = 4 // 1 left margin + 1 right margin + 2 gaps between panels
  const sidebarWidth = () => {
    const sw = settings().sidebarWidth
    // If even sidebar + min email doesn't fit, clamp sidebar
    const maxSidebar = Math.max(10, dimensions().width - CHROME_WIDTH - MIN_EMAIL_WIDTH)
    return Math.min(sw, maxSidebar)
  }
  const calendarVisible = () => {
    // Auto-hide calendar if terminal too narrow for all 3 panels
    const remaining = dimensions().width - CHROME_WIDTH - sidebarWidth() - settings().calendarWidth
    return remaining >= MIN_EMAIL_WIDTH
  }
  const calendarWidth = () => (calendarVisible() ? settings().calendarWidth : 0)
  const emailPanelWidth = () => Math.max(MIN_EMAIL_WIDTH, dimensions().width - sidebarWidth() - calendarWidth() - CHROME_WIDTH)

  const activeThreadId = () => {
    if (state.previousView === "thread" && state.activeThread) return state.activeThread.id
    const selected = threads()[state.selectedThreadIndex]
    return selected?.id
  }

  const openThread = async (thread: Mail.ThreadSummary) => {
    // Try server first, then fall back to mock
    if (serverConnected()) {
      const detail = await MailClient.getThread(thread.id)
      if (detail) {
        setState({ view: "thread", previousView: state.view === "search" ? "search" : "thread", activeThread: detail, selectedMessageIndex: 0 })
        // Auto-mark as read when opening
        if (thread.unread) markThreadRead(thread.id)
        return
      }
    }
    // Fallback to mock data
    const detail = MockData.threadDetails[thread.id]
    if (detail) {
      setState({ view: "thread", previousView: state.view === "search" ? "search" : "thread", activeThread: detail, selectedMessageIndex: 0 })
    }
  }

  const goBack = () => {
    if (state.previousView === "search") {
      setState({ view: "search", activeThread: null, searchTyping: false })
    } else {
      setState({ view: "inbox", previousView: "inbox", activeThread: null })
    }
  }

  const selectSidebarItem = (index: number) => {
    if (isFolderIndex(index)) {
      const folder = folders()[index]
      if (folder) {
        setState({
          activeFolder: folder.id,
          activeLabel: null,
          selectedSidebarIndex: index,
          selectedThreadIndex: 0,
        })
      }
    } else {
      const label = labelIndexToLabel(index)
      if (label) {
        setState({
          activeLabel: label.id,
          selectedSidebarIndex: index,
          selectedThreadIndex: 0,
        })
      }
    }
  }

  const openSettings = () => {
    setState({ view: "settings", settingsSelectedIndex: 0 })
  }

  const closeSettings = () => {
    setState("view", state.previousView === "settings" ? "inbox" : state.previousView)
  }

  const openSearch = () => {
    setState({ view: "search", searchQuery: "", searchSelectedIndex: 0, searchTyping: true })
  }

  const closeSearch = () => {
    setState({ view: "inbox", searchQuery: "", searchSelectedIndex: 0, searchTyping: true })
  }

  const openCompose = () => {
    setState({
      view: "compose",
      composeTo: "",
      composeSubject: "",
      composeBody: "",
      composeField: "to",
    })
  }

  const closeCompose = () => {
    setState("view", state.previousView === "compose" ? "inbox" : state.previousView)
  }

  const exitApp = () => {
    renderer.destroy()
    const exit = (globalThis as any).__openmail_exit
    if (exit) exit()
  }

  // Links popup helpers
  const currentMessageLinks = (): Mail.ExtractedLink[] => {
    if (!state.activeThread) return []
    const msg = state.activeThread.messages[state.selectedMessageIndex]
    return msg?.body.links ?? []
  }

  const openLinksPopup = () => {
    const links = currentMessageLinks()
    if (links.length === 0) return
    setState({ showLinksPopup: true, linksPopupSelectedIndex: 0 })
  }

  const closeLinksPopup = () => {
    setState({ showLinksPopup: false, linksPopupSelectedIndex: 0 })
  }

  const openUrlInBrowser = (url: string) => {
    // Use platform-appropriate command to open URL
    const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open"
    exec(`${cmd} "${url}"`)
  }

  // --- Actions ---
  // Each action optimistically updates local state, then fires server call in background.
  // On SSE event (thread.updated), fetchThreads() re-syncs from cache.

  const archiveThread = (threadId: string) => {
    // Optimistic: remove from current view
    setAllThreads((prev) => prev.filter((t) => t.id !== threadId))
    // Adjust selection if we removed the last item
    setState("selectedThreadIndex", Math.min(state.selectedThreadIndex, Math.max(0, threads().length - 1)))
    // Fire and forget
    if (serverConnected()) MailClient.archiveThread(threadId).catch(() => fetchThreads())
  }

  const trashThread = (threadId: string) => {
    setAllThreads((prev) => prev.filter((t) => t.id !== threadId))
    setState("selectedThreadIndex", Math.min(state.selectedThreadIndex, Math.max(0, threads().length - 1)))
    if (serverConnected()) MailClient.trashThread(threadId).catch(() => fetchThreads())
  }

  const toggleStar = (threadId: string) => {
    const thread = threads().find((t) => t.id === threadId)
    if (!thread) return
    const newStarred = !thread.starred
    // Optimistic: toggle starred state in local data
    setAllThreads((prev) => prev.map((t) => t.id === threadId ? { ...t, starred: newStarred } : t))
    if (serverConnected()) {
      const call = newStarred ? MailClient.starThread(threadId) : MailClient.unstarThread(threadId)
      call.catch(() => fetchThreads())
    }
  }

  const toggleUnread = (threadId: string) => {
    const thread = threads().find((t) => t.id === threadId)
    if (!thread) return
    const newUnread = !thread.unread
    setAllThreads((prev) => prev.map((t) => t.id === threadId ? { ...t, unread: newUnread } : t))
    if (serverConnected()) {
      const call = newUnread ? MailClient.markUnread(threadId) : MailClient.markRead(threadId)
      call.catch(() => fetchThreads())
    }
  }

  const markThreadRead = (threadId: string) => {
    setAllThreads((prev) => prev.map((t) => t.id === threadId ? { ...t, unread: false } : t))
    if (serverConnected()) MailClient.markRead(threadId).catch(() => {})
  }

  const keybindHints = createMemo((): KeyHint[] => {
    if (state.view === "settings") {
      return [
        { key: "j/k", label: "navigate" },
        { key: "h/l", label: "adjust" },
        { key: "esc", label: "close" },
      ]
    }
    if (state.view === "compose") {
      return [
        { key: "tab", label: "next field" },
        { key: "ctrl+s", label: "send" },
        { key: "esc", label: "discard" },
      ]
    }
    if (state.view === "search") {
      if (state.searchTyping) {
        return [
          { key: "enter", label: "navigate results" },
          { key: "esc", label: "close" },
        ]
      }
      return [
        { key: "j/k", label: "navigate" },
        { key: "enter", label: "open" },
        { key: "/", label: "edit query" },
        { key: "esc", label: "close" },
      ]
    }
    if (state.view === "thread" && state.showLinksPopup) {
      return [
        { key: "j/k", label: "navigate" },
        { key: "enter", label: "open in browser" },
        { key: "esc", label: "close" },
      ]
    }
    if (state.view === "thread") {
      return [
        { key: "j/k", label: "scroll" },
        { key: "J/K", label: "next/prev msg" },
        { key: "l", label: "links" },
        { key: "r", label: "reply" },
        { key: "a", label: "archive" },
        { key: "d", label: "trash" },
        { key: "s", label: "star" },
        { key: "u", label: "unread" },
        { key: "q", label: "back" },
      ]
    }
    if (state.focus === "sidebar") {
      return [
        { key: "j/k", label: "navigate" },
        { key: "enter", label: "select" },
        { key: "tab", label: "threads" },
      ]
    }
    const hints: KeyHint[] = [
      { key: "j/k", label: "navigate" },
      { key: "enter", label: "open" },
      { key: "tab", label: "sidebar" },
    ]
    if (state.activeLabel) {
      hints.push({ key: "esc", label: "clear filter" })
    }
    hints.push(
      { key: "a", label: "archive" },
      { key: "d", label: "trash" },
      { key: "s", label: "star" },
      { key: "u", label: "unread" },
      { key: "/", label: "search" },
      { key: "c", label: "compose" },
      { key: ",", label: "settings" },
    )
    return hints
  })

  useKeyboard((evt) => {
    // Global: Ctrl+C to exit
    if (evt.ctrl && evt.name === "c") {
      exitApp()
      return
    }

    // Links popup keyboard handling (modal — intercepts all keys when open)
    if (state.showLinksPopup) {
      if (evt.name === "escape" || evt.name === "q") {
        closeLinksPopup()
        evt.preventDefault()
        return
      }
      if (evt.name === "j" || evt.name === "down") {
        const links = currentMessageLinks()
        setState("linksPopupSelectedIndex", Math.min(state.linksPopupSelectedIndex + 1, links.length - 1))
        evt.preventDefault()
        return
      }
      if (evt.name === "k" || evt.name === "up") {
        setState("linksPopupSelectedIndex", Math.max(state.linksPopupSelectedIndex - 1, 0))
        evt.preventDefault()
        return
      }
      if (evt.name === "return") {
        const links = currentMessageLinks()
        const link = links[state.linksPopupSelectedIndex]
        if (link) {
          openUrlInBrowser(link.url)
          closeLinksPopup()
        }
        evt.preventDefault()
        return
      }
      evt.preventDefault()
      return
    }

    // Settings view keyboard handling
    if (state.view === "settings") {
      const items = getSettingItems()
      if (evt.name === "escape" || evt.name === "q") {
        closeSettings()
        evt.preventDefault()
        return
      }
      if (evt.name === "j" || evt.name === "down") {
        setState("settingsSelectedIndex", Math.min(state.settingsSelectedIndex + 1, items.length - 1))
        evt.preventDefault()
        return
      }
      if (evt.name === "k" || evt.name === "up") {
        setState("settingsSelectedIndex", Math.max(state.settingsSelectedIndex - 1, 0))
        evt.preventDefault()
        return
      }
      if (evt.name === "l" || evt.name === "right") {
        const item = items[state.settingsSelectedIndex]
        if (item) cycleSettingValue(item, 1)
        evt.preventDefault()
        return
      }
      if (evt.name === "h" || evt.name === "left") {
        const item = items[state.settingsSelectedIndex]
        if (item) cycleSettingValue(item, -1)
        evt.preventDefault()
        return
      }
      return
    }

    // Compose view keyboard handling
    if (state.view === "compose") {
      if (evt.name === "escape") {
        closeCompose()
        evt.preventDefault()
        return
      }
      if (evt.name === "tab" && !evt.shift) {
        setState("composeField", nextField(state.composeField))
        evt.preventDefault()
        return
      }
      if (evt.name === "tab" && evt.shift) {
        setState("composeField", prevField(state.composeField))
        evt.preventDefault()
        return
      }
      if (evt.ctrl && evt.name === "s") {
        // Mock send — just close
        closeCompose()
        evt.preventDefault()
        return
      }
      if (evt.name === "backspace") {
        const field = state.composeField
        if (field === "to") setState("composeTo", state.composeTo.slice(0, -1))
        else if (field === "subject") setState("composeSubject", state.composeSubject.slice(0, -1))
        else setState("composeBody", state.composeBody.slice(0, -1))
        evt.preventDefault()
        return
      }
      if (evt.ctrl && evt.name === "u") {
        const field = state.composeField
        if (field === "to") setState("composeTo", "")
        else if (field === "subject") setState("composeSubject", "")
        else setState("composeBody", "")
        evt.preventDefault()
        return
      }
      if (evt.name === "return" && state.composeField === "body") {
        setState("composeBody", state.composeBody + "\n")
        evt.preventDefault()
        return
      }
      if (evt.name === "return" && state.composeField !== "body") {
        // Enter in to/subject moves to next field
        setState("composeField", nextField(state.composeField))
        evt.preventDefault()
        return
      }
      // Accept printable characters
      if (evt.sequence && evt.sequence.length === 1 && !evt.ctrl && !evt.meta) {
        const char = evt.sequence
        if (char.charCodeAt(0) >= 32) {
          const field = state.composeField
          if (field === "to") setState("composeTo", state.composeTo + char)
          else if (field === "subject") setState("composeSubject", state.composeSubject + char)
          else setState("composeBody", state.composeBody + char)
          evt.preventDefault()
          return
        }
      }
      evt.preventDefault()
      return
    }

    // Search view keyboard handling
    if (state.view === "search") {
      if (evt.name === "escape") {
        if (state.searchTyping && state.searchQuery.length > 0) {
          // Stop typing, move to results navigation
          const results = searchThreads(threads(), state.searchQuery)
          if (results.length > 0) {
            setState({ searchTyping: false, searchSelectedIndex: 0 })
          } else {
            closeSearch()
          }
        } else {
          closeSearch()
        }
        evt.preventDefault()
        return
      }

      if (state.searchTyping) {
        // Typing mode: buffer characters into searchQuery
        if (evt.name === "backspace") {
          setState("searchQuery", state.searchQuery.slice(0, -1))
          setState("searchSelectedIndex", 0)
          evt.preventDefault()
          return
        }
        if (evt.name === "return") {
          // Enter = stop typing, navigate results
          const results = searchThreads(threads(), state.searchQuery)
          if (results.length > 0) {
            setState({ searchTyping: false, searchSelectedIndex: 0 })
          }
          evt.preventDefault()
          return
        }
        if (evt.ctrl && evt.name === "u") {
          setState("searchQuery", "")
          setState("searchSelectedIndex", 0)
          evt.preventDefault()
          return
        }
        // Accept printable characters
        if (evt.sequence && evt.sequence.length === 1 && !evt.ctrl && !evt.meta) {
          const char = evt.sequence
          if (char.charCodeAt(0) >= 32) {
            setState("searchQuery", state.searchQuery + char)
            setState("searchSelectedIndex", 0)
            evt.preventDefault()
            return
          }
        }
        evt.preventDefault()
        return
      }

      // Navigation mode
      if (evt.name === "j" || evt.name === "down") {
        const results = searchThreads(threads(), state.searchQuery)
        setState("searchSelectedIndex", Math.min(state.searchSelectedIndex + 1, results.length - 1))
        evt.preventDefault()
        return
      }
      if (evt.name === "k" || evt.name === "up") {
        setState("searchSelectedIndex", Math.max(state.searchSelectedIndex - 1, 0))
        evt.preventDefault()
        return
      }
      if (evt.name === "return") {
        const results = searchThreads(threads(), state.searchQuery)
        const thread = results[state.searchSelectedIndex]
        if (thread) openThread(thread)
        evt.preventDefault()
        return
      }
      if (evt.name === "/") {
        // Go back to typing mode
        setState("searchTyping", true)
        evt.preventDefault()
        return
      }
      if (evt.name === "q") {
        closeSearch()
        evt.preventDefault()
        return
      }
      evt.preventDefault()
      return
    }

    // Global: comma opens settings
    if (evt.name === ",") {
      openSettings()
      evt.preventDefault()
      return
    }

    // Tab toggles focus between sidebar and threads
    if (evt.name === "tab" && state.view === "inbox") {
      setState("focus", state.focus === "threads" ? "sidebar" : "threads")
      evt.preventDefault()
      return
    }

    // Sidebar navigation
    if (state.focus === "sidebar" && state.view === "inbox") {
      if (evt.name === "j" || evt.name === "down") {
        const next = Math.min(state.selectedSidebarIndex + 1, sidebarItemCount() - 1)
        setState("selectedSidebarIndex", next)
        evt.preventDefault()
      }
      if (evt.name === "k" || evt.name === "up") {
        const prev = Math.max(state.selectedSidebarIndex - 1, 0)
        setState("selectedSidebarIndex", prev)
        evt.preventDefault()
      }
      if (evt.name === "return") {
        selectSidebarItem(state.selectedSidebarIndex)
        setState("focus", "threads")
        evt.preventDefault()
      }
      if (evt.name === "escape") {
        setState("focus", "threads")
        evt.preventDefault()
      }
      if (evt.name === "q") {
        exitApp()
        return
      }
      return
    }

    // Thread list navigation
    if (state.view === "inbox" && state.focus === "threads") {
      if (evt.name === "j" || evt.name === "down") {
        setState("selectedThreadIndex", Math.min(state.selectedThreadIndex + 1, threads().length - 1))
        evt.preventDefault()
      }
      if (evt.name === "k" || evt.name === "up") {
        setState("selectedThreadIndex", Math.max(state.selectedThreadIndex - 1, 0))
        evt.preventDefault()
      }
      if (evt.name === "return") {
        const thread = threads()[state.selectedThreadIndex]
        if (thread) openThread(thread)
        evt.preventDefault()
      }
      if (evt.name === "escape") {
        if (state.activeLabel) {
          setState({ activeLabel: null, selectedThreadIndex: 0 })
          evt.preventDefault()
        }
      }
      if (evt.name === "q") {
        if (state.activeLabel) {
          setState({ activeLabel: null, selectedThreadIndex: 0 })
          evt.preventDefault()
          return
        }
        exitApp()
        return
      }
      if (evt.name === "a") {
        const thread = threads()[state.selectedThreadIndex]
        if (thread) archiveThread(thread.id)
        evt.preventDefault()
      }
      if (evt.name === "d") {
        const thread = threads()[state.selectedThreadIndex]
        if (thread) trashThread(thread.id)
        evt.preventDefault()
      }
      if (evt.name === "s") {
        const thread = threads()[state.selectedThreadIndex]
        if (thread) toggleStar(thread.id)
        evt.preventDefault()
      }
      if (evt.name === "u") {
        const thread = threads()[state.selectedThreadIndex]
        if (thread) toggleUnread(thread.id)
        evt.preventDefault()
      }
      if (evt.name === "/") {
        openSearch()
        evt.preventDefault()
      }
      if (evt.name === "c") {
        openCompose()
        evt.preventDefault()
      }
    }

    // Thread view
    if (state.view === "thread") {
      if (evt.name === "q" || evt.name === "escape") {
        goBack()
        evt.preventDefault()
        return
      }
      // J/K (shift): jump directly to next/prev message (check before j/k)
      if (evt.name === "J" || (evt.shift && evt.name === "j")) {
        threadViewHandle?.jumpToNextMessage()
        evt.preventDefault()
        return
      }
      if (evt.name === "K" || (evt.shift && evt.name === "k")) {
        threadViewHandle?.jumpToPrevMessage()
        evt.preventDefault()
        return
      }
      // j/k or arrow keys: scroll line-by-line through the thread
      if (evt.name === "j" || evt.name === "down") {
        threadViewHandle?.scrollDown()
        evt.preventDefault()
        return
      }
      if (evt.name === "k" || evt.name === "up") {
        threadViewHandle?.scrollUp()
        evt.preventDefault()
        return
      }
      if (evt.name === "a") {
        if (state.activeThread) {
          archiveThread(state.activeThread.id)
          goBack()
        }
        evt.preventDefault()
        return
      }
      if (evt.name === "d") {
        if (state.activeThread) {
          trashThread(state.activeThread.id)
          goBack()
        }
        evt.preventDefault()
        return
      }
      if (evt.name === "s") {
        if (state.activeThread) toggleStar(state.activeThread.id)
        evt.preventDefault()
        return
      }
      if (evt.name === "u") {
        if (state.activeThread) toggleUnread(state.activeThread.id)
        evt.preventDefault()
        return
      }
      if (evt.name === "l") {
        openLinksPopup()
        evt.preventDefault()
        return
      }
    }
  })

  return (
    <box
      width={dimensions().width}
      height={dimensions().height}
      flexDirection="column"
      backgroundColor={theme().background}
    >
      {/* Main layout: sidebars extend full height, keybind bar inside email panel */}
      <box flexDirection="row" flexGrow={1} alignItems="stretch">
        {/* Left sidebar — full height */}
        <Sidebar
          theme={theme()}
          folders={folders()}
          labels={labels()}
          activeFolder={state.activeFolder}
          activeLabel={state.activeLabel}
          selectedIndex={state.selectedSidebarIndex}
          focused={state.focus === "sidebar"}
          width={sidebarWidth()}
          onSelect={(type, id) => {
            if (type === "folder") {
              const idx = folders().findIndex((f) => f.id === id)
              if (idx >= 0) selectSidebarItem(idx)
            } else {
              const idx = labels().findIndex((l) => l.id === id)
              if (idx >= 0) selectSidebarItem(labelStartIndex() + idx)
            }
            setState("focus", "threads")
          }}
        />

        {/* Center column: email panel + keybind bar */}
        <box flexDirection="column" flexGrow={1}>
          {/* Email panel */}
          <box flexDirection="column" flexGrow={1} backgroundColor={theme().backgroundPanel} paddingTop={1} paddingBottom={1}>
            <Switch>
              <Match when={state.view === "search"}>
                <SearchView
                  theme={theme()}
                  threads={threads()}
                  query={state.searchQuery}
                  selectedIndex={state.searchSelectedIndex}
                  focused={state.searchTyping}
                  maxWidth={emailPanelWidth()}
                  onSelect={(i) => setState("searchSelectedIndex", i)}
                  onOpen={openThread}
                />
              </Match>
              <Match when={state.view !== "thread" || !state.activeThread}>
                <ThreadList
                  theme={theme()}
                  threads={threads()}
                  selectedIndex={state.selectedThreadIndex}
                  onSelect={(i) => setState("selectedThreadIndex", i)}
                  onOpen={openThread}
                  maxWidth={emailPanelWidth()}
                />
              </Match>
              <Match when={state.view === "thread" && state.activeThread}>
                <box flexDirection="column" flexGrow={1}>
                  {/* Thread header */}
                  <box
                    flexShrink={0}
                    paddingLeft={2}
                    paddingRight={2}
                    paddingBottom={1}
                    flexDirection="row"
                    justifyContent="space-between"
                    gap={1}
                  >
                    <text fg={theme().text} wrapMode="none">
                      <span style={{ fg: theme().textMuted }}>{"\u2190"} Inbox</span>
                      <span style={{ bold: true, fg: theme().text }}>{"  "}{state.activeThread!.subject}</span>
                    </text>
                    <text fg={theme().textMuted} flexShrink={0} wrapMode="none">
                      {state.activeThread!.messageCount} {state.activeThread!.messageCount === 1 ? "msg" : "msgs"}
                    </text>
                  </box>
                  <ThreadView
                    theme={theme()}
                    thread={state.activeThread!}
                    selectedMessageIndex={state.selectedMessageIndex}
                    onSelectedMessageChange={(idx) => setState("selectedMessageIndex", idx)}
                    ref={(handle) => { threadViewHandle = handle }}
                  />
                </box>
              </Match>
            </Switch>
          </box>

          {/* Keybind bar — inside center column, below email panel */}
          <KeybindBar theme={theme()} hints={keybindHints()} />
        </box>

        {/* Calendar sidebar — full height */}
        <Show when={calendarVisible()}>
          <CalendarSidebar
            theme={theme()}
            events={events()}
            activeThreadId={activeThreadId()}
            width={calendarWidth()}
          />
        </Show>
      </box>

      {/* Settings overlay */}
      <Show when={state.view === "settings"}>
        <SettingsView
          theme={theme()}
          width={dimensions().width}
          height={dimensions().height}
          selectedIndex={state.settingsSelectedIndex}
        />
      </Show>

      {/* Compose overlay */}
      <Show when={state.view === "compose"}>
        <ComposeView
          theme={theme()}
          width={dimensions().width}
          height={dimensions().height}
          state={{
            to: state.composeTo,
            subject: state.composeSubject,
            body: state.composeBody,
            activeField: state.composeField,
          }}
        />
      </Show>

      {/* Links popup overlay */}
      <Show when={state.showLinksPopup}>
        <LinksPopup
          theme={theme()}
          links={currentMessageLinks()}
          selectedIndex={state.linksPopupSelectedIndex}
          width={dimensions().width}
          height={dimensions().height}
        />
      </Show>
    </box>
  )
}
