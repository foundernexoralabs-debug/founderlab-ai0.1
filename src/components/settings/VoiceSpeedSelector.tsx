"use client";
import { VoiceConfig, VoiceProvider, Gender } from "@/lib/voiceService";

const providers: VoiceProvider[] = ["azure", "elevenlabs"];
const genders: Gender[] = ["male", "female"];

export default function VoiceSpeedSelector({
  config,
  onChange,
}: {
  config: VoiceConfig;
  onChange: (c: VoiceConfig) => void;
}) {
  return (
    <div className="glass-card p-6 space-y-4 rounded-2xl shadow-lg">
      <h3 className="text-lg font-semibold">Voice & Speed</h3>

      <div className="flex gap-4 flex-wrap">
        {/* Provider */}
        <div className="flex-1">
          <label className="text-sm text-gray-500">Provider</label>
          <div className="flex gap-2 mt-1">
            {providers.map((p) => (
              <button
                key={p}
                onClick={() => onChange({ ...config, provider: p })}
                className={`px-4 py-2 rounded-full text-sm font-medium transition ${
                  config.provider === p
                    ? "bg-indigo-600 text-white shadow-md"
                    : "bg-gray-100 hover:bg-gray-200"
                }`}
              >
                {p === "azure" ? "Azure Neural" : "ElevenLabs"}
              </button>
            ))}
          </div>
        </div>

        {/* Gender */}
        <div className="flex-1">
          <label className="text-sm text-gray-500">Voice</label>
          <div className="flex gap-2 mt-1">
            {genders.map((g) => (
              <button
                key={g}
                onClick={() => onChange({ ...config, gender: g })}
                className={`px-4 py-2 rounded-full text-sm font-medium capitalize transition ${
                  config.gender === g
                    ? "bg-indigo-600 text-white shadow-md"
                    : "bg-gray-100 hover:bg-gray-200"
                }`}
              >
                {g}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Speed slider */}
      <div>
        <label className="text-sm text-gray-500">Speed</label>
        <input
          type="range"
          min={-50}
          max={50}
          value={config.speed}
          onChange={(e) =>
            onChange({ ...config, speed: parseInt(e.target.value, 10) })
          }
          className="w-full mt-2 accent-indigo-600"
        />
        <div className="flex justify-between text-xs text-gray-400">
          <span>Slow</span>
          <span>{config.speed > 0 ? `+${config.speed}%` : `${config.speed}%`}</span>
          <span>Fast</span>
        </div>
      </div>
    </div>
  );
}
