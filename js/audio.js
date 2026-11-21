/* ==========================================================================
   AUDIO SYSTEM INITIALIZATION (Tone.js ASMR Peeling Synth)
   ========================================================================== */
/**
 * 皮むき音のノード群 (摩擦音のノイズ → バンドパス → ゲイン、ポップ音のシンセ) を今の Tone.js コンテキストに作る関数
 * リアルタイム再生と、指定ループ数録画用のオフライン生成 (Tone.Offline) の両方で使う
 */
function createPeelingAudioGraph() {
    // シャリシャリと皮を剥く摩擦音: 連続するピンクノイズをバンドパスに通し、剥いている間だけ音量を上げる
    const gain = new Tone.Gain(0).toDestination();
    const filter = new Tone.Filter({
        frequency: 3200,
        type: "bandpass",
        Q: 2.5
    }).connect(gain);
    const noise = new Tone.Noise("pink").connect(filter);

    // 剥き終わった皮が切れて離れる瞬間の澄んだポップ音
    const popSynth = new Tone.MembraneSynth({
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
    return { gain, filter, noise, popSynth };
}

/**
 * Tone.jsシンセサイザーとエフェクトチェーンを初期化する関数
 */
function initializeAudioSynthesizers() {
    try {
        const graph = createPeelingAudioGraph();
        peelingGain = graph.gain;
        peelingFilter = graph.filter;
        peelingNoiseSource = graph.noise;
        recursionPopSynth = graph.popSynth;
        peelingNoiseSource.start();

        Tone.Destination.volume.value = Number(document.getElementById('slider-volume').value);
        isAudioEngineStarted = true;
        console.log("[Audio Engine] Tone.js synthesizers initialized successfully.");
    } catch (error) {
        console.warn("[Audio Engine] Could not initialize Tone.js: ", error);
    }
}

/**
 * 描画状態から、その瞬間の皮むき音の鳴らし方を決める関数
 * 剥いている間だけ摩擦音を鳴らし (外皮は高く硬い音 / 果肉は低く柔らかい音)、
 * 皮が切れて落ち始める瞬間にポップ音を1回鳴らす
 * @param {object} state computePeelSceneState の戻り値
 * @param {object|null} previous 前のフレームでこの関数が返した値
 */
function computePeelingAudioTargets(state, previous) {
    const isPeeling = state.releaseProgress <= 0 && state.peelProgress > 0;
    const halfIndex = state.isFleshPeel ? 1 : 0;
    const targets = { isPeeling, halfIndex, level: 0, frequency: null, q: null, popNote: null };

    if (isPeeling) {
        // ナイフの回転に合わせて刃当たりの強さと音色がわずかに揺らぎ、毎フレームの微小な乱れでザラつきを出す
        const strokeWobble = Math.sin(state.knifeLongitude * 2.0);
        const baseLevel = state.isFleshPeel ? 0.55 : 0.9;
        targets.level = baseLevel * (0.78 + 0.22 * strokeWobble) * (0.85 + 0.3 * Math.random());
        targets.frequency = (state.isFleshPeel ? 1900 : 3600) * (1 + 0.18 * strokeWobble);
        targets.q = state.isFleshPeel ? 1.4 : 2.8;
    }
    if (isReleasePopSoundEnabled && previous && previous.isPeeling && !isPeeling
        && previous.halfIndex === halfIndex && state.releaseProgress > 0) {
        targets.popNote = state.isFleshPeel ? "G4" : "C5";
    }
    return targets;
}

/**
 * 鳴らし方をノード群に反映する関数
 * @param {object} graph createPeelingAudioGraph の戻り値
 * @param {object} targets computePeelingAudioTargets の戻り値
 * @param {number} [time] 反映する時刻 (秒、省略時は今)
 */
function applyPeelingAudioTargets(graph, targets, time) {
    if (targets.isPeeling) {
        graph.filter.Q.rampTo(targets.q, 0.05, time);
        graph.filter.frequency.rampTo(targets.frequency, 0.05, time);
        graph.gain.gain.rampTo(targets.level, 0.04, time);
    } else {
        graph.gain.gain.rampTo(0, 0.08, time);
    }
    if (targets.popNote) graph.popSynth.triggerAttackRelease(targets.popNote, "8n", time);
}

/**
 * 描画状態に同期して皮むき音を制御する関数
 * @param {object} state computePeelSceneState の戻り値
 */
function updatePeelingAudioFeedback(state) {
    if (!isAudioEngineStarted) return;

    try {
        if (isPeelingAudioMuted) {
            peelingGain.gain.rampTo(0, 0.05);
            lastAudioPeelingState = null; // 再開直後に古い状態からポップ音が鳴らないようにする
            return;
        }
        const targets = computePeelingAudioTargets(state, lastAudioPeelingState);
        applyPeelingAudioTargets({ gain: peelingGain, filter: peelingFilter, popSynth: recursionPopSynth }, targets);
        lastAudioPeelingState = targets;
    } catch (audioException) {
        // Ignore transient audio scheduling hiccups
    }
}

/**
 * 指定ループ数録画用に、各フレームの描画状態から皮むき音をオフラインで生成する関数
 * 描画が実時間と違う速さで進んでも、映像の各フレームと同じ時刻に同じ音が鳴る
 * @param {number[]} sceneTimestamps 各フレームの描画時刻 (computePeelSceneState に渡す時刻)
 * @param {number} frameRate 映像のフレームレート
 * @param {number} sampleRate 生成する音声のサンプリング周波数
 * @returns {Promise<AudioBuffer>}
 */
async function renderPeelingAudioOffline(sceneTimestamps, frameRate, sampleRate) {
    const durationSeconds = sceneTimestamps.length / frameRate;
    const volumeDecibels = Number(document.getElementById('slider-volume').value);
    const toneBuffer = await Tone.Offline(() => {
        Tone.getDestination().volume.value = volumeDecibels;
        const graph = createPeelingAudioGraph();
        graph.noise.start(0);
        let previous = null;
        sceneTimestamps.forEach((sceneTimestamp, frameIndex) => {
            const time = frameIndex / frameRate;
            const targets = computePeelingAudioTargets(computePeelSceneState(sceneTimestamp), previous);
            if (frameIndex === 0) {
                // ループの継ぎ目で音量が 0 からフェードインしないよう、最初のフレームは即座にその音量にする
                graph.gain.gain.setValueAtTime(targets.level, 0);
                if (targets.isPeeling) {
                    graph.filter.Q.setValueAtTime(targets.q, 0);
                    graph.filter.frequency.setValueAtTime(targets.frequency, 0);
                }
            } else {
                applyPeelingAudioTargets(graph, targets, time);
            }
            previous = targets;
        });
    }, durationSeconds, 2, sampleRate);
    return toneBuffer.get();
}
