/* ==========================================================================
   AUDIO SYSTEM INITIALIZATION (Tone.js ASMR Peeling Synth)
   ========================================================================== */
/**
 * Tone.jsシンセサイザーとエフェクトチェーンを初期化する関数
 */
function initializeAudioSynthesizers() {
    try {
        // シャリシャリと皮を剥く摩擦音を再現するバンドパスノイズシンセ
        peelingFilter = new Tone.Filter({
            frequency: 3200,
            type: "bandpass",
            Q: 2.5
        }).toDestination();

        peelingNoiseSynth = new Tone.NoiseSynth({
            noise: { type: "pink" },
            envelope: {
                attack: 0.08,
                decay: 0.15,
                sustain: 0.6,
                release: 0.3
            }
        }).connect(peelingFilter);

        // 果肉と皮のレイヤーが切り替わる際の澄んだレゾナンス・ポップ音
        recursionPopSynth = new Tone.MembraneSynth({
            pitchDecay: 0.05,
            octaves: 3,
            oscillator: { type: "sine" },
            envelope: {
                attack: 0.005,
                decay: 0.3,
                sustain: 0.01,
                release: 0.4
            }
        }).toDestination();

        Tone.Destination.volume.value = -12;
        isAudioEngineStarted = true;
        console.log("[Audio Engine] Tone.js synthesizers initialized successfully.");
    } catch (error) {
        console.warn("[Audio Engine] Could not initialize Tone.js: ", error);
    }
}

/**
 * ループアニメーションの進行に応じて皮むき音を連続変調させる関数
 * @param {number} loopPhase (0.0 - 1.0)
 */
function updatePeelingAudioFeedback(loopPhase) {
    if (!isAudioEngineStarted || isPeelingAudioMuted) return;

    try {
        // 剥きの進行に合わせてフィルタ周波数を微妙に変化させ、リアルな摩擦感を演出
        const modulatedFrequency = 2400 + Math.sin(loopPhase * Math.PI * sketchParameters.spiralTurnCount * 4) * 1100;
        peelingFilter.frequency.rampTo(modulatedFrequency, 0.05);

        // 0.5 (皮から果肉) および 1.0 (果肉から新皮) の切り替わりでポップ音を発音
        const currentHalfPhaseIndex = Math.floor(loopPhase * 2);
        if (currentHalfPhaseIndex !== lastPlayedHalfPhaseIndex) {
            lastPlayedHalfPhaseIndex = currentHalfPhaseIndex;
            recursionPopSynth.triggerAttackRelease(currentHalfPhaseIndex === 1 ? "G4" : "C5", "8n");
        }
    } catch (audioException) {
        // Ignore transient audio scheduling hiccups
    }
}
