interface M3Result {
  ok: boolean;
  error?: string;
}

export class M3AgentClient {
  isEnabled(): boolean {
    return false;
  }
  getConfig(): Record<string, string> {
    return {};
  }
  async notify(_message: string, _title?: string): Promise<M3Result> {
    return { ok: false, error: 'M3 Agent disabled (stub)' };
  }
  notifyAsync(_message: string, _title?: string): void {
    // stub
  }
  async open(_path: string): Promise<M3Result> {
    return { ok: false, error: 'M3 Agent disabled (stub)' };
  }
  async reveal(_path: string): Promise<M3Result> {
    return { ok: false, error: 'M3 Agent disabled (stub)' };
  }
}
