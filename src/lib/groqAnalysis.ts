import Groq from "groq-sdk";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

export async function analyzeSegment(
  transcript: string,
  durationSec: number
): Promise<{
  viralityScore: number; // 0-100
  reason: string;
  peakMoment: number; // time in seconds within segment
}> {
  const prompt = `
You are a viral content expert. Given a transcript of a ${durationSec}-second video segment, rate its potential virality (0-100) and explain why.
Also identify the timestamp (in seconds from segment start) of the most engaging moment.

Return ONLY a JSON object with keys: viralityScore (number), reason (string), peakMoment (number). No other text.
Transcript:
${transcript}`;

  const response = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
    response_format: { type: "json_object" },
  });

  const result = JSON.parse(response.choices[0].message.content!);
  return {
    viralityScore: result.viralityScore,
    reason: result.reason,
    peakMoment: result.peakMoment,
  };
}
