/** 双扫描变更演示用模块，未接入 CLI 或插件生产入口。 */
export function normalizeLabel(input: string): string {
  return input.trim().replace(/\s+/g, ' ');
}
