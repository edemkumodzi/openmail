import { render } from "@opentui/solid"
import { App } from "./cli/cmd/tui/app.js"

async function main() {
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

  process.exit(0)
}

main()
