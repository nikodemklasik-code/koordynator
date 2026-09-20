export type KernelPluginKind =
  | "EXECUTOR"
  | "PROVIDER"
  | "SKILL_SOURCE"
  | "VERIFIER"
  | "MEMORY"
  | "TRANSPORT"
  | "AUTH"
  | "STORAGE"
  | "UI_EXTENSION";

export type KernelPluginManifest = {
  pluginId: string;
  name: string;
  version: string;
  kind: KernelPluginKind;
  capabilities: string[];
  requiredKernelApi: string;
  optional: boolean;
  externalDependency: boolean;
  risk: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
};

export interface KernelPlugin {
  manifest: KernelPluginManifest;
  start?(): Promise<void>;
  health?(): Promise<{ healthy: boolean; detail?: string }>;
  stop?(): Promise<void>;
}

export class PluginRegistry {
  private readonly plugins = new Map<string, KernelPlugin>();

  register(plugin: KernelPlugin): void {
    if (this.plugins.has(plugin.manifest.pluginId)) {
      throw new Error(`PLUGIN_ALREADY_REGISTERED:${plugin.manifest.pluginId}`);
    }
    this.plugins.set(plugin.manifest.pluginId, plugin);
  }

  unregister(pluginId: string): void {
    this.plugins.delete(pluginId);
  }

  list(kind?: KernelPluginKind): KernelPluginManifest[] {
    return [...this.plugins.values()]
      .filter((plugin) => !kind || plugin.manifest.kind === kind)
      .map((plugin) => structuredClone(plugin.manifest));
  }

  byCapability(capability: string): KernelPluginManifest[] {
    const needle = capability.toLowerCase();
    return this.list().filter((plugin) =>
      plugin.capabilities.some((item) => item.toLowerCase() === needle)
    );
  }

  async health(): Promise<Array<{
    pluginId: string;
    healthy: boolean;
    detail?: string;
  }>> {
    const results = [];
    for (const plugin of this.plugins.values()) {
      if (!plugin.health) {
        results.push({
          pluginId: plugin.manifest.pluginId,
          healthy: true,
          detail: "health probe not required"
        });
        continue;
      }

      try {
        const status = await plugin.health();
        results.push({
          pluginId: plugin.manifest.pluginId,
          healthy: status.healthy,
          ...(status.detail === undefined ? {} : { detail: status.detail })
        });
      } catch (error) {
        results.push({
          pluginId: plugin.manifest.pluginId,
          healthy: false,
          detail: error instanceof Error ? error.message : "plugin health probe failed"
        });
      }
    }
    return results;
  }
}
