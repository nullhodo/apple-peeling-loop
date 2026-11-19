/* ==========================================================================
   60FPS MP4 VIDEO RECORDING PIPELINE (WebCodecs + mp4-muxer)
   ========================================================================== */
/*
 * キャンバスのフレームを WebCodecs の VideoEncoder でエンコードし、mp4-muxer で mp4 にまとめる。
 * - 手動録画: 描画のたびにフレームを実時間のタイムスタンプで送る
 * - 指定ループ数録画: 描画ループを止め、1/60 秒刻みの時刻で描画してはエンコードする (オフライン描画)。
 *   コマ落ちがなく、ちょうど N ループ分の長さで最初と最後がつながる
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

    isRecordingActive = true;
    targetRecordingLoopCount = numberOfLoopsToRecord;
    recordingSession = createRecordingSession(sourceCanvas, videoWidth, videoHeight, codecChoice);
    recordingStartTimestamp = millis();
    showRecordingIndicator(true);
    console.log(`[Video Recorder] Recording started (${codecChoice.label} ${codecChoice.codec}, ${videoWidth}x${videoHeight}, mp4).`);

    if (numberOfLoopsToRecord > 0) {
        await renderLoopRecordingOffline(numberOfLoopsToRecord);
    } else {
        recordingTimerIntervalId = setInterval(() => updateRecordingDurationDisplay(millis() - recordingStartTimestamp), 100);
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
function createRecordingSession(sourceCanvas, videoWidth, videoHeight, codecChoice) {
    const muxer = new Mp4Muxer.Muxer({
        target: new Mp4Muxer.ArrayBufferTarget(),
        video: { codec: codecChoice.muxerCodec, width: videoWidth, height: videoHeight, frameRate: RECORDING_FRAME_RATE },
        fastStart: 'in-memory'
    });
    const encoder = new VideoEncoder({
        output: (chunk, metadata) => muxer.addVideoChunk(chunk, metadata),
        error: (error) => console.error("[Video Recorder] Encoding error: ", error)
    });
    encoder.configure(buildEncoderConfig(codecChoice, videoWidth, videoHeight));

    // 偶数サイズへの切り詰めと、WebGL の描画バッファが消える前の取り込みを兼ねた作業用キャンバス
    const frameCanvas = document.createElement('canvas');
    frameCanvas.width = videoWidth;
    frameCanvas.height = videoHeight;

    return {
        sourceCanvas, frameCanvas, frameContext: frameCanvas.getContext('2d'),
        encoder, muxer, frameCount: 0, isCancelled: false, firstFrameTimestamp: null,
        exportSize: { width: videoWidth, height: videoHeight }
    };
}

/**
 * 今のキャンバスの内容を1フレームとしてエンコーダへ送る関数
 * @param {number} timestampMicroseconds 動画内の時刻
 */
function encodeCurrentCanvasFrame(timestampMicroseconds) {
    const session = recordingSession;
    session.frameContext.drawImage(session.sourceCanvas, 0, 0);
    const frame = new VideoFrame(session.frameCanvas, { timestamp: Math.round(timestampMicroseconds) });
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

    noLoop();
    muteAudioForOfflineRendering();
    try {
        for (let frameIndex = 0; frameIndex < totalFrames && !session.isCancelled; frameIndex++) {
            offlineRenderTimestamp = sceneStartTimestamp + recordingDuration * frameIndex / totalFrames;
            redraw();
            encodeCurrentCanvasFrame(frameIndex * 1e6 / RECORDING_FRAME_RATE);
            // エンコード待ちが溜まりすぎないようにし、合間に HUD を更新する
            while (session.encoder.encodeQueueSize > 4) {
                await new Promise((resolve) => setTimeout(resolve, 0));
            }
            if (frameIndex % 6 === 0) {
                updateRecordingDurationDisplay((frameIndex + 1) * 1000 / RECORDING_FRAME_RATE);
                await new Promise((resolve) => setTimeout(resolve, 0));
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
    await session.encoder.flush();
    session.encoder.close();
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
 * 録画時間を HUD に表示する関数
 * @param {number} elapsedMilliseconds 動画内の経過時間
 */
function updateRecordingDurationDisplay(elapsedMilliseconds) {
    document.getElementById('recording-timer').innerText = formatRecordingTime(elapsedMilliseconds);
}
