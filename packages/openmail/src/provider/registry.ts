import { MailProvider, CalendarProvider } from "./types.js"

/**
 * Provider registry — manages registered mail providers.
 *
 * The server never imports providers directly. Providers register themselves
 * through this registry, and the server interacts only through the interfaces.
 */
export namespace ProviderRegistry {
  const providers = new Map<string, MailProvider.Plugin>()

  /**
   * Register a mail provider plugin.
   * Throws if a provider with the same ID is already registered.
   */
  export function register(provider: MailProvider.Plugin): void {
    if (providers.has(provider.info.id)) {
      throw new Error(`Provider "${provider.info.id}" is already registered`)
    }
    providers.set(provider.info.id, provider)
  }

  /**
   * Get a registered provider by ID.
   * Throws if the provider is not found.
   */
  export function get(id: string): MailProvider.Plugin {
    const provider = providers.get(id)
    if (!provider) {
      throw new Error(`Provider "${id}" not found. Available: ${list().map((p) => p.id).join(", ")}`)
    }
    return provider
  }

  /**
   * List all registered providers' info.
   */
  export function list(): MailProvider.Info[] {
    return Array.from(providers.values()).map((p) => p.info)
  }

  /**
   * Check if a provider has a specific capability.
   */
  export function hasCapability(id: string, capability: MailProvider.Capability): boolean {
    const provider = providers.get(id)
    return provider ? provider.info.capabilities.includes(capability) : false
  }

  // Type-safe capability narrowing

  export function asSearchable(provider: MailProvider.Plugin): MailProvider.Searchable | null {
    if (provider.info.capabilities.includes("search")) {
      return provider as unknown as MailProvider.Searchable
    }
    return null
  }

  export function asLabelable(provider: MailProvider.Plugin): MailProvider.Labelable | null {
    if (provider.info.capabilities.includes("labels")) {
      return provider as unknown as MailProvider.Labelable
    }
    return null
  }

  export function asPushable(provider: MailProvider.Plugin): MailProvider.Pushable | null {
    if (provider.info.capabilities.includes("push")) {
      return provider as unknown as MailProvider.Pushable
    }
    return null
  }

  export function asIncrementallySyncable(provider: MailProvider.Plugin): MailProvider.IncrementallySyncable | null {
    if (provider.info.capabilities.includes("incremental-sync")) {
      return provider as unknown as MailProvider.IncrementallySyncable
    }
    return null
  }

  export function asDraftable(provider: MailProvider.Plugin): MailProvider.Draftable | null {
    if (provider.info.capabilities.includes("drafts")) {
      return provider as unknown as MailProvider.Draftable
    }
    return null
  }

  export function asCalendar(provider: MailProvider.Plugin): CalendarProvider.Plugin | null {
    if (provider.info.capabilities.includes("calendar")) {
      return provider as unknown as CalendarProvider.Plugin
    }
    return null
  }

  /**
   * Remove all registered providers. Used in tests.
   */
  export function clear(): void {
    providers.clear()
  }
}
