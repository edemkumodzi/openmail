import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import { EventBus } from "../bus/index.js"
import { threadRoutes } from "./routes/thread.js"
import { folderRoutes } from "./routes/folder.js"
import { labelRoutes } from "./routes/label.js"
import { calendarRoutes } from "./routes/calendar.js"
import { accountRoutes } from "./routes/account.js"
import { authRoutes } from "./routes/auth.js"

export namespace Server {
  let server: ReturnType<typeof Bun.serve> | null = null

  export function createApp(): Hono {
    const app = new Hono()

    // Health check
    app.get("/health", (c) => c.json({ status: "ok" }))

    // SSE endpoint — streams all events to the TUI
    app.get("/events", (c) => {
      return streamSSE(c, async (stream) => {
        const unsubscribe = EventBus.on("*", (event) => {
          stream.writeSSE({
            event: event.type,
            data: JSON.stringify({
              accountId: event.accountId,
              data: event.data,
              timestamp: event.timestamp.toISOString(),
            }),
          })
        })

        // Keep connection alive
        const keepAlive = setInterval(() => {
          stream.writeSSE({ event: "ping", data: "" })
        }, 30_000)

        // Clean up on disconnect
        stream.onAbort(() => {
          unsubscribe()
          clearInterval(keepAlive)
        })

        // Block until aborted
        await new Promise<void>((resolve) => {
          stream.onAbort(resolve)
        })
      })
    })

    // Mount route groups
    app.route("/threads", threadRoutes())
    app.route("/folders", folderRoutes())
    app.route("/labels", labelRoutes())
    app.route("/calendar", calendarRoutes())
    app.route("/accounts", accountRoutes())
    app.route("/auth", authRoutes())

    return app
  }

  /**
   * Start the HTTP server on the given port.
   */
  export function start(port: number = 4580): { port: number; stop: () => void } {
    const app = createApp()

    server = Bun.serve({
      port,
      fetch: app.fetch,
    })

    const actualPort = server.port

    return {
      port: actualPort,
      stop: () => {
        if (server) {
          server.stop()
          server = null
        }
      },
    }
  }
}
