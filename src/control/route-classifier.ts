export function isGenericAutoRoute(model: string): boolean {
  return /^(?:auto|best-free)$/i.test(model.trim());
}

export function isConcreteRoute(model: string): boolean {
  return /^[a-z0-9_-]+\/.+/i.test(model.trim());
}
