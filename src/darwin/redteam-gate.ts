/**
 * Darwin Engine v1.2.2 - RED-TEAM Gate
 *
 * Security & risk assessment before idea publication
 *
 * Gate Rules:
 * - critical >= 1 OR high >= 3 → BLOCK
 * - medium >= 5 → WARN_HUMAN_REVIEW
 * - otherwise → PASS
 */

export interface RedTeamResult {
  critical: number;
  high: number;
  medium: number;
  low: number;
  status: 'passed' | 'blocked' | 'warn';
  issues: RedTeamIssue[];
  recommendation: string;
}

export interface RedTeamIssue {
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: string;
  description: string;
  mitigation?: string;
}

export interface IdeaForRedTeam {
  title: string;
  content: string;
  rationale: string;
  theme: string;
}

/**
 * RED-TEAM Security Gate
 */
export class RedTeamGate {
  /**
   * Analyze idea for security, compliance, and risk issues
   */
  async analyze(idea: IdeaForRedTeam): Promise<RedTeamResult> {
    const issues: RedTeamIssue[] = [];

    // Run all checks
    issues.push(...this.checkFinancialRisk(idea));
    issues.push(...this.checkComplianceRisk(idea));
    issues.push(...this.checkReputationRisk(idea));
    issues.push(...this.checkOperationalRisk(idea));
    issues.push(...this.checkSecurityRisk(idea));
    issues.push(...this.checkLegalRisk(idea));
    issues.push(...this.checkEthicalRisk(idea));

    // Count by severity
    const critical = issues.filter(i => i.severity === 'critical').length;
    const high = issues.filter(i => i.severity === 'high').length;
    const medium = issues.filter(i => i.severity === 'medium').length;
    const low = issues.filter(i => i.severity === 'low').length;

    // Determine status based on gate rules
    let status: 'passed' | 'blocked' | 'warn';
    let recommendation: string;

    if (critical >= 1 || high >= 3) {
      status = 'blocked';
      recommendation = `🚫 BLOCKED: ${critical} critical + ${high} high severity issues. This idea cannot proceed without major revisions.`;
    } else if (medium >= 5) {
      status = 'warn';
      recommendation = `⚠️ WARNING: ${medium} medium severity issues detected. Human review recommended before proceeding.`;
    } else {
      status = 'passed';
      recommendation = `✅ PASSED: ${issues.length} issues found (${high} high, ${medium} medium, ${low} low). Safe to proceed with normal review.`;
    }

    return {
      critical,
      high,
      medium,
      low,
      status,
      issues,
      recommendation,
    };
  }

  /**
   * Check for financial risks
   */
  private checkFinancialRisk(idea: IdeaForRedTeam): RedTeamIssue[] {
    const issues: RedTeamIssue[] = [];
    const text = (idea.title + ' ' + idea.content + ' ' + idea.rationale).toLowerCase();

    // Critical: Large unvalidated investment
    if (
      (text.includes('million') || text.includes('億') || text.includes('百万')) &&
      !text.includes('validated') && !text.includes('proven') &&
      !text.includes('pilot')
    ) {
      issues.push({
        severity: 'critical',
        category: 'Financial Risk',
        description: 'Proposes large financial commitment without validation or pilot testing',
        mitigation: 'Require pilot study with validated ROI before full investment',
      });
    }

    // High: Significant budget without ROI
    if (
      (text.includes('budget') || text.includes('investment') || text.includes('spend')) &&
      !text.includes('roi') && !text.includes('return') && !text.includes('payback')
    ) {
      issues.push({
        severity: 'high',
        category: 'Financial Risk',
        description: 'Budget request without clear ROI or payback period',
        mitigation: 'Calculate expected ROI and payback timeline',
      });
    }

    // Medium: Ongoing costs not mentioned
    if (
      (text.includes('subscription') || text.includes('recurring') || text.includes('maintenance')) &&
      !text.includes('cost') && !text.includes('budget')
    ) {
      issues.push({
        severity: 'medium',
        category: 'Financial Risk',
        description: 'Recurring costs not explicitly budgeted',
        mitigation: 'Document all recurring costs and budget allocation',
      });
    }

    return issues;
  }

  /**
   * Check for compliance risks
   */
  private checkComplianceRisk(idea: IdeaForRedTeam): RedTeamIssue[] {
    const issues: RedTeamIssue[] = [];
    const text = (idea.title + ' ' + idea.content + ' ' + idea.rationale).toLowerCase();

    // Critical: Data privacy violation
    if (
      (text.includes('personal data') || text.includes('user data') || text.includes('個人情報')) &&
      !text.includes('gdpr') && !text.includes('privacy') && !text.includes('consent')
    ) {
      issues.push({
        severity: 'critical',
        category: 'Compliance',
        description: 'Handles personal data without mentioning privacy compliance (GDPR, etc.)',
        mitigation: 'Ensure GDPR/privacy law compliance and user consent mechanisms',
      });
    }

    // High: Regulatory compliance not addressed
    if (
      (text.includes('financial') || text.includes('healthcare') || text.includes('medical')) &&
      !text.includes('compliant') && !text.includes('regulation') && !text.includes('certified')
    ) {
      issues.push({
        severity: 'high',
        category: 'Compliance',
        description: 'Operates in regulated industry without compliance discussion',
        mitigation: 'Consult legal team and ensure industry-specific compliance',
      });
    }

    return issues;
  }

  /**
   * Check for reputation risks
   */
  private checkReputationRisk(idea: IdeaForRedTeam): RedTeamIssue[] {
    const issues: RedTeamIssue[] = [];
    const text = (idea.title + ' ' + idea.content + ' ' + idea.rationale).toLowerCase();

    // High: Public controversy potential
    const controversialKeywords = [
      'controversial', 'sensitive', 'political', 'polarizing',
      '論争', '物議', '政治的'
    ];

    if (controversialKeywords.some(kw => text.includes(kw))) {
      issues.push({
        severity: 'high',
        category: 'Reputation Risk',
        description: 'Idea touches on potentially controversial or sensitive topics',
        mitigation: 'Conduct stakeholder review and prepare crisis communication plan',
      });
    }

    // Medium: Customer backlash potential
    if (
      (text.includes('price increase') || text.includes('remove feature') || text.includes('値上げ')) &&
      !text.includes('customer communication') && !text.includes('gradual')
    ) {
      issues.push({
        severity: 'medium',
        category: 'Reputation Risk',
        description: 'Customer-facing negative change without communication strategy',
        mitigation: 'Develop customer communication and transition plan',
      });
    }

    return issues;
  }

  /**
   * Check for operational risks
   */
  private checkOperationalRisk(idea: IdeaForRedTeam): RedTeamIssue[] {
    const issues: RedTeamIssue[] = [];
    const text = (idea.title + ' ' + idea.content + ' ' + idea.rationale).toLowerCase();

    // High: Single point of failure
    if (
      (text.includes('critical system') || text.includes('production') || text.includes('本番環境')) &&
      !text.includes('backup') && !text.includes('redundancy') && !text.includes('failover')
    ) {
      issues.push({
        severity: 'high',
        category: 'Operational Risk',
        description: 'Critical system change without backup or failover plan',
        mitigation: 'Implement backup systems and rollback procedures',
      });
    }

    // Medium: Resource constraint
    if (
      (text.includes('team') || text.includes('resources') || text.includes('人員')) &&
      (text.includes('limited') || text.includes('insufficient') || text.includes('不足'))
    ) {
      issues.push({
        severity: 'medium',
        category: 'Operational Risk',
        description: 'Acknowledges resource constraints that may hinder execution',
        mitigation: 'Secure adequate resources or reduce scope',
      });
    }

    return issues;
  }

  /**
   * Check for security risks
   */
  private checkSecurityRisk(idea: IdeaForRedTeam): RedTeamIssue[] {
    const issues: RedTeamIssue[] = [];
    const text = (idea.title + ' ' + idea.content + ' ' + idea.rationale).toLowerCase();

    // Critical: Security vulnerability
    if (
      (text.includes('open access') || text.includes('public api') || text.includes('公開')) &&
      !text.includes('authentication') && !text.includes('authorization') && !text.includes('security')
    ) {
      issues.push({
        severity: 'critical',
        category: 'Security',
        description: 'Exposes system or data without proper authentication/authorization',
        mitigation: 'Implement authentication, authorization, and security audit',
      });
    }

    // High: Third-party dependency risk
    if (
      (text.includes('third-party') || text.includes('vendor') || text.includes('外部')) &&
      !text.includes('vetted') && !text.includes('security review') && !text.includes('trusted')
    ) {
      issues.push({
        severity: 'high',
        category: 'Security',
        description: 'Relies on third-party vendor without security vetting',
        mitigation: 'Conduct security assessment of third-party vendors',
      });
    }

    return issues;
  }

  /**
   * Check for legal risks
   */
  private checkLegalRisk(idea: IdeaForRedTeam): RedTeamIssue[] {
    const issues: RedTeamIssue[] = [];
    const text = (idea.title + ' ' + idea.content + ' ' + idea.rationale).toLowerCase();

    // High: IP infringement risk
    if (
      (text.includes('patent') || text.includes('trademark') || text.includes('copyright') || text.includes('特許')) &&
      !text.includes('licensed') && !text.includes('owned') && !text.includes('cleared')
    ) {
      issues.push({
        severity: 'high',
        category: 'Legal Risk',
        description: 'Mentions IP without clarifying ownership or licensing',
        mitigation: 'Conduct IP clearance and obtain necessary licenses',
      });
    }

    // Medium: Contract modification
    if (
      (text.includes('contract') || text.includes('agreement') || text.includes('terms') || text.includes('契約')) &&
      (text.includes('change') || text.includes('modify') || text.includes('変更'))
    ) {
      issues.push({
        severity: 'medium',
        category: 'Legal Risk',
        description: 'Proposes contract changes that may require legal review',
        mitigation: 'Consult legal team before modifying contracts or terms',
      });
    }

    return issues;
  }

  /**
   * Check for ethical risks
   */
  private checkEthicalRisk(idea: IdeaForRedTeam): RedTeamIssue[] {
    const issues: RedTeamIssue[] = [];
    const text = (idea.title + ' ' + idea.content + ' ' + idea.rationale).toLowerCase();

    // High: Ethical concerns
    const ethicalKeywords = [
      'manipulate', 'exploit', 'deceive', 'dark pattern',
      '操作', '搾取', '欺く'
    ];

    if (ethicalKeywords.some(kw => text.includes(kw))) {
      issues.push({
        severity: 'high',
        category: 'Ethical Risk',
        description: 'Raises ethical concerns about manipulation or exploitation',
        mitigation: 'Review with ethics board and ensure transparent practices',
      });
    }

    // Medium: AI/automation impact
    if (
      (text.includes('automate') || text.includes('ai') || text.includes('replace') || text.includes('自動化')) &&
      (text.includes('employee') || text.includes('worker') || text.includes('従業員'))
    ) {
      issues.push({
        severity: 'medium',
        category: 'Ethical Risk',
        description: 'Automation may impact employment without transition plan',
        mitigation: 'Develop employee transition and reskilling plan',
      });
    }

    return issues;
  }

  /**
   * Format RED-TEAM report
   */
  formatReport(result: RedTeamResult): string {
    const lines: string[] = [];

    lines.push(`🛡️ RED-TEAM Gate Analysis`);
    lines.push(`Status: ${result.status.toUpperCase()}`);
    lines.push(`Issues: ${result.critical} critical, ${result.high} high, ${result.medium} medium, ${result.low} low`);
    lines.push('');
    lines.push(result.recommendation);

    if (result.issues.length > 0) {
      lines.push('');
      lines.push('Issues Detected:');

      for (const issue of result.issues) {
        const icon = {
          critical: '🔴',
          high: '🟠',
          medium: '🟡',
          low: '🟢',
        }[issue.severity];

        lines.push(`${icon} [${issue.severity.toUpperCase()}] ${issue.category}`);
        lines.push(`   ${issue.description}`);
        if (issue.mitigation) {
          lines.push(`   → Mitigation: ${issue.mitigation}`);
        }
      }
    }

    return lines.join('\n');
  }
}
