import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { Octokit } from "octokit";
import { createPrompt } from "../utils/prompt.js";

// 1. Setup Clients
const bedrock = new BedrockRuntimeClient({ region: process.env.AWS_REGION });
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

const context = {
  owner: process.env.REPO_OWNER,
  repo: process.env.REPO_NAME,
  pull_number: parseInt(process.env.PR_NUMBER),
};

async function main() {
  console.log(`Starting Review for PR #${context.pull_number}...`);

  // 2. Fetch the PR Diff
  const { data: prDiff } = await octokit.rest.pulls.get({
    ...context,
    mediaType: { format: "diff" },
  });

  // 3. Call AWS Bedrock
  console.log("Analyzing with Claude...");
  const prompt = createPrompt(prDiff);
  
  const command = new InvokeModelCommand({
    modelId: process.env.AWS_MODEL_ID || "anthropic.claude-3-7-sonnet-20250219-v1:0",
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify({
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const response = await bedrock.send(command);
  const responseBody = JSON.parse(new TextDecoder().decode(response.body));
  const aiResultText = responseBody.content[0].text;

  // 4. Parse AI JSON (Simple cleanup to ensure valid JSON)
  // Sometimes LLMs add text like "Here is the JSON:" before the bracket
  const jsonMatch = aiResultText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("AI did not return JSON");
  
  const reviewDecision = JSON.parse(jsonMatch[0]);

  // 5. Post Review to GitHub
  await octokit.rest.pulls.createReview({
    ...context,
    body: reviewDecision.comments,
    event: reviewDecision.status, // APPROVE or REQUEST_CHANGES
  });

  console.log(`Review Submitted: ${reviewDecision.status}`);
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});