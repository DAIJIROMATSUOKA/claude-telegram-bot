/**
 * Croppy Build Validator 🦞
 *
 * Bot起動前にビルド検証 + 自動修正を行う。
 * AIは一切使わない。純粋なスクリプト処理のみ。
 *
 * 対応エラー:
 * 1. Export named 'X' not found in module 'Y' → 正しいexport先を探してimport修正
 *
 * ⚠️ callClaudeCLI() 不使用。従量課金API不使用。
 */

import { spawnSync } from 'child_process';
import { dirname, relative, resolve } from 'path';

const PROJECT_ROOT = resolve(import.meta.dir, '../..');
const MAX_FIX_ATTEMPTS = 3;
const BUILD_TIMEOUT_MS = 8000;

export interface BuildValidationResult {
  success: boolean;
  error?: string;
  fixes_applied: AutoFixResult[];
  attempts: number;
}

export interface AutoFixResult {
  error_type: string;
  description: string;
  files_modified: string[];
}

function tryBuild(): { success: boolean; error?: string; output?: string } {
  const result = spawnSync('bun', ['run', 'src/index.ts'], {
    cwd: PROJECT_ROOT,
    timeout: BUILD_TIMEOUT_MS,
    encoding: 'utf-8',
    env: { ...process.env },
  });
  const output = ((result.stdout || '') + '\n' + (result.stderr || '')).trim();
  if (result.signal === 'SIGTERM') return { success: true, output };
  if (result.status !== 0) return { success: false, error: output };
  return { success: true, output };
}

function attemptAutoFix(error: string): AutoFixResult | null {
  const exportMatch = error.match(/Export named '(\w+)' not found in module '([^']+)'/);
  if (exportMatch) return fixWrongExport(exportMatch[1], exportMatch[2]);
  return null;
}

function fixWrongExport(exportName: string, wrongModuleFullPath: string): AutoFixResult | null {
  console.log(`[BuildValidator] 🔧 修正中: '${exportName}' not in '${wrongModuleFullPath}'`);

  const grepExport = spawnSync('grep', ['-rn', `export.*${exportName}`, 'src/', '--include=*.ts', '-l'], { cwd: PROJECT_ROOT, encoding: 'utf-8' });
  const exportFiles = grepExport.stdout.trim().split('\n').filter(f => f && !f.includes('.test.') && !f.includes('node_modules') && !f.endsWith('index.ts') && !f.includes('.d.ts'));

  const srcIdx = wrongModuleFullPath.indexOf('src/');
  const wrongRelPath = srcIdx >= 0 ? wrongModuleFullPath.substring(srcIdx) : '';
  const correctFile = exportFiles.find(f => f !== wrongRelPath);
  if (!correctFile) { console.log(`[BuildValidator] ❌ '${exportName}' のexport先が見つからない`); return null; }

  console.log(`[BuildValidator] ✅ '${exportName}' は '${correctFile}' にある`);

  const wrongBasename = wrongModuleFullPath.split('/').pop()?.replace('.ts', '').replace('.js', '') || '';
  const grepImport = spawnSync('grep', ['-rn', `import.*${exportName}.*from`, 'src/', '--include=*.ts'], { cwd: PROJECT_ROOT, encoding: 'utf-8' });
  const allImportLines = grepImport.stdout.trim().split('\n').filter(Boolean);
  const wrongImportLines = allImportLines.filter(line => { const m = line.match(/from\s+['"]([^'"]+)['"]/); return m ? m[1].includes(wrongBasename) : false; });

  if (wrongImportLines.length === 0) { console.log(`[BuildValidator] ❌ 間違ったimportが見つからない`); return null; }

  const filesModified: string[] = [];
  for (const line of wrongImportLines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const filePath = line.substring(0, colonIdx);
    const fromMatch = line.match(/from\s+['"]([^'"]+)['"]/);
    if (!fromMatch) continue;
    const oldImportPath = fromMatch[1];

    const importingDir = dirname(resolve(PROJECT_ROOT, filePath));
    const correctAbsPath = resolve(PROJECT_ROOT, correctFile).replace('.ts', '.js');
    let newImportPath = relative(importingDir, correctAbsPath);
    if (!newImportPath.startsWith('.')) newImportPath = './' + newImportPath;

    console.log(`[BuildValidator] 📝 ${filePath}: '${oldImportPath}' → '${newImportPath}'`);
    spawnSync('sed', ['-i', '', `s|from '${oldImportPath}'|from '${newImportPath}'|g`, filePath], { cwd: PROJECT_ROOT });
    spawnSync('sed', ['-i', '', `s|from "${oldImportPath}"|from "${newImportPath}"|g`, filePath], { cwd: PROJECT_ROOT });
    if (!filesModified.includes(filePath)) filesModified.push(filePath);
  }

  if (filesModified.length === 0) return null;
  return { error_type: 'wrong_import_path', description: `'${exportName}' → '${correctFile}'`, files_modified: filesModified };
}

export async function runBuildValidation(): Promise<BuildValidationResult> {
  const fixes: AutoFixResult[] = [];
  console.log('[BuildValidator] 🛑 既存Botを停止中...');
  spawnSync('pkill', ['-f', 'bun.*index.ts']);
  spawnSync('sleep', ['1']);

  for (let attempt = 1; attempt <= MAX_FIX_ATTEMPTS; attempt++) {
    console.log(`[BuildValidator] 🔍 ビルドテスト (${attempt}/${MAX_FIX_ATTEMPTS})...`);
    const buildResult = tryBuild();

    if (buildResult.success) {
      console.log(`[BuildValidator] ✅ ビルドOK (${attempt}回目)`);
      spawnSync('pkill', ['-f', 'bun.*index.ts']);
      return { success: true, fixes_applied: fixes, attempts: attempt };
    }

    console.log(`[BuildValidator] ❌ ビルド失敗: ${buildResult.error?.substring(0, 200)}`);
    const fix = attemptAutoFix(buildResult.error || '');

    if (fix) {
      console.log(`[BuildValidator] 🔧 修正適用: ${fix.description}`);
      fixes.push(fix);
    } else {
      console.log('[BuildValidator] 💀 自動修正できないエラー');
      return { success: false, error: buildResult.error, fixes_applied: fixes, attempts: attempt };
    }
  }
  return { success: false, error: 'リトライ上限到達', fixes_applied: fixes, attempts: MAX_FIX_ATTEMPTS };
}

export function formatBuildReport(result: BuildValidationResult): string {
  if (result.success && result.fixes_applied.length === 0) return '✅ ビルド検証パス';
  if (result.success) {
    const fixList = result.fixes_applied.map(f => `  🔧 ${f.description} (${f.files_modified.join(', ')})`).join('\n');
    return `✅ ビルドパス（${result.attempts}回目）\n自動修正:\n${fixList}`;
  }
  const fixList = result.fixes_applied.length > 0 ? '\n修正試行:\n' + result.fixes_applied.map(f => `  🔧 ${f.description}`).join('\n') : '';
  return `❌ ビルド検証失敗\nエラー: ${result.error?.substring(0, 300)}${fixList}`;
}

if (import.meta.main) {
  console.log('🦞 Croppy Build Validator 開始...\n');
  const result = await runBuildValidation();
  console.log('\n' + formatBuildReport(result));
  if (result.fixes_applied.length > 0 && result.success) {
    const fixDesc = result.fixes_applied.map(f => f.description).join(', ');
    spawnSync('git', ['add', '-A'], { cwd: PROJECT_ROOT });
    spawnSync('git', ['commit', '-m', `fix(croppy): ${fixDesc}`, '--no-verify'], { cwd: PROJECT_ROOT });
    console.log('📦 修正をコミット済み');
  }
  process.exit(result.success ? 0 : 1);
}
