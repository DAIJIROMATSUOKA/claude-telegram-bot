/**
 * Image Generation Commands
 * /imagine <prompt> - Text-to-image with FLUX
 * /edit <description> - Photo reply: CLIPSeg + SDXL inpaint
 */

import { Context, InputFile } from "grammy";
import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";

const execAsync = promisify(exec);

const SCRIPTS_DIR = path.join(process.env.HOME || "", "claude-telegram-bot/scripts");
const AI_IMAGE_SCRIPT = path.join(SCRIPTS_DIR, "ai-image.py");
const DOWNLOAD_DIR = "/tmp/ai-images";
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";

if (!fs.existsSync(DOWNLOAD_DIR)) {
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
}

function parseEditInstruction(text: string): { target: string; prompt: string; invert: boolean } {
  const bgP = [/背景[をに](.+)/, /background\s+(?:to\s+)?(.+)/i, /バック[をに](.+)/];
  for (const p of bgP) { const m = text.match(p); if (m) return { target: "person", prompt: m[1]!.trim(), invert: true }; }
  const hairP = [/髪[をに](.+)/, /hair\s+(?:to\s+)?(.+)/i, /ヘア[をに](.+)/];
  for (const p of hairP) { const m = text.match(p); if (m) return { target: "hair", prompt: m[1]!.trim(), invert: false }; }
  const clothP = [/服[をに](.+)/, /clothes?\s+(?:to\s+)?(.+)/i, /衣�[をに](.+)/, /着替え[てに](.+)/];
  for (const p of clothP) { const m = text.match(p); if (m) return { target: "clothes", prompt: m[1]!.trim(), invert: false }; }
  const skyP = [/空[をに](.+)/, /sky\s+(?:to\s+)?(.+)/i];
  for (const p of skyP) { const m = text.match(p); if (m) return { target: "sky", prompt: m[1]!.trim(), invert: false }; }
  return { target: "object", prompt: text, invert: false };
}

async function downloadTelegramPhoto(ctx: Context, fileId: string): Promise<string> {
  const file = await ctx.api.getFile(fileId);
  const fp = file.file_path;
  if (!fp) throw new Error("Could not get file path");
  const url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${fp}`;
  const ext = path.extname(fp) || ".jpg";
  const local = path.join(DOWNLOAD_DIR, `input_${Date.now()}${ext}`);
  const r = await fetch(url);
  fs.writeFileSync(local, Buffer.from(await r.arrayBuffer()));
  return local;
}

async function sendPhoto(ctx: Context, fp: string, caption?: string): Promise<void> {
  await ctx.replyWithPhoto(new InputFile(fp), caption ? { caption } : undefined);
}
export async function handleImagine(ctx: Context): Promise<void> {
  const text = ctx.message?.text || "";
  const prompt = text.replace(/^\/imagine\s*/i, "").trim();
  if (!prompt) { await ctx.reply("使い方: /imagine 赤いドラゴン"); return; }
  let model = "schnell", steps = 4, quantize = 8, clean = prompt;
  if (prompt.includes("--dev")) { model = "dev"; steps = 12; clean = prompt.replace("--dev", "").trim(); }
  const sm = prompt.match(/--steps\s+(\d+)/);
  if (sm) { steps = parseInt(sm[1]!); clean = clean.replace(/--steps\s+\d+/, "").trim(); }
  const qm = prompt.match(/--quantize\s+(\d+)/);
  if (qm) { quantize = parseInt(qm[1]!); clean = clean.replace(/--quantize\s+\d+/, "").trim(); }
  const status = await ctx.reply(`🎨 画像生成中...\nモデル: FLUX ${model} (${steps} steps, q${quantize})\nプロンプト: ${clean}`);
  try {
    const esc = clean.replace(/'/g, "'\\''");
    const { stdout } = await execAsync(`python3 ${AI_IMAGE_SCRIPT} generate '${esc}' ${model} ${steps} ${quantize}`, { timeout: 600000, maxBuffer: 10 * 1024 * 1024 });
    const result = JSON.parse(stdout.trim().split("\n").pop() || "{}");
    if (result.error) { await ctx.api.editMessageText(ctx.chat!.id, status.message_id, `❌ ${result.error.substring(0, 200)}`); return; }
    await sendPhoto(ctx, result.output, `🎨 ${clean}`);
    await ctx.api.deleteMessage(ctx.chat!.id, status.message_id).catch(() => {});
    fs.unlinkSync(result.output);
  } catch (e: any) {
    await ctx.api.editMessageText(ctx.chat!.id, status.message_id, `❌ ${e.message?.substring(0, 200) || e}`);
  }
}

export async function handleEdit(ctx: Context): Promise<void> {
  console.log("[handleEdit] CALLED, text:", ctx.message?.text);
  const text = ctx.message?.text || "";
  const editText = text.replace(/^\/edit\s*/i, "").trim();
  if (!editText) { await ctx.reply("使い方: 写真に返信して /edit 髪を金髪にして"); return; }
  const reply = ctx.message?.reply_to_message;
  if (!reply?.photo && !reply?.document) { await ctx.reply("❌ 写真に返信してください"); return; }
  const debug = editText.toLowerCase().startsWith("debug ");
  const clean = debug ? editText.replace(/^debug\s+/i, "") : editText;
  const { target, prompt, invert } = parseEditInstruction(clean);
  const status = await ctx.reply(`✂️ 画像編集中...\nターゲット: ${target}${invert ? " (反転)" : ""}\nプロンプト: ${prompt}`);
  try {
    const photo = reply!.photo;
    const fileId = photo ? photo[photo.length - 1]!.file_id : reply!.document!.file_id;
    const input = await downloadTelegramPhoto(ctx, fileId);
    const eT = target.replace(/'/g, "'\\''");
    const eP = prompt.replace(/'/g, "'\\''");
    const flags = [invert ? "--invert" : "", debug ? "--debug" : ""].filter(Boolean).join(" ");
    const { stdout } = await execAsync(`python3 ${AI_IMAGE_SCRIPT} segment-edit '${input}' '${eT}' '${eP}' ${flags}`, { timeout: 900000, maxBuffer: 10 * 1024 * 1024 });
    const result = JSON.parse(stdout.trim().split("\n").pop() || "{}");
    if (result.error) { await ctx.api.editMessageText(ctx.chat!.id, status.message_id, `❌ ${result.error.substring(0, 200)}`); return; }
    if (debug && result.mask) { await sendPhoto(ctx, result.mask, "🔍 マスク画像"); fs.unlinkSync(result.mask); }
    await sendPhoto(ctx, result.output, `✂️ ${clean}`);
    await ctx.api.deleteMessage(ctx.chat!.id, status.message_id).catch(() => {});
    fs.unlinkSync(result.output);
    fs.unlinkSync(input);
  } catch (e: any) {
    await ctx.api.editMessageText(ctx.chat!.id, status.message_id, `❌ ${e.message?.substring(0, 200) || e}`);
  }
}
