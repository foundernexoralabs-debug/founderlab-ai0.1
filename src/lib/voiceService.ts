// Voice definitions - gender mapping never swaps
export const AZURE_VOICES = {
  male: "en-GB-RyanNeural",
  female: "en-GB-SoniaNeural",
} as const;

export const ELEVENLABS_VOICES = {
  male: { name: "Brian", id: "EST9Ui6982FZPSi7gCHi" },
} as const;

export type VoiceProvider = "azure" | "elevenlabs";
export type Gender = "male" | "female";

export interface VoiceConfig {
  provider: VoiceProvider;
  gender: Gender;
  speed: number; // -50 to +50, default 0
}

export function getSSML(config: VoiceConfig, text: string): string {
  const rate = config.speed >= 0 ? `+${config.speed}%` : `${config.speed}%`;
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-GB">
    <prosody rate="${rate}" pitch="medium">${text}</prosody>
  </speak>`;
}
