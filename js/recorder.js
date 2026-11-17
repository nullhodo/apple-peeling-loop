/* ==========================================================================
   60FPS HIGH-BITRATE VIDEO RECORDING PIPELINE
   ========================================================================== */
/**
 * キャンバスストリームから60fps高ビットレート録画を開始する関数
 * @param {number} numberOfLoopsToRecord 指定ループ数 (0なら手動停止まで無制限)
 */
function startRecordingPipeline(numberOfLoopsToRecord = 0) {
    if (isRecordingActive) return;

    console.log("[Video Recorder] Initializing 60fps MediaRecorder stream...");
    const primaryHtmlCanvas = document.querySelector('#canvas-container canvas');
    if (!primaryHtmlCanvas) {
        console.error("[Video Recorder] Canvas element not found.");
        return;
    }

    const canvasMediaStream = primaryHtmlCanvas.captureStream(60); // 60 FPS
    recordedVideoDataChunks = [];
    targetRecordingLoopCount = numberOfLoopsToRecord;

    // 高画質ビットレート (16Mbps)
    const mediaRecorderOptions = {
        mimeType: MediaRecorder.isTypeSupported('video/webm;codecs=vp9') 
            ? 'video/webm;codecs=vp9' 
            : (MediaRecorder.isTypeSupported('video/mp4') ? 'video/mp4' : 'video/webm'),
        videoBitsPerSecond: 16000000 // 16 Mbps
    };

    try {
        mediaStreamRecorder = new MediaRecorder(canvasMediaStream, mediaRecorderOptions);
    } catch (recorderError) {
        console.warn("[Video Recorder] Fallback to standard codec: ", recorderError);
        mediaStreamRecorder = new MediaRecorder(canvasMediaStream);
    }

    mediaStreamRecorder.ondataavailable = function (event) {
        if (event.data && event.data.size > 0) {
            recordedVideoDataChunks.push(event.data);
        }
    };

    mediaStreamRecorder.onstop = function () {
        finalizeAndDownloadRecordedVideo();
    };

    mediaStreamRecorder.start(100); // 100msごとにチャンク取得
    isRecordingActive = true;
    recordingStartTimestamp = millis();

    // UI状態更新
    document.getElementById('recording-hud').classList.remove('hidden');
    document.getElementById('record-start-button').disabled = true;
    document.getElementById('record-stop-button').disabled = false;

    // 録画経過時間タイマーの開始
    recordingTimerIntervalId = setInterval(updateRecordingDurationDisplay, 100);
    console.log(`[Video Recorder] Recording started (${mediaRecorderOptions.mimeType}, 16Mbps).`);
}

/**
 * 録画を停止する関数
 */
function stopRecordingPipeline() {
    if (!isRecordingActive || !mediaStreamRecorder) return;
    console.log("[Video Recorder] Stopping recording stream...");
    mediaStreamRecorder.stop();
    isRecordingActive = false;
    targetRecordingLoopCount = 0;

    if (recordingTimerIntervalId) {
        clearInterval(recordingTimerIntervalId);
        recordingTimerIntervalId = null;
    }

    document.getElementById('recording-hud').classList.add('hidden');
    document.getElementById('record-start-button').disabled = false;
    document.getElementById('record-stop-button').disabled = true;
}

/**
 * 録画されたビデオデータをBlobに結合し、同名JSONとともにダウンロードする関数
 */
function finalizeAndDownloadRecordedVideo() {
    console.log("[Video Recorder] Packaging recorded video chunks...");
    const mimeType = mediaStreamRecorder.mimeType || 'video/webm';
    const videoBlob = new Blob(recordedVideoDataChunks, { type: mimeType });
    const fileExtension = mimeType.includes('mp4') ? 'mp4' : 'webm';
    const formattedDateString = getFormattedDate();
    const exportFileName = `ApplePeelLoop_${formattedDateString}_${width}x${height}.${fileExtension}`;

    // 動画ファイルのダウンロード
    const downloadLinkAnchor = document.createElement('a');
    downloadLinkAnchor.href = URL.createObjectURL(videoBlob);
    downloadLinkAnchor.download = exportFileName;
    document.body.appendChild(downloadLinkAnchor);
    downloadLinkAnchor.click();
    document.body.removeChild(downloadLinkAnchor);

    // 同名設定JSONファイルの出力
    const jsonFileName = `ApplePeelLoop_${formattedDateString}_${width}x${height}.json`;
    exportParametersToJsonFile(jsonFileName);

    console.log(`[Video Recorder] Output complete: ${exportFileName} & ${jsonFileName}`);
}

/**
 * 録画中の経過秒数タイマーをUIに更新表示する関数
 */
function updateRecordingDurationDisplay() {
    const elapsedTimeMilliseconds = millis() - recordingStartTimestamp;
    const minutes = Math.floor(elapsedTimeMilliseconds / 60000);
    const seconds = Math.floor((elapsedTimeMilliseconds % 60000) / 1000);
    const tenthsOfSecond = Math.floor((elapsedTimeMilliseconds % 1000) / 100);

    const timerString = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${tenthsOfSecond}`;
    document.getElementById('recording-timer').innerText = timerString;
}
