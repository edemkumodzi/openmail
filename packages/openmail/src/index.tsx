import { render } from "@opentui/solid"
import { App } from "./cli/cmd/tui/app.js"
import { Startup } from "./startup.js"
import { Config } from "./config/index.js"

async function main() {
  // --- Phase 1: Boot backend ---
  let bootResult: Startup.Result

  try {
    bootResult = await Startup.boot()
  } catch (err) {
    console.error("Failed to start OpenMail:", err)
    process.exit(1)
  }

  // --- Phase 2: First-run auth (if needed) ---
  if (bootResult.needsAuth) {
    const config = Config.load()

    console.log("")
    console.log("  Welcome to OpenMail!")
    console.log("")
    console.log("  Opening browser to sign in with Google...")
    console.log("  (If the browser doesn't open, check the terminal for the URL)")
    console.log("")

    try {
      const authResult = await Startup.authenticate(config)
      console.log(`  Signed in as ${authResult.email}`)
      console.log("  Syncing inbox...\n")

      try {
        await Startup.triggerSync(authResult.accountId, config)
        console.log("  Sync complete. Starting OpenMail...\n")
      } catch (err) {
        console.error("  Sync failed:", err instanceof Error ? err.message : err)
        console.log("  Starting OpenMail anyway...\n")
      }

      bootResult.accountEmail = authResult.email
    } catch (err) {
      console.error("  Authentication failed:", err instanceof Error ? err.message : err)
      console.log("  Starting with demo data...\n")
    }
  }

  // --- Phase 3: Render TUI ---
  ;(globalThis as any).__openmail_server_port = bootResult.port
  ;(globalThis as any).__openmail_account_email = bootResult.accountEmail

  await new Promise<void>((resolve) => {
    ;(globalThis as any).__openmail_exit = () => resolve()

    render(
      () => <App />,
      {
        targetFps: 30,
        exitOnCtrlC: false,
        openConsoleOnError: false,
      },
    )
  })

  bootResult.stop()
  process.exit(0)
}

main()
