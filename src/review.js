import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { Octokit } from "octokit";
import { createPrompt } from "../utils/prompt.js";

// 1. Initialize Clients
const bedrock = new BedrockRuntimeClient({ region: process.env.AWS_REGION });
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

// Context from GitHub Actions
const context = {
  owner: process.env.REPO_OWNER,
  repo: process.env.REPO_NAME,
  pull_number: parseInt(process.env.PR_NUMBER),
};

async function main() {
  console.log(`🚀 Starting AI Review for PR #${context.pull_number}...`);

  // ---------------------------------------------------------
  // Step 1: Fetch the Code Diff
  // ---------------------------------------------------------
  const { data: prDiff } = await octokit.rest.pulls.get({
    ...context,
    mediaType: { format: "diff" },
  });

  if (!prDiff) {
    console.log("No diff found. Exiting.");
    return;
  }
  
  console.log("✅ Diff fetched. Sending to Claude...");

  // ---------------------------------------------------------
  // Step 2: Call AWS Bedrock (Claude 3)
  // ---------------------------------------------------------
  const prompt = createPrompt(prDiff);

  const command = new InvokeModelCommand({
    modelId: process.env.AWS_MODEL_ID || "anthropic.claude-3-5-sonnet-20240620-v1:0",
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify({
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const response = await bedrock.send(command);
  
  // Decode the response
  const responseBody = JSON.parse(new TextDecoder().decode(response.body));
  const aiResultText = responseBody.content[0].text;

  // ---------------------------------------------------------
  // Step 3: Parse JSON Safely
  // ---------------------------------------------------------
  let reviewDecision;
  
  try {
    // CLEANUP: Remove Markdown code blocks if the AI added them (e.g. ```json ... ```)
    const cleanText = aiResultText.replace(/```json\s*|\s*```/g, "");

    // FIND JSON: Look for the first '{' and last '}' to isolate the object
    const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
    
    if (!jsonMatch) {
      console.error("Raw AI Output:", aiResultText);
      throw new Error("Could not find JSON in AI response");
    }

    // PARSE: Convert string to Object
    reviewDecision = JSON.parse(jsonMatch[0]);
    
    console.log(`✅ Parsed Decision: ${reviewDecision.status}`);

  } catch (error) {
    console.error("❌ JSON Parse Error:", error.message);
    console.error("Raw AI Output:", aiResultText);
    process.exit(1); // Fail the Action so you see the Red X
  }

  // ---------------------------------------------------------
  // Step 4: Submit Review to GitHub
  // ---------------------------------------------------------
  const finalBody = `### ${reviewDecision.verdict}\n\n${reviewDecision.comments}`;

  await octokit.rest.pulls.createReview({
    ...context,
    body: finalBody,
    event: "COMMENT", // <--- CHANGE THIS (Forces a neutral comment)
  });

  console.log(`🎉 Review Commented: ${reviewDecision.verdict}`);
}

// Global Error Handler
main().catch((error) => {
  console.error("❌ Script Failed:", error);
  process.exit(1);
});