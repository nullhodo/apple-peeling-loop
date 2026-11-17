/* ==========================================================================
   AUDIO SYSTEM INITIALIZATION (Tone.js ASMR Peeling Synth)
   ========================================================================== */
/**
 * Tone.jsシンセサイザーとエフェクトチェーンを初期化する関数
 */
function initializeAudioSynthesizers() {
    try {
        // シャリシャリと皮を剥く摩擦音: 連続するピンクノイズをバンドパスに通し、剥いている間だけ音量を上げる
        peelingGain = new Tone.Gain(0).toDestination();
        peelingFilter = new Tone.Filter({
            frequency: 3200,
            type: "bandpass",
            Q: 2.5
        }).connect(peelingGain);
        peelingNoiseSource = new Tone.Noise("pink").connect(peelingFilter);
        peelingNoiseSource.start();

        // 剥き終わった皮が切れて離れる瞬間の澄んだポップ音
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

        Tone.Destination.volume.value = Number(document.getElementById('slider-volume').value);
        isAudioEngineStarted = true;
        console.log("[Audio Engine] Tone.js synthesizers initialized successfully.");
    } catch (error) {
        console.warn("[Audio Engine] Could not initialize Tone.js: ", error);
    }
}

/**
 * 描画状態に同期して皮むき音を制御する関数
 * 剥いている間だけ摩擦音を鳴らし (外皮は高く硬い音 / 果肉は低く柔らかい音)、
 * 皮が切れて落ち始める瞬間にポップ音を1回鳴らす
 * @param {object} state computePeelSceneState の戻り値
 */
function updatePeelingAudioFeedback(state) {
    if (!isAudioEngineStarted) return;

    try {
        const isPeeling = state.releaseProgress <= 0 && state.peelProgress > 0;
        if (isPeelingAudioMuted) {
            peelingGain.gain.rampTo(0, 0.05);
            lastAudioPeelingState = null; // 再開直後に古い状態からポップ音が鳴らないようにする
            return;
        }

        if (isPeeling) {
            // ナイフの回転に合わせて刃当たりの強さと音色がわずかに揺らぎ、毎フレームの微小な乱れでザラつきを出す
            const strokeWobble = Math.sin(state.knifeLongitude * 2.0);
            const baseLevel = state.isFleshPeel ? 0.55 : 0.9;
            const level = baseLevel * (0.78 + 0.22 * strokeWobble) * (0.85 + 0.3 * Math.random());
            const centerFrequency = state.isFleshPeel ? 1900 : 3600;
            peelingFilter.Q.rampTo(state.isFleshPeel ? 1.4 : 2.8, 0.05);
            peelingFilter.frequency.rampTo(centerFrequency * (1 + 0.18 * strokeWobble), 0.05);
            peelingGain.gain.rampTo(level, 0.04);
        } else {
            peelingGain.gain.rampTo(0, 0.08);
        }

        const halfIndex = state.isFleshPeel ? 1 : 0;
        if (isReleasePopSoundEnabled && lastAudioPeelingState && lastAudioPeelingState.isPeeling && !isPeeling
            && lastAudioPeelingState.halfIndex === halfIndex && state.releaseProgress > 0) {
            recursionPopSynth.triggerAttackRelease(state.isFleshPeel ? "G4" : "C5", "8n");
        }
        lastAudioPeelingState = { isPeeling, halfIndex };
    } catch (audioException) {
        // Ignore transient audio scheduling hiccups
    }
}
