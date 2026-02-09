import { GoogleGenerativeAI } from "@google/generative-ai";

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.error("❌ GEMINI_API_KEY not found in environment");
  process.exit(1);
}

console.log("✅ GEMINI_API_KEY found:", apiKey.substring(0, 10) + "...");

async function testGemini() {
  try {
    const genAI = new GoogleGenerativeAI(apiKey ?? '');
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    console.log("\n📡 Testing Gemini API...");

    const result = await model.generateContent("Say 'Hello from Gemini!' in one sentence.");
    const response = await result.response;
    const text = response.text();

    console.log("\n✅ Gemini API Response:");
    console.log(text);
    console.log("\n🎉 Gemini API is working!");
  } catch (error) {
    console.error("\n❌ Gemini API Error:");
    console.error(error);
    process.exit(1);
  }
}

testGemini();
