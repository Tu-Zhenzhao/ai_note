/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: [
    "pg",
    "@ai-sdk/deepseek",
    "@ai-sdk/google",
    "@ai-sdk/openai",
    "ai",
    "@langchain/langgraph",
  ],
};

export default nextConfig;
