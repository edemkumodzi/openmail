import { Mail } from "./types.js"

const now = new Date()
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60 * 1000)
const hoursAgo = (h: number) => new Date(now.getTime() - h * 60 * 60 * 1000)
const daysAgo = (d: number) => new Date(now.getTime() - d * 24 * 60 * 60 * 1000)
const hoursFromNow = (h: number) => new Date(now.getTime() + h * 60 * 60 * 1000)

export namespace MockData {
  export const me: Mail.Participant = { name: "Edem", email: "edem@gmail.com" }

  export const folders: Mail.Folder[] = [
    { id: "folder:INBOX", name: "Inbox", type: "inbox", unreadCount: 3 },
    { id: "folder:STARRED", name: "Starred", type: "starred", unreadCount: 0 },
    { id: "folder:SENT", name: "Sent", type: "sent", unreadCount: 0 },
    { id: "folder:DRAFTS", name: "Drafts", type: "drafts", unreadCount: 1 },
    { id: "folder:SPAM", name: "Spam", type: "spam", unreadCount: 0 },
    { id: "folder:TRASH", name: "Trash", type: "trash", unreadCount: 0 },
    { id: "folder:ARCHIVE", name: "Archive", type: "archive", unreadCount: 0 },
  ]

  export const labels: Mail.Label[] = [
    { id: "label:work", name: "work", color: "#5c9cf5" },
    { id: "label:personal", name: "personal", color: "#7fd88f" },
    { id: "label:receipts", name: "receipts", color: "#f5a742" },
    { id: "label:newsletters", name: "newsletters", color: "#9d7cd8" },
  ]

  export const threads: Mail.ThreadSummary[] = [
    {
      id: "t1",
      subject: "Quarterly planning doc",
      snippet: "Review the attached planning document and let me know your thoughts before our meeting this afternoon.",
      participants: [{ name: "Sarah Chen", email: "sarah@company.com" }],
      messageCount: 2,
      hasAttachments: true,
      folders: ["folder:INBOX"],
      labels: ["label:work"],
      unread: false,
      starred: true,
      time: minutesAgo(2),
      linkedEventIds: ["e1"],
    },
    {
      id: "t2",
      subject: "Re: API rate limiting strategy",
      snippet: "I think we should go with the token bucket approach. I'll draft an RFC this week.",
      participants: [
        { name: "Dave Kumar", email: "dave@company.com" },
        { name: "Alice Park", email: "alice@company.com" },
      ],
      messageCount: 3,
      hasAttachments: true,
      folders: ["folder:INBOX"],
      labels: ["label:work"],
      unread: true,
      starred: false,
      time: hoursAgo(1),
      linkedEventIds: [],
    },
    {
      id: "t3",
      subject: "[opencode] Fix streaming bug #1847",
      snippet: "@anomaly merged pull request #1847 in anomalyco/opencode: Fix streaming response handling",
      participants: [{ name: "GitHub", email: "notifications@github.com" }],
      messageCount: 1,
      hasAttachments: false,
      folders: ["folder:INBOX"],
      labels: [],
      unread: true,
      starred: false,
      time: hoursAgo(2),
      linkedEventIds: [],
    },
    {
      id: "t4",
      subject: "[PROJ-142] Sprint review scheduled",
      snippet: "Sprint 24 retrospective has been scheduled for Friday at 3:00 PM.",
      participants: [{ name: "Jira", email: "jira@company.atlassian.net" }],
      messageCount: 1,
      hasAttachments: false,
      folders: ["folder:INBOX"],
      labels: ["label:work"],
      unread: false,
      starred: false,
      time: hoursAgo(3),
      linkedEventIds: ["e3"],
    },
    {
      id: "t5",
      subject: "Your March invoice is available",
      snippet: "Your AWS bill for March 2026 is $142.38. View your invoice and payment details.",
      participants: [{ name: "AWS", email: "billing@aws.amazon.com" }],
      messageCount: 1,
      hasAttachments: true,
      folders: ["folder:INBOX"],
      labels: ["label:receipts"],
      unread: false,
      starred: false,
      time: hoursAgo(5),
      linkedEventIds: [],
    },
    {
      id: "t6",
      subject: "3 issues assigned to you",
      snippet: "You have 3 new issues assigned in project Frontend. View them in Linear.",
      participants: [{ name: "Linear", email: "notifications@linear.app" }],
      messageCount: 1,
      hasAttachments: false,
      folders: ["folder:INBOX"],
      labels: ["label:work"],
      unread: true,
      starred: false,
      time: hoursAgo(6),
      linkedEventIds: [],
    },
    {
      id: "t7",
      subject: "Dinner Sunday?",
      snippet: "Are you free for dinner this Sunday? Dad wants to try that new Thai place.",
      participants: [{ name: "Mom", email: "mom@gmail.com" }],
      messageCount: 1,
      hasAttachments: false,
      folders: ["folder:INBOX"],
      labels: ["label:personal"],
      unread: false,
      starred: false,
      time: daysAgo(1),
      linkedEventIds: [],
    },
    {
      id: "t8",
      subject: "Your weekly digest",
      snippet: "Here are the top stories from this week: AI coding assistants, new framework releases, and more.",
      participants: [{ name: "TL;DR Newsletter", email: "digest@tldr.tech" }],
      messageCount: 1,
      hasAttachments: false,
      folders: ["folder:INBOX"],
      labels: ["label:newsletters"],
      unread: false,
      starred: false,
      time: daysAgo(1),
      linkedEventIds: [],
    },
  ]

  export const threadDetails: Record<string, Mail.ThreadDetail> = {
    t2: {
      ...threads[1]!,
      messages: [
        {
          id: "m2-1",
          threadId: "t2",
          from: { name: "Dave Kumar", email: "dave@company.com" },
          to: [me, { name: "Alice Park", email: "alice@company.com" }],
          cc: [],
          subject: "API rate limiting strategy",
          body: {
            text: `Hey team,

I've been looking at the rate limiting options and I think we have two solid approaches:

1. Token bucket - more forgiving for bursts
2. Sliding window - more predictable behavior

What do you think?`,
          },
          attachments: [],
          time: daysAgo(1),
          unread: false,
        },
        {
          id: "m2-2",
          threadId: "t2",
          from: { name: "Alice Park", email: "alice@company.com" },
          to: [{ name: "Dave Kumar", email: "dave@company.com" }, me],
          cc: [],
          subject: "Re: API rate limiting strategy",
          body: {
            text: `I'd lean toward token bucket. We already see bursty traffic from the webhook consumers and I don't want to penalize them.`,
          },
          attachments: [],
          time: hoursAgo(3),
          unread: false,
        },
        {
          id: "m2-3",
          threadId: "t2",
          from: { name: "Dave Kumar", email: "dave@company.com" },
          to: [me, { name: "Alice Park", email: "alice@company.com" }],
          cc: [],
          subject: "Re: API rate limiting strategy",
          body: {
            text: `I think we should go with the token bucket approach then. I'll draft an RFC this week. Can you review the Redis implementation I linked?`,
          },
          attachments: [
            { id: "a1", filename: "rate-limit-rfc.pdf", mimeType: "application/pdf", size: 2_200_000 },
          ],
          time: hoursAgo(1),
          unread: true,
        },
      ],
    },
    t1: {
      ...threads[0]!,
      messages: [
        {
          id: "m1-1",
          threadId: "t1",
          from: { name: "Sarah Chen", email: "sarah@company.com" },
          to: [me, { name: "Dave Kumar", email: "dave@company.com" }],
          cc: [],
          subject: "Quarterly planning doc",
          body: {
            text: `Hi team,

Please review the attached planning doc before our meeting this afternoon. Focus on the resource allocation section.`,
          },
          attachments: [
            { id: "a2", filename: "q2-planning.pdf", mimeType: "application/pdf", size: 2_100_000 },
          ],
          calendarEvent: {
            id: "e1",
            summary: "Quarterly Planning Review",
            location: "Conference Room B",
            start: hoursFromNow(1),
            end: hoursFromNow(2),
            allDay: false,
            organizer: { name: "Sarah Chen", email: "sarah@company.com" },
            attendees: [
              { participant: { name: "Sarah Chen", email: "sarah@company.com" }, status: "accepted", role: "required" },
              { participant: me, status: "accepted", role: "required" },
              { participant: { name: "Dave Kumar", email: "dave@company.com" }, status: "needs-action", role: "required" },
            ],
            myStatus: "accepted",
            linkedThreadIds: ["t1"],
          },
          time: minutesAgo(15),
          unread: false,
        },
        {
          id: "m1-2",
          threadId: "t1",
          from: me,
          to: [{ name: "Sarah Chen", email: "sarah@company.com" }, { name: "Dave Kumar", email: "dave@company.com" }],
          cc: [],
          subject: "Re: Quarterly planning doc",
          body: {
            text: "Thanks Sarah. I'll review before the meeting.",
          },
          attachments: [],
          time: minutesAgo(2),
          unread: false,
        },
      ],
    },
  }

  export const events: Mail.CalEvent[] = [
    {
      id: "e1",
      summary: "Quarterly Planning Review",
      location: "Conference Room B",
      start: hoursFromNow(1),
      end: hoursFromNow(2),
      allDay: false,
      organizer: { name: "Sarah Chen", email: "sarah@company.com" },
      attendees: [
        { participant: { name: "Sarah Chen", email: "sarah@company.com" }, status: "accepted", role: "required" },
        { participant: me, status: "accepted", role: "required" },
        { participant: { name: "Dave Kumar", email: "dave@company.com" }, status: "needs-action", role: "required" },
      ],
      myStatus: "accepted",
      linkedThreadIds: ["t1"],
    },
    {
      id: "e2",
      summary: "1:1 with Jordan",
      location: "Zoom",
      conferenceUrl: "https://zoom.us/j/123456",
      start: hoursFromNow(3.5),
      end: hoursFromNow(4),
      allDay: false,
      organizer: { name: "Jordan Lee", email: "jordan@company.com" },
      attendees: [
        { participant: { name: "Jordan Lee", email: "jordan@company.com" }, status: "accepted", role: "required" },
        { participant: me, status: "accepted", role: "required" },
      ],
      myStatus: "accepted",
      linkedThreadIds: [],
    },
    {
      id: "e3",
      summary: "Sprint Planning",
      location: "Conference Room A",
      start: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0),
      end: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 11, 0),
      allDay: false,
      organizer: { name: "PM Bot", email: "pm@company.com" },
      attendees: [
        { participant: me, status: "accepted", role: "required" },
      ],
      myStatus: "accepted",
      linkedThreadIds: ["t4"],
    },
    {
      id: "e4",
      summary: "Design Review",
      location: "Zoom",
      conferenceUrl: "https://zoom.us/j/789012",
      start: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 11, 0),
      end: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 12, 0),
      allDay: false,
      organizer: { name: "Lisa Wang", email: "lisa@company.com" },
      attendees: [
        { participant: { name: "Lisa Wang", email: "lisa@company.com" }, status: "accepted", role: "required" },
        { participant: me, status: "tentative", role: "required" },
      ],
      myStatus: "tentative",
      linkedThreadIds: [],
    },
  ]
}
