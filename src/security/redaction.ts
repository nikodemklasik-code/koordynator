const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9]{16,}/g,
  /ghp_[A-Za-z0-9]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /OMNIROUTE_API_KEY\s*=\s*\S+/g,
  /OPENAI_API_KEY\s*=\s*\S+/g,
  /-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]+?-----END [A-Z ]+PRIVATE KEY-----/g
];

export function redact(text: string): string {
  return SECRET_PATTERNS.reduce((acc, pattern) => acc.replace(pattern, "***"), text);
}

export function assertNoSecrets(surface: string, text: string): void {
  if (redact(text) !== text) throw new Error(`SECRET_LEAK:${surface}`);
}
