import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import {
  AZURE_VOICES,
  ELEVENLABS_VOICES,
  VoiceConfig,
  getSSML,
} from "@/lib/voiceService";

/**
 * Synthesize speech using Azure Neural Voices.
 * Returns a Blob containing audio/mpeg.
 */
export async function synthesizeSpeech(
  config: VoiceConfig,
  text: string
): Promise<Blob> {
  if (config.provider === "elevenlabs") {
    return synthesizeElevenLabs(config, text);
  }

  const speechKey = process.env.NEXT_PUBLIC_AZURE_SPEECH_KEY!;
  const region = process.env.NEXT_PUBLIC_AZURE_SPEECH_REGION!;
  const voiceName =
    config.gender === "male"
      ? AZURE_VOICES.male
      : AZURE_VOICES.female;

  const speechConfig = sdk.SpeechConfig.fromSubscription(speechKey, region);
  speechConfig.speechSynthesisVoiceName = voiceName;
  speechConfig.speechSynthesisOutputFormat =
    sdk.SpeechSynthesisOutputFormat.Audio16Khz32KBitRateMonoMp3;

  const ssml = getSSML(config, text);
  const synthesizer = new sdk.SpeechSynthesizer(speechConfig);

  return new Promise((resolve, reject) => {
    synthesizer.speakSsmlAsync(
      ssml,
      (result) => {
        synthesizer.close();
        if (
          result.reason === sdk.ResultReason.SynthesizingAudioCompleted
        ) {
          const audioData = result.audioData;
          const blob = new Blob([audioData], { type: "audio/mpeg" });
          resolve(blob);
        } else {
          reject(new Error(`Speech synthesis failed: ${result.reason}`));
        }
      },
      (err) => {
        synthesizer.close();
        reject(err);
      }
    );
  });
}

async function synthesizeElevenLabs(
  config: VoiceConfig,
  text: string
): Promise<Blob> {
  const apiKey = process.env.NEXT_PUBLIC_ELEVENLABS_API_KEY!;
  const voiceId = ELEVENLABS_VOICES.male.id; // currently only Brian is defined

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": apiKey,
      },
      body: JSON.stringify({
        text,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          speed: 1 + config.speed / 100, // convert -50..50 to 0.5..1.5
        },
      }),
    }
  );

  if (!response.ok) {
    throw new Error("ElevenLabs synthesis failed");
  }
  return response.blob();
}
