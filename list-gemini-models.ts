import { GoogleGenerativeAI } from "@google/generative-ai";

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.error("❌ GEMINI_API_KEY not found");
  process.exit(1);
}

async function listModels() {
  try {
    const genAI = new GoogleGenerativeAI(apiKey!);

    console.log("📋 Fetching available Gemini models...\n");

    const models = await (genAI as any).listModels();

    console.log("✅ Available models:");
    for await (const model of models) {
      console.log(`\n  - ${model.name}`);
      console.log(`    Display Name: ${model.displayName}`);
      console.log(`    Supported Methods: ${model.supportedGenerationMethods?.join(", ")}`);
    }
  } catch (error) {
    console.error("\n❌ Error listing models:");
    console.error(error);
    process.exit(1);
  }
}

listModels();
