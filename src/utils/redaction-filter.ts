/**
 * Redaction Filter v1.0
 * Purpose: Sanitize sensitive data before rendering to Telegram
 * Philosophy: "Never leak secrets in user-facing messages"
 */

// ============================================================================
// Types
// ============================================================================

export interface RedactionConfig {
  allowedDomains?: string[];
  maskChar?: string;
  preserveLength?: boolean;
}

export interface RedactionResult {
  sanitized: string;
  redactionCount: number;
  redactedPatterns: string[];
}

// ============================================================================
// Redaction Patterns
// ============================================================================

const REDACTION_PATTERNS = [
  // API Keys (ordered by specificity - most specific first)
  { name: 'Anthropic_API_Key', regex: /sk-ant-[A-Za-z0-9-]{20,}/g, mask: '[ANTHROPIC_KEY]' },
  { name: 'OpenAI_API_Key', regex: /sk-[A-Za-z0-9]{20,}/g, mask: '[OPENAI_KEY]' },
  { name: 'Google_API_Key', regex: /AIza[A-Za-z0-9_-]{30,}/g, mask: '[GOOGLE_KEY]' },
  { name: 'GitHub_Token', regex: /ghp_[A-Za-z0-9]{30,}/g, mask: '[GITHUB_TOKEN]' },
  { name: 'GitHub_OAuth', regex: /gho_[A-Za-z0-9]{30,}/g, mask: '[GITHUB_OAUTH]' },
  { name: 'Slack_Token', regex: /xoxb-[0-9]{10,13}-[0-9]{10,13}-[A-Za-z0-9]{24}/g, mask: '[SLACK_TOKEN]' },
  { name: 'Slack_Webhook', regex: /xoxp-[0-9]{10,13}-[0-9]{10,13}-[A-Za-z0-9]{24}/g, mask: '[SLACK_WEBHOOK]' },
  { name: 'Bearer_Token', regex: /Bearer\s+[A-Za-z0-9_-]{20,}/gi, mask: 'Bearer [REDACTED]' },
  { name: 'JWT_Token', regex: /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, mask: '[JWT_TOKEN]' },

  // Credentials
  { name: 'AWS_Access_Key', regex: /AKIA[0-9A-Z]{16}/g, mask: '[AWS_KEY]' },
  { name: 'Private_Key_Header', regex: /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----/g, mask: '[PRIVATE_KEY]' },

  // Personal Information (before phone to avoid conflicts)
  { name: 'Email', regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, mask: '[EMAIL]' },

  // Credit Card (must come before phone patterns)
  { name: 'Credit_Card', regex: /\b\d{4}[-\s]\d{4}[-\s]\d{4}[-\s]\d{4}\b/g, mask: '[CARD_NUMBER]' },

  // Phone (last to avoid conflicts)
  { name: 'Phone_International', regex: /\+\d{1,3}[-\s]?\d{1,4}[-\s]?\d{1,4}[-\s]?\d{4}/g, mask: '[PHONE]' },
  { name: 'Phone_JP', regex: /(\+81|0)\d{1,4}[-\s]?\d{1,4}[-\s]?\d{4}/g, mask: '[PHONE]' },
];

// Allowed domains for URL redaction (whitelist)
const DEFAULT_ALLOWED_DOMAINS = [
  'github.com',
  'gitlab.com',
  'docs.google.com',
  'drive.google.com',
  'notion.so',
  'confluence.com',
  'jira.com',
  'trello.com',
  'asana.com',
  'slack.com',
  'discord.com',
  'telegram.org',
];

// ============================================================================
// Entropy Calculation (for high-entropy string detection)
// ============================================================================

function calculateEntropy(str: string): number {
  const freq: Record<string, number> = {};
  for (const char of str) {
    freq[char] = (freq[char] || 0) + 1;
  }

  let entropy = 0;
  const len = str.length;
  for (const char in freq) {
    const p = freq[char] / len;
    entropy -= p * Math.log2(p);
  }

  return entropy;
}

// ============================================================================
// URL Redaction
// ============================================================================

function redactURLs(text: string, allowedDomains: string[]): string {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  return text.replace(urlRegex, (url) => {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname;

      // Check if domain is whitelisted
      const isAllowed = allowedDomains.some(domain =>
        hostname === domain || hostname.endsWith(`.${domain}`)
      );

      if (isAllowed) {
        return url;
      } else {
        return '[EXTERNAL_URL]';
      }
    } catch {
      // Invalid URL, redact it
      return '[INVALID_URL]';
    }
  });
}

// ============================================================================
// Main Redaction Function
// ============================================================================

export function redactSensitiveData(
  text: string,
  config: RedactionConfig = {}
): RedactionResult {
  const {
    allowedDomains = DEFAULT_ALLOWED_DOMAINS,
    maskChar = '*',
    preserveLength = false,
  } = config;

  let sanitized = text;
  const redactedPatterns: string[] = [];
  let redactionCount = 0;

  // Apply all redaction patterns
  for (const pattern of REDACTION_PATTERNS) {
    const matches = sanitized.match(pattern.regex);
    if (matches) {
      // Check entropy if required
      if (pattern.minEntropy) {
        const validMatches = matches.filter(match =>
          calculateEntropy(match) >= pattern.minEntropy
        );
        if (validMatches.length === 0) continue;
      }

      sanitized = sanitized.replace(pattern.regex, (match) => {
        redactionCount++;
        redactedPatterns.push(pattern.name);

        if (preserveLength) {
          return maskChar.repeat(match.length);
        } else {
          return pattern.mask;
        }
      });
    }
  }

  // Redact URLs
  const urlRedactedText = redactURLs(sanitized, allowedDomains);
  if (urlRedactedText !== sanitized) {
    redactionCount++;
    redactedPatterns.push('URL');
  }
  sanitized = urlRedactedText;

  return {
    sanitized,
    redactionCount,
    redactedPatterns: Array.from(new Set(redactedPatterns)),
  };
}

// ============================================================================
// Helper: Redact JSON
// ============================================================================

export function redactJSON(obj: any, config?: RedactionConfig): any {
  const jsonString = JSON.stringify(obj, null, 2);
  const result = redactSensitiveData(jsonString, config);
  try {
    return JSON.parse(result.sanitized);
  } catch {
    // If parsing fails, return redacted string
    return result.sanitized;
  }
}

// ============================================================================
// Helper: Safe Keys (for logging)
// ============================================================================

const SENSITIVE_KEY_PATTERNS = [
  /password/i,
  /secret/i,
  /token/i,
  /key/i,
  /credential/i,
  /auth/i,
  /api[_-]?key/i,
  /access[_-]?token/i,
  /refresh[_-]?token/i,
];

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some(pattern => pattern.test(key));
}

export function redactObjectKeys(obj: any): any {
  if (typeof obj !== 'object' || obj === null) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(redactObjectKeys);
  }

  const redacted: any = {};
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      if (isSensitiveKey(key)) {
        redacted[key] = '[REDACTED]';
      } else {
        redacted[key] = redactObjectKeys(obj[key]);
      }
    }
  }

  return redacted;
}
