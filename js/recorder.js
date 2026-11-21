/* ==========================================================================
   60FPS MP4 VIDEO RECORDING PIPELINE (WebCodecs + mp4-muxer)
   ========================================================================== */
/*
 * キャンバスのフレームを WebCodecs の VideoEncoder でエンコードし、mp4-muxer で mp4 にまとめる。
 * - 手動録画: 描画のたびにフレームを実時間のタイムスタンプで送る
 * - 指定ループ数録画: 描画ループを止め、1/60 秒刻みの時刻で描画してはエンコードする (オフライン描画)。
 *   コマ落ちがなく、ちょうど N ループ分の長さで最初と最後がつながる
 * 効果音は AudioEncoder でエンコードして音声トラックに入れる (効果音をオフにしているときは入れない)。
 * - 手動録画: Tone.js の出力を MediaStreamTrackProcessor で取り出してそのまま録る
 * - 指定ループ数録画: 各フレームの描画状態から同じ音を Tone.Offline で生成する
 */
const RECORDING_FRAME_RATE = 60;
const RECORDING_BITRATE = 16000000; // 16 Mbps
const RECORDING_KEYFRAME_INTERVAL = RECORDING_FRAME_RATE * 2;

// 優先順: 多くのプレーヤーで再生できる H.264 → VP9 → AV1 (いずれも mp4 に格納する)
const RECORDING_CODEC_CANDIDATES = [
    { codec: 'avc1.640033', muxerCodec: 'avc', label: 'H.264' }, // High Profile Level 5.1 (4K まで)
    { codec: 'avc1.4d0033', muxerCodec: 'avc', label: 'H.264' },
    { codec: 'vp09.00.51.08', muxerCodec: 'vp9', label: 'VP9' },
    { codec: 'av01.0.12M.08', muxerCodec: 'av1', label: 'AV1' }
];

const RECORDING_AUDIO_BITRATE = 192000;
const RECORDING_AUDIO_CHANNELS = 2;
const OFFLINE_AUDIO_SAMPLE_RATE = 48000;
const OFFLINE_AUDIO_BLOCK_FRAMES = 4800;
// 優先順: AAC → Opus (samplesPerChunk はエンコーダが chunk の長さを付けないときの補い)
const RECORDING_AUDIO_CODEC_CANDIDATES = [
    { codec: 'mp4a.40.2', muxerCodec: 'aac', label: 'AAC', samplesPerChunk: 1024 },
    { codec: 'opus', muxerCodec: 'opus', label: 'Opus', samplesPerChunk: 960 }
];

/**
 * 録画を開始する関数
 * @param {number} numberOfLoopsToRecord 指定ループ数 (0なら手動停止まで無制限)
 */
async function startRecordingPipeline(numberOfLoopsToRecord = 0) {
    if (isRecordingActive) return;
    if (typeof VideoEncoder === 'undefined' || typeof Mp4Muxer === 'undefined') {
        console.error("[Video Recorder] WebCodecs (VideoEncoder) または mp4-muxer が使えないため録画できません。");
        return;
    }
    const sourceCanvas = document.querySelector('#canvas-container canvas');
    if (!sourceCanvas) {
        console.error("[Video Recorder] Canvas element not found.");
        return;
    }

    // H.264 は幅・高さが偶数である必要があるため、奇数なら 1px 削る
    const videoWidth = sourceCanvas.width - (sourceCanvas.width % 2);
    const videoHeight = sourceCanvas.height - (sourceCanvas.height % 2);
    const codecChoice = await selectSupportedRecordingCodec(videoWidth, videoHeight);
    if (!codecChoice) {
        console.error(`[Video Recorder] ${videoWidth}x${videoHeight} に対応するエンコーダが見つかりません。`);
        return;
    }

    const audioChoice = await selectSupportedAudioCodec(numberOfLoopsToRecord > 0);

    isRecordingActive = true;
    targetRecordingLoopCount = numberOfLoopsToRecord;
    recordingSession = createRecordingSession(sourceCanvas, videoWidth, videoHeight, codecChoice, audioChoice);
    if (audioChoice && numberOfLoopsToRecord === 0) startRealtimeAudioCapture(recordingSession);
    recordingStartTimestamp = millis();
    showRecordingIndicator(true);
    const audioLabel = audioChoice ? `${audioChoice.label} ${audioChoice.sampleRate}Hz` : 'no audio';
    console.log(`[Video Recorder] Recording started (${codecChoice.label} ${codecChoice.codec}, ${videoWidth}x${videoHeight}, ${audioLabel}, mp4).`);

    if (numberOfLoopsToRecord > 0) {
        await renderLoopRecordingOffline(numberOfLoopsToRecord);
    } else {
        recordingTimerIntervalId = setInterval(() => updateRecordingDurationDisplay(millis() - recordingStartTimestamp, null), 100);
    }
}

/**
 * 録画を停止する関数 (指定ループ数録画の途中で呼ぶと、そこまでで打ち切って保存する)
 */
function stopRecordingPipeline() {
    if (!isRecordingActive || !recordingSession) return;
    if (targetRecordingLoopCount > 0) {
        recordingSession.isCancelled = true;
        return;
    }
    finishRecordingSession();
}

/**
 * 使えるコーデックを優先順に探す関数
 */
async function selectSupportedRecordingCodec(videoWidth, videoHeight) {
    for (const candidate of RECORDING_CODEC_CANDIDATES) {
        const config = buildEncoderConfig(candidate, videoWidth, videoHeight);
        try {
            const support = await VideoEncoder.isConfigSupported(config);
            if (support.supported) return candidate;
        } catch (error) {
            // 不正なコーデック文字列として扱われた場合は次の候補へ
        }
    }
    return null;
}

/**
 * 音声を録れるか調べ、使える音声コーデックを優先順に探す関数 (録れないときは null)
 * @param {boolean} isOfflineRendering 指定ループ数録画かどうか
 */
async function selectSupportedAudioCodec(isOfflineRendering) {
    if (isPeelingAudioMuted) return null;
    if (typeof AudioEncoder === 'undefined') {
        console.warn("[Video Recorder] AudioEncoder が使えないため、音声なしで録画します。");
        return null;
    }
    let sampleRate = OFFLINE_AUDIO_SAMPLE_RATE;
    if (!isOfflineRendering) {
        if (!isAudioEngineStarted || Tone.context.state !== 'running' || typeof MediaStreamTrackProcessor === 'undefined') {
            console.warn("[Video Recorder] 音声エンジンが動いていないか MediaStreamTrackProcessor が使えないため、音声なしで録画します。");
            return null;
        }
        sampleRate = Tone.context.rawContext.sampleRate;
    }
    for (const candidate of RECORDING_AUDIO_CODEC_CANDIDATES) {
        const config = { codec: candidate.codec, sampleRate, numberOfChannels: RECORDING_AUDIO_CHANNELS, bitrate: RECORDING_AUDIO_BITRATE };
        try {
            const support = await AudioEncoder.isConfigSupported(config);
            if (support.supported) return { ...candidate, sampleRate, config };
        } catch (error) {
            // 不正なコーデック文字列として扱われた場合は次の候補へ
        }
    }
    console.warn(`[Video Recorder] ${sampleRate}Hz に対応する音声エンコーダが見つからないため、音声なしで録画します。`);
    return null;
}

function buildEncoderConfig(candidate, videoWidth, videoHeight) {
    const config = {
        codec: candidate.codec,
        width: videoWidth,
        height: videoHeight,
        bitrate: RECORDING_BITRATE,
        framerate: RECORDING_FRAME_RATE
    };
    if (candidate.muxerCodec === 'avc') config.avc = { format: 'avc' };
    return config;
}

/**
 * エンコーダと mp4 マルチプレクサを用意する関数
 */
function createRecordingSession(sourceCanvas, videoWidth, videoHeight, codecChoice, audioChoice) {
    const muxer = new Mp4Muxer.Muxer({
        target: new Mp4Muxer.ArrayBufferTarget(),
        video: { codec: codecChoice.muxerCodec, width: videoWidth, height: videoHeight, frameRate: RECORDING_FRAME_RATE },
        audio: audioChoice ? { codec: audioChoice.muxerCodec, sampleRate: audioChoice.sampleRate, numberOfChannels: RECORDING_AUDIO_CHANNELS } : undefined,
        fastStart: 'in-memory'
    });
    const frameDurationMicroseconds = 1e6 / RECORDING_FRAME_RATE;
    const encoder = new VideoEncoder({
        output: (chunk, metadata) => addEncodedChunkToMuxer(muxer, 'video', chunk, metadata, frameDurationMicroseconds),
        error: (error) => console.error("[Video Recorder] Encoding error: ", error)
    });
    encoder.configure(buildEncoderConfig(codecChoice, videoWidth, videoHeight));

    let audioEncoder = null;
    if (audioChoice) {
        const audioChunkDurationMicroseconds = audioChoice.samplesPerChunk / audioChoice.sampleRate * 1e6;
        audioEncoder = new AudioEncoder({
            output: (chunk, metadata) => addEncodedChunkToMuxer(muxer, 'audio', chunk, metadata, audioChunkDurationMicroseconds),
            error: (error) => console.error("[Video Recorder] Audio encoding error: ", error)
        });
        audioEncoder.configure(audioChoice.config);
    }

    // 偶数サイズへの切り詰めと、WebGL の描画バッファが消える前の取り込みを兼ねた作業用キャンバス
    const frameCanvas = document.createElement('canvas');
    frameCanvas.width = videoWidth;
    frameCanvas.height = videoHeight;

    return {
        sourceCanvas, frameCanvas, frameContext: frameCanvas.getContext('2d'),
        encoder, muxer, frameCount: 0, isCancelled: false, firstFrameTimestamp: null,
        audioEncoder, audioSampleRate: audioChoice?.sampleRate ?? null, audioCapture: null, audioFrameCursor: null,
        exportSize: { width: videoWidth, height: videoHeight }
    };
}

/**
 * エンコード済みの chunk を mp4-muxer に渡す関数
 * mp4-muxer は chunk の duration を必須とするが、ブラウザによっては入力の duration が chunk に引き継がれず null になるため、
 * その場合は fallbackDurationMicroseconds を渡す (chunk 間の長さはタイムスタンプ差から決まり、duration は最後の chunk の長さに使われる)
 * @param {'video'|'audio'} trackKind
 */
function addEncodedChunkToMuxer(muxer, trackKind, chunk, metadata, fallbackDurationMicroseconds) {
    if (chunk.duration !== null) {
        if (trackKind === 'video') muxer.addVideoChunk(chunk, metadata);
        else muxer.addAudioChunk(chunk, metadata);
        return;
    }
    const data = new Uint8Array(chunk.byteLength);
    chunk.copyTo(data);
    const duration = Math.round(fallbackDurationMicroseconds);
    if (trackKind === 'video') muxer.addVideoChunkRaw(data, chunk.type, chunk.timestamp, duration, metadata);
    else muxer.addAudioChunkRaw(data, chunk.type, chunk.timestamp, duration, metadata);
}

/**
 * チャンネルごとの音声サンプルを、映像の先頭からの通し位置の時刻で音声エンコーダへ送る関数
 * @param {Float32Array[]} channelSamples RECORDING_AUDIO_CHANNELS 個の同じ長さの配列
 */
function encodePlanarAudioSamples(session, channelSamples) {
    const numberOfFrames = channelSamples[0].length;
    if (numberOfFrames === 0) return;
    const planarData = new Float32Array(numberOfFrames * RECORDING_AUDIO_CHANNELS);
    channelSamples.forEach((samples, channelIndex) => planarData.set(samples, channelIndex * numberOfFrames));
    const audioData = new AudioData({
        format: 'f32-planar',
        sampleRate: session.audioSampleRate,
        numberOfFrames,
        numberOfChannels: RECORDING_AUDIO_CHANNELS,
        timestamp: Math.round(session.audioFrameCursor * 1e6 / session.audioSampleRate),
        data: planarData
    });
    session.audioEncoder.encode(audioData);
    audioData.close();
    session.audioFrameCursor += numberOfFrames;
}

/**
 * 手動録画で、Tone.js の出力を取り出して音声エンコーダへ送り続ける処理を始める関数
 */
function startRealtimeAudioCapture(session) {
    const streamDestination = Tone.context.rawContext.createMediaStreamDestination();
    Tone.Destination.connect(streamDestination);
    const track = streamDestination.stream.getAudioTracks()[0];
    const reader = new MediaStreamTrackProcessor({ track }).readable.getReader();
    session.audioCapture = { streamDestination, track, reader };

    (async () => {
        while (true) {
            const { value: audioData, done } = await reader.read();
            if (done) break;
            try {
                encodeCapturedAudioData(session, audioData);
            } finally {
                audioData.close();
            }
        }
    })().catch((error) => console.warn("[Video Recorder] Audio capture stopped: ", error));
}

function stopRealtimeAudioCapture(session) {
    const capture = session.audioCapture;
    if (!capture) return;
    session.audioCapture = null;
    capture.reader.cancel();
    capture.track.stop();
    Tone.Destination.disconnect(capture.streamDestination);
}

/**
 * 取り出した音声を、映像の先頭フレームを時刻 0 としてエンコーダへ送る関数
 */
function encodeCapturedAudioData(session, audioData) {
    // 停止後に届いた音と、映像の最初のフレームより前の音は捨てる
    if (!session.audioCapture || session.firstFrameTimestamp === null) return;
    if (audioData.sampleRate !== session.audioSampleRate) return;

    if (session.audioFrameCursor === null) {
        // 音は映像より少し遅れて届き始めるため、その分だけ先頭に無音を入れて映像と時刻をそろえる
        const startMilliseconds = millis() - session.firstFrameTimestamp - audioData.duration / 1000;
        if (startMilliseconds < 0) return;
        const silentFrameCount = Math.round(startMilliseconds / 1000 * session.audioSampleRate);
        session.audioFrameCursor = 0;
        encodePlanarAudioSamples(session, Array.from({ length: RECORDING_AUDIO_CHANNELS }, () => new Float32Array(silentFrameCount)));
    }

    const channelSamples = [];
    for (let channelIndex = 0; channelIndex < RECORDING_AUDIO_CHANNELS; channelIndex++) {
        const samples = new Float32Array(audioData.numberOfFrames);
        const sourcePlane = Math.min(channelIndex, audioData.numberOfChannels - 1);
        audioData.copyTo(samples, { planeIndex: sourcePlane, format: 'f32-planar' });
        channelSamples.push(samples);
    }
    encodePlanarAudioSamples(session, channelSamples);
}

/**
 * 指定ループ数録画で、描画した各フレームの時刻から効果音を生成してエンコーダへ送る関数
 * @param {number[]} sceneTimestamps 各フレームの描画時刻
 */
async function encodeOfflineAudio(session, sceneTimestamps) {
    console.log("[Video Recorder] Rendering audio offline...");
    const audioBuffer = await renderPeelingAudioOffline(sceneTimestamps, RECORDING_FRAME_RATE, session.audioSampleRate);
    const channels = Array.from({ length: RECORDING_AUDIO_CHANNELS },
        (_, channelIndex) => audioBuffer.getChannelData(Math.min(channelIndex, audioBuffer.numberOfChannels - 1)));
    session.audioFrameCursor = 0;
    for (let offset = 0; offset < audioBuffer.length; offset += OFFLINE_AUDIO_BLOCK_FRAMES) {
        encodePlanarAudioSamples(session, channels.map((samples) => samples.subarray(offset, offset + OFFLINE_AUDIO_BLOCK_FRAMES)));
        while (session.audioEncoder.encodeQueueSize > 8) {
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
    }
}

/**
 * 今のキャンバスの内容を1フレームとしてエンコーダへ送る関数
 * @param {number} timestampMicroseconds 動画内の時刻
 */
function encodeCurrentCanvasFrame(timestampMicroseconds) {
    const session = recordingSession;
    session.frameContext.drawImage(session.sourceCanvas, 0, 0);
    // duration は chunk に引き継がれ、mp4-muxer に渡される (addEncodedChunkToMuxer を参照)
    const frame = new VideoFrame(session.frameCanvas, {
        timestamp: Math.round(timestampMicroseconds),
        duration: Math.round(1e6 / RECORDING_FRAME_RATE)
    });
    session.encoder.encode(frame, { keyFrame: session.frameCount % RECORDING_KEYFRAME_INTERVAL === 0 });
    frame.close();
    session.frameCount += 1;
}

/**
 * 手動録画中に毎フレーム呼ばれる関数 (draw の描画直後)
 */
function captureRealtimeRecordingFrame() {
    if (!isRecordingActive || !recordingSession || targetRecordingLoopCount > 0) return;
    // エンコードが追いつかないときはフレームを捨てて描画を止めない
    if (recordingSession.encoder.encodeQueueSize > 8) return;
    // mp4 の先頭フレームは時刻 0 である必要があるため、最初に取り込んだフレームを基準にする
    const now = millis();
    if (recordingSession.firstFrameTimestamp === null) recordingSession.firstFrameTimestamp = now;
    encodeCurrentCanvasFrame((now - recordingSession.firstFrameTimestamp) * 1000);
}

/**
 * 指定ループ数を 1/60 秒刻みでオフライン描画して録画する関数
 */
async function renderLoopRecordingOffline(loopCount) {
    const session = recordingSession;
    const loopDuration = getLoopDurationMilliseconds();
    const recordingDuration = loopCount * loopDuration;
    // ループの長さが 1/60 秒の整数倍とは限らないため、フレーム数を丸めて時刻の刻みをわずかに合わせる
    const totalFrames = Math.max(1, Math.round(recordingDuration / 1000 * RECORDING_FRAME_RATE));
    const sceneStartTimestamp = millis();
    const videoDurationMilliseconds = totalFrames * 1000 / RECORDING_FRAME_RATE;
    const sceneTimestamps = [];

    noLoop();
    muteAudioForOfflineRendering();
    try {
        for (let frameIndex = 0; frameIndex < totalFrames && !session.isCancelled; frameIndex++) {
            offlineRenderTimestamp = sceneStartTimestamp + recordingDuration * frameIndex / totalFrames;
            redraw();
            encodeCurrentCanvasFrame(frameIndex * 1e6 / RECORDING_FRAME_RATE);
            sceneTimestamps.push(offlineRenderTimestamp);
            // エンコード待ちが溜まりすぎないようにし、合間に HUD を更新する
            while (session.encoder.encodeQueueSize > 4) {
                await new Promise((resolve) => setTimeout(resolve, 0));
            }
            if (frameIndex % 6 === 0) {
                updateRecordingDurationDisplay((frameIndex + 1) * 1000 / RECORDING_FRAME_RATE, videoDurationMilliseconds);
                await new Promise((resolve) => setTimeout(resolve, 0));
            }
        }
        updateRecordingDurationDisplay(session.frameCount * 1000 / RECORDING_FRAME_RATE, videoDurationMilliseconds);
        if (session.audioEncoder && sceneTimestamps.length > 0) {
            try {
                await encodeOfflineAudio(session, sceneTimestamps);
            } catch (error) {
                console.warn("[Video Recorder] Offline audio rendering failed: ", error);
            }
        }
    } finally {
        offlineRenderTimestamp = null;
        loop();
    }
    if (session.isCancelled) console.log(`[Video Recorder] Loop recording stopped at frame ${session.frameCount}/${totalFrames}.`);
    else console.log(`[Recorder] Exact ${loopCount} loops rendered (${totalFrames} frames).`);
    await finishRecordingSession();
}

function muteAudioForOfflineRendering() {
    if (peelingGain) peelingGain.gain.rampTo(0, 0.05);
}

/**
 * エンコードを締めくくり、mp4 と同名の設定 JSON をダウンロードする関数
 */
async function finishRecordingSession() {
    const session = recordingSession;
    if (!session) return;
    recordingSession = null;
    isRecordingActive = false;
    targetRecordingLoopCount = 0;
    if (recordingTimerIntervalId) {
        clearInterval(recordingTimerIntervalId);
        recordingTimerIntervalId = null;
    }
    showRecordingIndicator(false);

    console.log("[Video Recorder] Finalizing mp4...");
    stopRealtimeAudioCapture(session);
    await session.encoder.flush();
    session.encoder.close();
    if (session.audioEncoder) {
        await session.audioEncoder.flush();
        session.audioEncoder.close();
    }
    session.muxer.finalize();
    if (session.frameCount === 0) {
        console.warn("[Video Recorder] No frames were recorded.");
        return;
    }

    const videoBlob = new Blob([session.muxer.target.buffer], { type: 'video/mp4' });
    const baseFileName = `ApplePeelLoop_${getFormattedDate()}_${session.exportSize.width}x${session.exportSize.height}`;
    const downloadLinkAnchor = document.createElement('a');
    downloadLinkAnchor.href = URL.createObjectURL(videoBlob);
    downloadLinkAnchor.download = `${baseFileName}.mp4`;
    document.body.appendChild(downloadLinkAnchor);
    downloadLinkAnchor.click();
    document.body.removeChild(downloadLinkAnchor);
    setTimeout(() => URL.revokeObjectURL(downloadLinkAnchor.href), 10000);

    exportParametersToJsonFile(`${baseFileName}.json`);
    console.log(`[Video Recorder] Output complete: ${baseFileName}.mp4 (${session.frameCount} frames) & ${baseFileName}.json`);
}

function showRecordingIndicator(isVisible) {
    document.getElementById('recording-hud').classList.toggle('hidden', !isVisible);
    document.getElementById('record-start-button').disabled = isVisible;
    document.getElementById('record-n-loops-button').disabled = isVisible;
    document.getElementById('record-stop-button').disabled = !isVisible;
    if (isVisible) document.getElementById('recording-timer').innerText = formatRecordingTime(0);
}

function formatRecordingTime(milliseconds) {
    const minutes = Math.floor(milliseconds / 60000);
    const seconds = Math.floor((milliseconds % 60000) / 1000);
    const tenthsOfSecond = Math.floor((milliseconds % 1000) / 100);
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${tenthsOfSecond}`;
}

/**
 * 録画時間を HUD に表示する関数 (指定ループ数録画では「経過 / 終了時刻」の分数形式)
 * @param {number} elapsedMilliseconds 動画内の経過時間
 * @param {number|null} totalMilliseconds 終了時刻 (手動録画では null)
 */
function updateRecordingDurationDisplay(elapsedMilliseconds, totalMilliseconds) {
    const elapsedText = formatRecordingTime(Math.min(elapsedMilliseconds, totalMilliseconds ?? Infinity));
    document.getElementById('recording-timer').innerText = totalMilliseconds === null
        ? elapsedText
        : `${elapsedText} / ${formatRecordingTime(totalMilliseconds)}`;
}
