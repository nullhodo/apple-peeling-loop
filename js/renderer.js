/* ==========================================================================
   RECURSIVE APPLE & PEEL RENDERING PIPELINE
   ========================================================================== */
const APPLE_BASE_RADIUS = 140;
// 半周期のうち剥離に使う割合 (残りは剥けた皮が落下し、ナイフが頂部へ戻るリリース区間)
const PEEL_PORTION_OF_HALF_PHASE = 0.84;

function clamp01(value) { return Math.min(1, Math.max(0, value)); }
function smoothStep(edge0, edge1, value) {
    const t = clamp01((value - edge0) / (edge1 - edge0));
    return t * t * (3 - 2 * t);
}
/** 3次エルミート補間 (両端の位置と速度を指定) */
function hermiteInterpolate(start, end, startVelocity, endVelocity, t) {
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * start + (t3 - 2 * t2 + t) * startVelocity
        + (-2 * t3 + 3 * t2) * end + (t3 - t2) * endVelocity;
}

/**
 * 1ループ (外皮 + 果肉の2回の剥離) の周期を、巻き数とナイフの速さから求める関数
 * ナイフは1回の剥離で τ = -1 〜 K-1 の K 周を回り、半周期のうち PEEL_PORTION_OF_HALF_PHASE を剥離に使う
 */
function getLoopDurationMilliseconds() {
    const turnsPerSecond = Math.max(0.05, sketchParameters.knifeTurnsPerSecond);
    const peelSeconds = sketchParameters.spiralTurnCount / turnsPerSecond;
    return 2 * peelSeconds / PEEL_PORTION_OF_HALF_PHASE * 1000;
}

/**
 * 時刻からループ位相 (0-1) を求める関数
 * 速さや巻き数の変更で周期が変わっても、その瞬間の位相を保つよう時刻オフセットを付け替える
 */
function computeLoopPhase(timeMilliseconds) {
    const duration = getLoopDurationMilliseconds();
    const wrap = (time, period) => (((time % period) + period) % period) / period;
    if (loopClockDurationMilliseconds !== null && loopClockDurationMilliseconds !== duration) {
        const currentPhase = wrap(timeMilliseconds + loopClockOffsetMilliseconds, loopClockDurationMilliseconds);
        loopClockOffsetMilliseconds = currentPhase * duration - timeMilliseconds;
    }
    loopClockDurationMilliseconds = duration;
    return wrap(timeMilliseconds + loopClockOffsetMilliseconds, duration);
}

/**
 * 時刻から描画状態 (剥離進行度・ナイフ位置・スケール等) を算出する関数
 * @param {number} timeMilliseconds
 */
function computePeelSceneState(timeMilliseconds) {
    const loopPhase = computeLoopPhase(timeMilliseconds);
    const isFleshPeel = loopPhase >= 0.5;
    const localPhase = isFleshPeel ? (loopPhase - 0.5) * 2.0 : loopPhase * 2.0;

    const turnCount = sketchParameters.spiralTurnCount;
    const latitudeStep = 1 / Math.max(1, turnCount - 1);
    const peelProgress = clamp01(localPhase / PEEL_PORTION_OF_HALF_PHASE);
    const releaseProgress = clamp01((localPhase - PEEL_PORTION_OF_HALF_PHASE) / (1 - PEEL_PORTION_OF_HALF_PHASE));
    const knifeTau = convertPeelProgressToTau(getSpiralBandMesh(turnCount), peelProgress);

    // ナイフ位置: 剥離中は現在の帯の中央、リリース中は外側へ浮きながら頂部へ戻る
    const bandMidLatitude = (tau) => (bandLatitude(tau, 0, latitudeStep) + bandLatitude(tau, 1, latitudeStep)) * 0.5;
    let knifeLatitude;
    let knifeLongitude;
    let knifeLift = 0;
    if (releaseProgress <= 0) {
        knifeLatitude = bandMidLatitude(knifeTau);
        knifeLongitude = knifeTau * TWO_PI;
    } else {
        // 経度は剥離時の角速度を保ったまま次周期の開始角 (2π の整数倍) へ滑らかに接続する
        const mesh = getSpiralBandMesh(turnCount);
        const lastStep = mesh.tauValues[mesh.sampleCount - 1] - mesh.tauValues[mesh.sampleCount - 2];
        const lastArcStep = mesh.cumulativeArc[mesh.sampleCount - 1] - mesh.cumulativeArc[mesh.sampleCount - 2];
        const tauPerProgress = lastStep / lastArcStep * mesh.cumulativeArc[mesh.sampleCount - 1];
        const angularVelocity = TWO_PI * tauPerProgress * (1 - PEEL_PORTION_OF_HALF_PHASE) / PEEL_PORTION_OF_HALF_PHASE;
        const endLongitude = (turnCount - 1) * TWO_PI;
        let extraTurns = Math.ceil(turnCount - 1 - 1e-6) - (turnCount - 1);
        while (extraTurns * TWO_PI < angularVelocity * 0.75) extraTurns += 1;
        knifeLongitude = hermiteInterpolate(endLongitude, endLongitude + extraTurns * TWO_PI, angularVelocity, angularVelocity, releaseProgress);
        knifeLatitude = hermiteInterpolate(1, 0, 0, 0, releaseProgress);
        knifeLift = Math.sin(Math.PI * releaseProgress) * APPLE_BASE_RADIUS * 0.45;
    }

    return {
        loopPhase,
        isFleshPeel,
        localPhase,
        peelProgress,
        releaseProgress,
        turnCount,
        latitudeStep,
        knifeTau,
        knifeLatitude,
        knifeLongitude,
        knifeLift,
        // 剥いた厚みと釣り合う微小スケール拡大 (剥離完了時に元の半径へ戻りシームレスに循環)
        balancedScale: 1.0 / (1.0 - sketchParameters.peelThicknessRatio * peelProgress)
    };
}

/**
 * ライティング・視点制御を含むシーン全体を描画する関数
 * @param {p5|p5.Graphics} g 描画先 (メインキャンバスまたはオフスクリーンWEBGLバッファ)
 * @param {object} state computePeelSceneState の戻り値
 * @param {number} timeMilliseconds 自動回転用の時刻
 * @param {number} viewportHeight 構図の基準とする描画先の高さ
 */
function renderAppleScene(g, state, timeMilliseconds, viewportWidth, viewportHeight) {
    // テクスチャ座標は (u = 周回 τ, v = 緯度) の正規化値で与える (横方向は1周ごとに繰り返す)
    g.textureMode(NORMAL);
    g.textureWrap(REPEAT, REPEAT);

    // ライティング環境 (柔らかなスタジオライティング)
    g.ambientLight(...toneForColorScheme(105, 105, 112));
    g.directionalLight(...toneForColorScheme(255, 248, 236), 0.55, 0.65, -0.55);
    g.directionalLight(...toneForColorScheme(70, 85, 120), -0.7, -0.4, 0.4);
    g.pointLight(...toneForColorScheme(120, 110, 100), 0, -300, 400);

    g.push();
    // 描画先のサイズに合わせて構図を一定に保つ
    const fitScale = Math.min(viewportWidth, viewportHeight) / 760;
    g.scale(fitScale);

    if (sketchParameters.knifeMotionMode === "fixed") {
        // --- ナイフ固定モード (リンゴ側が自転・昇降してナイフに送られる) ---
        const contactHeight = appleUnitPoint(state.knifeLatitude, 0)[1] * APPLE_BASE_RADIUS * state.balancedScale;
        // 右手で剥く構図: ナイフをりんごの右側に置き、切れ刃が手前のやや内側を向くようにする
        // (螺旋の進行方向をそのまま回すと刃が奥を向くため、左右反転して巻き方向を逆にする)
        g.rotateX(-0.32);
        g.scale(-1, 1, 1);
        g.rotateY(-1.2);
        g.translate(0, -contactHeight - APPLE_BASE_RADIUS * 0.15, 0);
        g.rotateY(-state.knifeLongitude);
    } else {
        // --- ナイフ移動モード (リンゴは自転し、ナイフが周囲を巡る) ---
        const sceneRotationAngle = timeMilliseconds * 0.0006 * sketchParameters.autoRotationSpeed;
        g.translate(0, -APPLE_BASE_RADIUS * 0.3, 0);
        g.rotateX(-0.30); // 緩やかな見下ろし角 (先に傾けてから自転させ、軸がぶれないようにする)
        g.rotateY(sceneRotationAngle);
    }

    g.push();
    g.scale(state.balancedScale);
    renderRecursiveAppleEntity(g, state);
    g.pop();

    g.pop();
}

/**
 * 再帰りんご本体、螺旋リボン、ナイフを描画する関数
 */
function renderRecursiveAppleEntity(g, state) {
    const appleBaseRadius = APPLE_BASE_RADIUS;
    const peelThickness = appleBaseRadius * sketchParameters.peelThicknessRatio;
    const mesh = getSpiralBandMesh(state.turnCount);

    // テクスチャの選択 (フェーズごとに表裏が循環反転)
    const surfaceOuterTexture = state.isFleshPeel ? appleFleshProceduralTexture : appleSkinProceduralTexture;
    const subsurfaceTexture = state.isFleshPeel ? appleSkinProceduralTexture : appleFleshProceduralTexture;

    g.noStroke();

    // --- A. りんご本体: 未剥離の外皮 (τ ≥ τk) と剥離済みの内層 (τ ≤ τk) ---
    renderSpiralBandSurface(g, mesh, state.knifeTau, mesh.tauEnd, appleBaseRadius, surfaceOuterTexture);
    renderSpiralBandSurface(g, mesh, mesh.tauStart, state.knifeTau, appleBaseRadius - peelThickness, subsurfaceTexture);

    // --- B. 切削段差の断面 (ナイフ位置の切り口と、ひとつ上の周回との境界) ---
    renderPeelStepWalls(g, mesh, state.knifeTau, appleBaseRadius, peelThickness, appleFleshProceduralTexture);

    // --- C. 剥がれて垂れ下がる皮のリボン ---
    renderPeelingRibbonStrip(g, mesh, state, appleBaseRadius, surfaceOuterTexture, subsurfaceTexture);

    // --- D. 果物ナイフ ---
    renderPeelingKnife(g, state, appleBaseRadius, peelThickness);

    // --- E. りんごの軸 / ヘタ (Stem) ---
    renderAppleStem(g, appleBaseRadius);
}

/**
 * メッシュ上の τ に対応するサンプル (補間) を返す関数
 */
function sampleSpiralBandRow(mesh, row, tau) {
    const position = (tau - mesh.tauStart) / (mesh.tauEnd - mesh.tauStart) * (mesh.sampleCount - 1);
    const index = Math.min(mesh.sampleCount - 2, Math.max(0, Math.floor(position)));
    const t = Math.min(1, Math.max(0, position - index));
    return {
        position: vec3Lerp(row.positions[index], row.positions[index + 1], t),
        normal: vec3Normalize(vec3Lerp(row.normals[index], row.normals[index + 1], t)),
        latitude: row.latitudes[index] + (row.latitudes[index + 1] - row.latitudes[index]) * t
    };
}

/**
 * τ 範囲内のメッシュサンプル列 (端点は補間して正確に一致させる) を列挙する関数
 */
function collectSpiralSamples(mesh, tauFrom, tauTo) {
    const samples = [];
    if (tauTo - tauFrom <= 1e-6) return samples;
    const step = (mesh.tauEnd - mesh.tauStart) / (mesh.sampleCount - 1);
    samples.push({ tau: tauFrom, index: -1 });
    const firstIndex = Math.floor((tauFrom - mesh.tauStart) / step) + 1;
    for (let index = Math.max(0, firstIndex); index < mesh.sampleCount; index++) {
        const tau = mesh.tauValues[index];
        if (tau >= tauTo - 1e-6) break;
        if (tau > tauFrom + 1e-6) samples.push({ tau, index });
    }
    samples.push({ tau: tauTo, index: -1 });
    return samples;
}

function readSpiralSample(mesh, row, sample) {
    if (sample.index >= 0) {
        return { position: row.positions[sample.index], normal: row.normals[sample.index], latitude: row.latitudes[sample.index] };
    }
    return sampleSpiralBandRow(mesh, row, sample.tau);
}

/**
 * テクスチャと材質 (艶) を設定する関数
 * 果皮はロウ質の鋭い艶、果肉は水分による柔らかい艶を持たせる
 */
function applyAppleSurfaceMaterial(g, surfaceTexture) {
    g.texture(surfaceTexture);
    if (surfaceTexture === appleSkinProceduralTexture) {
        g.specularMaterial(...toneForColorScheme(110, 105, 100));
        g.shininess(38);
    } else {
        g.specularMaterial(...toneForColorScheme(70, 70, 62));
        g.shininess(14);
    }
}

/**
 * 螺旋帯メッシュの一部 (τ 範囲) を指定半径で描画する関数
 */
function renderSpiralBandSurface(g, mesh, tauFrom, tauTo, radius, surfaceTexture) {
    const samples = collectSpiralSamples(mesh, tauFrom, tauTo);
    if (samples.length < 2) return;

    applyAppleSurfaceMaterial(g, surfaceTexture);
    for (let rowIndex = 0; rowIndex < mesh.rows.length - 1; rowIndex++) {
        const lowerRow = mesh.rows[rowIndex];
        const upperRow = mesh.rows[rowIndex + 1];
        g.beginShape(TRIANGLE_STRIP);
        for (const sample of samples) {
            const lower = readSpiralSample(mesh, lowerRow, sample);
            const upper = readSpiralSample(mesh, upperRow, sample);
            g.normal(lower.normal[0], lower.normal[1], lower.normal[2]);
            g.vertex(lower.position[0] * radius, lower.position[1] * radius, lower.position[2] * radius, sample.tau, lower.latitude);
            g.normal(upper.normal[0], upper.normal[1], upper.normal[2]);
            g.vertex(upper.position[0] * radius, upper.position[1] * radius, upper.position[2] * radius, sample.tau, upper.latitude);
        }
        g.endShape();
        renderedVertexCount += samples.length * 2;
    }
}

/**
 * 外皮と内層の段差 (切り口の断面) を描画する関数
 */
function renderPeelStepWalls(g, mesh, knifeTau, outerRadius, thickness, wallTexture) {
    if (knifeTau <= mesh.tauStart + 1e-4 || knifeTau >= mesh.tauEnd - 1e-4) return;
    const innerRadius = outerRadius - thickness;
    applyAppleSurfaceMaterial(g, wallTexture);

    // 1. ナイフ位置の切り口 (帯を横切る断面)
    const aheadTau = Math.min(mesh.tauEnd, knifeTau + 0.01);
    g.beginShape(TRIANGLE_STRIP);
    for (const row of mesh.rows) {
        const here = sampleSpiralBandRow(mesh, row, knifeTau);
        const ahead = sampleSpiralBandRow(mesh, row, aheadTau);
        const wallNormal = vec3Normalize(vec3Sub(here.position, ahead.position), here.normal);
        g.normal(wallNormal[0], wallNormal[1], wallNormal[2]);
        g.vertex(here.position[0] * outerRadius, here.position[1] * outerRadius, here.position[2] * outerRadius, knifeTau, here.latitude);
        g.vertex(here.position[0] * innerRadius, here.position[1] * innerRadius, here.position[2] * innerRadius, knifeTau, here.latitude + 0.01);
    }
    g.endShape();

    // 2. ひとつ上の周回 (剥離済み) との境界に沿った螺旋状の段差
    const topRow = mesh.rows[mesh.rows.length - 1];
    const belowTopRow = mesh.rows[mesh.rows.length - 2];
    const samples = collectSpiralSamples(mesh, knifeTau, Math.min(mesh.tauEnd, knifeTau + 1));
    g.beginShape(TRIANGLE_STRIP);
    for (const sample of samples) {
        const top = readSpiralSample(mesh, topRow, sample);
        const below = readSpiralSample(mesh, belowTopRow, sample);
        const wallNormal = vec3Normalize(vec3Sub(top.position, below.position), top.normal);
        g.normal(wallNormal[0], wallNormal[1], wallNormal[2]);
        g.vertex(top.position[0] * outerRadius, top.position[1] * outerRadius, top.position[2] * outerRadius, sample.tau, top.latitude);
        g.vertex(top.position[0] * innerRadius, top.position[1] * innerRadius, top.position[2] * innerRadius, sample.tau, top.latitude + 0.01);
    }
    g.endShape();
    renderedVertexCount += mesh.rows.length * 2 + samples.length * 2;
}

/**
 * 剥がれた皮のリボンを描画する関数
 * 刃先では剥離帯と完全に一致し、離れるにつれて曲面から浮き上がり、
 * ナイフの下へ螺旋状に垂れ下がる (剥き終わるとリリース区間で落下して消える)
 */
function renderPeelingRibbonStrip(g, mesh, state, appleBaseRadius, outerTexture, innerTexture) {
    if (state.knifeTau <= mesh.tauStart + 0.02) return;

    const releaseFade = 1 - smoothStep(0.45, 1.0, state.releaseProgress);
    if (releaseFade <= 0.001) return;

    const curlIntensity = sketchParameters.peelCurlCurvature;
    const widthFactor = 0.35 + clamp01((sketchParameters.peelRibbonWidth - 0.10) / 0.45) * 0.65;
    const bandWidthPixels = state.latitudeStep * Math.PI * appleBaseRadius * 1.05;
    const coilWidth = bandWidthPixels * widthFactor;
    const coilGap = 4 + 3 * curlIntensity;
    const cupDepth = 3 * curlIntensity;
    // カールが強いほど垂れ下がる螺旋の半径が小さく巻きがきつくなる
    const coilRadius = appleBaseRadius * 0.5 / (0.6 + 0.35 * curlIntensity);
    const detachTurns = 0.3;

    // 垂れ下がりの起点 = ナイフ位置 (剥き終わり後はその位置で固定し、そこから落下させる)
    const anchorTau = Math.min(state.knifeTau, mesh.tauEnd);
    const anchorLatitude = (bandLatitude(anchorTau, 0, state.latitudeStep) + bandLatitude(anchorTau, 1, state.latitudeStep)) * 0.5;
    const anchorHeight = appleUnitPoint(anchorLatitude, 0)[1] * appleBaseRadius;
    const anchorLongitude = anchorTau * TWO_PI;
    const outward = [Math.sin(anchorLongitude), 0, Math.cos(anchorLongitude)];
    const forward = [Math.cos(anchorLongitude), 0, -Math.sin(anchorLongitude)]; // 経度が増える (刃が進む) 向き
    const fallDrop = state.releaseProgress * state.releaseProgress * appleBaseRadius * 4.5;
    const fallSpread = 1 + state.releaseProgress * 0.3;

    const samples = collectSpiralSamples(mesh, mesh.tauStart, anchorTau);
    if (samples.length < 2) return;

    // 垂れ下がりの高さ: 各点はそれより先 (下) にぶら下がる皮の重さで引き伸ばされるため、
    // ナイフに近い上側ほどピッチが広く、自由端ほど巻きが詰まる。皮ごとのばらつきも加えて積分する
    const totalTurns = Math.max(anchorTau - mesh.tauStart, 1e-3);

    // 帯は元の緯度線の測地曲率 κg (面内の曲がり) を保ったまま、自然な反り (法曲率 1/ρ0) で丸まる。
    // 円錐台に巻き付くと 1/ρ² = 1/ρ0² + κg²、開き角 tanφ = κg·ρ0 となるため、
    // 赤道付近は円筒状、ヘタ側とお尻側は互いに逆向きに開いた平らな渦巻きになる
    const coilShapes = samples.map((sample) => {
        const turnsBehind = anchorTau - sample.tau;
        const turnsFromFreeEnd = sample.tau - mesh.tauStart;
        const centerLatitude = (bandLatitude(sample.tau, 0, state.latitudeStep) + bandLatitude(sample.tau, 1, state.latitudeStep)) * 0.5;
        const geodesicCurvature = getAppleGeodesicCurvature(centerLatitude) / appleBaseRadius;
        // 自然な半径は皮ごとにばらつき、自由端へ向かって緩んで広がる
        const looseness = 1 + 0.35 * smoothStep(0.0, 1.0, turnsBehind / Math.max(totalTurns, 2));
        const naturalRadius = coilRadius * (0.3 + 0.7 * smoothStep(0.0, 1.2, turnsBehind))
            * (1 + 0.22 * peelMaterialNoise(sample.tau, 1)) * looseness;
        // 剥き始め (りんごの頂部) の先端は細い
        const stripWidth = coilWidth * (0.45 + 0.55 * smoothStep(0.0, 0.8, turnsFromFreeEnd));
        // 正の κg はヘタ側の辺 (v=1) が短いことを表し、その辺を螺旋の内側 (小さい半径) へ向ける
        const flareAngle = -Math.atan(geodesicCurvature * naturalRadius) + 0.12 * peelMaterialNoise(sample.tau, 3);
        const radius = Math.max(
            1 / Math.hypot(1 / naturalRadius, geodesicCurvature),
            stripWidth * 0.5 * Math.abs(Math.sin(flareAngle)) + 2
        );
        return { radius, flareAngle, stripWidth };
    });

    const hangHeights = new Float32Array(samples.length);
    for (let sampleIndex = samples.length - 2; sampleIndex >= 0; sampleIndex--) {
        const tau = samples[sampleIndex].tau;
        const turnsBehind = anchorTau - tau;
        const tension = (totalTurns - turnsBehind) / Math.max(totalTurns, 1);
        const shape = coilShapes[sampleIndex];
        // 巻き同士がほぼ接する自然長 (平らに開いた部分は巻きが重ならず横に並ぶため短い)
        const restPitch = shape.stripWidth * Math.abs(Math.cos(shape.flareAngle)) * 1.02 + 3;
        const pitch = restPitch * (1 + 0.12 * peelMaterialNoise(tau, 2)) * (1 + 0.55 * tension);
        hangHeights[sampleIndex] = hangHeights[sampleIndex + 1] + pitch * (samples[sampleIndex + 1].tau - tau);
    }
    // 下ほど刃の進行の後ろへ遅れて傾き、ループ周期に同期してゆっくり揺れる
    const swingPhase = state.loopPhase * TWO_PI * 2;

    const rowCount = mesh.rows.length;
    const grid = []; // grid[sample][row] = {position, latitude}
    for (let sampleIndex = 0; sampleIndex < samples.length; sampleIndex++) {
        const sample = samples[sampleIndex];
        const turnsBehind = anchorTau - sample.tau;
        const { radius: growingCoilRadius, flareAngle, stripWidth } = coilShapes[sampleIndex];
        const detach = smoothStep(0.0, detachTurns, turnsBehind);
        // ナイフ位置から刃の後方へ巻きながら垂れ下がる螺旋 (軸はナイフ側に寄り、りんごの外側に沿う)
        const coilAngle = turnsBehind * TWO_PI;
        // 刃の直後は重力でまっすぐ垂れ、離れるほど螺旋の半径が育つ
        const initialDrop = appleBaseRadius * 0.55 * (1 - Math.exp(-turnsBehind / 0.35));
        const hangDepth = hangHeights[sampleIndex] + initialDrop;
        const coilCenterHeight = anchorHeight + hangDepth;
        const radialUnit = vec3Add(vec3Scale(outward, Math.cos(coilAngle)), vec3Scale(forward, Math.sin(coilAngle)));
        // 巻きの断面をわずかに楕円にし、向きも皮ごとに変える
        const ovality = 1 + 0.14 * Math.sin(2 * coilAngle + 2.5 * peelMaterialNoise(sample.tau, 4));
        // 螺旋軸の位置は帯の幅全体で共通 (帯がかかる高さ範囲でのりんごの最大半径の外側)
        const halfSpan = stripWidth * 0.5;
        let appleRadiusAround = 0;
        for (const offset of [-halfSpan, 0, halfSpan]) {
            appleRadiusAround = Math.max(appleRadiusAround, getAppleUnitRadiusAtHeight((coilCenterHeight + offset) / appleBaseRadius));
        }
        const axisDistance = appleRadiusAround * appleBaseRadius + growingCoilRadius + coilGap;
        // 軸の曲がり: 深いほど後方へ遅れ、揺れも大きい
        const depthRatio = clamp01(hangDepth / (appleBaseRadius * 2.6));
        const trail = -appleBaseRadius * 0.24 * Math.pow(depthRatio, 1.3);
        const swing = appleBaseRadius * 0.13 * depthRatio * depthRatio;
        const axisOffset = vec3Add(
            vec3Scale(forward, trail + swing * Math.sin(swingPhase - depthRatio * 2.2)),
            vec3Scale(outward, appleBaseRadius * 0.06 * depthRatio + swing * 0.5 * Math.cos(swingPhase - depthRatio * 2.2))
        );

        const column = [];
        for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
            const row = mesh.rows[rowIndex];
            const attached = readSpiralSample(mesh, row, sample);
            const attachedPoint = vec3Scale(attached.position, appleBaseRadius);

            // 帯の幅方向は開き角 φ で傾け、断面は外側へ反る
            const across = row.v - 0.5;
            const coilHeight = coilCenterHeight - across * stripWidth * Math.cos(flareAngle);
            const localRadius = growingCoilRadius * ovality + across * stripWidth * Math.sin(flareAngle) + cupDepth * (1 - 4 * across * across);
            const coilPoint = [
                outward[0] * axisDistance - radialUnit[0] * localRadius + axisOffset[0],
                coilHeight,
                outward[2] * axisDistance - radialUnit[2] * localRadius + axisOffset[2]
            ];

            // 円柱座標 (りんご中心軸まわりの角度・半径・高さ) で補間し、本体内部を横切らないようにする
            let point = interpolateCylindrical(attachedPoint, coilPoint, detach);

            // 刃先直後の浮き上がり (カール) と、本体へのめり込み防止 (りんご中心から放射方向へ押し出す)
            const lift = Math.sin(Math.PI * Math.min(1, turnsBehind / detachTurns)) * (3 + 5 * curlIntensity);
            const horizontalRadius = Math.hypot(point[0], point[2]);
            if (horizontalRadius > 1e-6) {
                const liftScale = (horizontalRadius + lift) / horizontalRadius;
                point[0] *= liftScale;
                point[2] *= liftScale;
            }
            point = pushPointOutsideApple(point, appleBaseRadius, 0.8 + detach * coilGap * 0.5);

            point = [point[0] * fallSpread, point[1] + fallDrop, point[2] * fallSpread];
            column.push({ position: point, latitude: attached.latitude });
        }
        grid.push(column);
    }

    // 法線 (数値差分)。帯の (τ, v) の向きから一貫して求めることで、螺旋のどの位置でも表裏が入れ替わらない
    for (let sampleIndex = 0; sampleIndex < grid.length; sampleIndex++) {
        const previous = grid[Math.max(0, sampleIndex - 1)];
        const next = grid[Math.min(grid.length - 1, sampleIndex + 1)];
        for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
            const alongStrip = vec3Sub(next[rowIndex].position, previous[rowIndex].position);
            const acrossStrip = vec3Sub(grid[sampleIndex][Math.min(rowCount - 1, rowIndex + 1)].position, grid[sampleIndex][Math.max(0, rowIndex - 1)].position);
            const fallback = mesh.rows[rowIndex].normals[0];
            grid[sampleIndex][rowIndex].normal = vec3Normalize(vec3Cross(acrossStrip, alongStrip), fallback);
        }
    }

    // 表 (外皮) と裏 (内層色) の2枚を僅かにずらして重ね、両面を表現する
    const layerOffset = 0.6;
    if (releaseFade < 1) g.tint(255, 255 * releaseFade);
    for (const layer of [{ tex: outerTexture, sign: 1 }, { tex: innerTexture, sign: -1 }]) {
        applyAppleSurfaceMaterial(g, layer.tex);
        for (let rowIndex = 0; rowIndex < rowCount - 1; rowIndex++) {
            g.beginShape(TRIANGLE_STRIP);
            for (let sampleIndex = 0; sampleIndex < grid.length; sampleIndex++) {
                for (const offsetRow of [rowIndex, rowIndex + 1]) {
                    const cell = grid[sampleIndex][offsetRow];
                    const n = cell.normal;
                    const p = vec3Add(cell.position, vec3Scale(n, layerOffset * layer.sign));
                    g.normal(n[0] * layer.sign, n[1] * layer.sign, n[2] * layer.sign);
                    g.vertex(p[0], p[1], p[2], samples[sampleIndex].tau, cell.latitude);
                }
            }
            g.endShape();
            renderedVertexCount += grid.length * 2;
        }
    }
    if (releaseFade < 1) g.tint(255, 255); // WEBGL では noTint() が null を設定し描画が落ちるため明示的に戻す
}

/**
 * 皮の材料座標 τ に固定された滑らかなばらつき (-1〜1 程度)。
 * τ に固定するため、皮が垂れ下がって移動しても形の癖は皮と一緒に動く
 */
function peelMaterialNoise(tau, seed) {
    return 0.5 * Math.sin(tau * 0.93 * TWO_PI * 0.5 + seed * 1.7)
        + 0.3 * Math.sin(tau * 1.71 * TWO_PI * 0.5 + seed * 4.1)
        + 0.2 * Math.sin(tau * 3.13 * TWO_PI * 0.5 + seed * 2.3);
}

/**
 * 2点を円柱座標 (y 軸まわり) で補間する関数 (角度は近い側を回る)
 */
function interpolateCylindrical(from, to, t) {
    const angleFrom = Math.atan2(from[0], from[2]);
    let angleTo = Math.atan2(to[0], to[2]);
    while (angleTo - angleFrom > Math.PI) angleTo -= TWO_PI;
    while (angleTo - angleFrom < -Math.PI) angleTo += TWO_PI;
    const angle = angleFrom + (angleTo - angleFrom) * t;
    const radius = Math.hypot(from[0], from[2]) * (1 - t) + Math.hypot(to[0], to[2]) * t;
    const height = from[1] + (to[1] - from[1]) * t;
    return [radius * Math.sin(angle), height, radius * Math.cos(angle)];
}

/**
 * 点がりんご内部にある場合、中心からの放射方向に表面 (+余白) まで押し出す関数
 */
function pushPointOutsideApple(point, appleBaseRadius, clearance) {
    const isInside = (scale) => {
        const height = point[1] * scale / appleBaseRadius;
        const appleRadius = getAppleUnitRadiusAtHeight(height);
        if (appleRadius <= 0) return false; // りんごの上下範囲外 (真下に垂れた部分など) は対象外
        const limit = appleRadius * appleBaseRadius + clearance;
        return Math.hypot(point[0], point[2]) * scale < limit;
    };
    if (!isInside(1)) return point;
    let low = 1;
    let high = 2;
    while (isInside(high) && high < 64) high *= 2;
    for (let iteration = 0; iteration < 10; iteration++) {
        const mid = (low + high) * 0.5;
        if (isInside(mid)) low = mid; else high = mid;
    }
    return vec3Scale(point, high);
}

/**
 * 果物ナイフを描画する関数
 * 刃は剥いている帯を横切る向きに寝かせ (刃先 = 剥離済み側 / 柄 = 未剥離側)、
 * 刃の切れ刃が螺旋の進行方向を向いて皮の下へ潜り込む
 */
function renderPeelingKnife(g, state, appleBaseRadius, peelThickness) {
    if (!sketchParameters.isKnifeVisible) return;

    const frame = getAppleCuttingFrame(state.knifeLatitude, state.knifeLongitude, state.latitudeStep);

    // 正規直交基底
    // axisLength: 刃渡り方向 (+ = 柄側。帯を横切って未剥離側へ、わずかに外へ逃がす)
    // axisWidth : 刃の幅方向 (0 = 切れ刃 / + = 峰。進行方向の逆)
    // axisThick : 刃の厚み方向 (曲面法線)
    const axisLength = vec3Normalize(vec3Add(vec3Scale(frame.across, -1), vec3Scale(frame.normal, 0.1)));
    const axisWidth = vec3Scale(frame.cut, -1);
    const axisThick = vec3Normalize(vec3Cross(axisLength, axisWidth));
    const thickSign = vec3Dot(axisThick, frame.normal) >= 0 ? 1 : -1;
    const axisNormal = vec3Scale(axisThick, thickSign);

    // 切削中は刃渡り方向に小さく前後させる (包丁で引くような微振動)
    const isCutting = state.releaseProgress <= 0;
    const slicingVibration = isCutting ? Math.sin(state.peelProgress * 900) * 1.4 : 0;
    const surfacePoint = vec3Scale(frame.position, appleBaseRadius);
    const origin = vec3Add(
        vec3Add(surfacePoint, vec3Scale(frame.normal, -peelThickness * 0.5 + state.knifeLift)),
        vec3Scale(axisLength, slicingVibration)
    );

    const unit = sketchParameters.knifeScale * 2.3;
    const toWorld = (a, w, t) => [
        origin[0] + (axisLength[0] * a + axisWidth[0] * w + axisNormal[0] * t) * unit,
        origin[1] + (axisLength[1] * a + axisWidth[1] * w + axisNormal[1] * t) * unit,
        origin[2] + (axisLength[2] * a + axisWidth[2] * w + axisNormal[2] * t) * unit
    ];

    g.push();

    // 1. 鋼の刃 (切れ刃から峰へ向かって厚みが増す)
    g.specularMaterial(...toneForColorScheme(235, 240, 250));
    g.shininess(90);
    g.fill(...toneForColorScheme(214, 222, 234));
    const edgeLine = [[-40, 0.4], [-28, 0.1], [-16, 0], [-4, 0], [8, 0]];
    const spineLine = [[-40, 0.4], [-35, 4.6], [-25, 7.6], [-8, 8.4], [8, 8.6]];
    const spineHalfThick = 0.55;
    const thicknessAt = (w) => spineHalfThick * Math.min(1, w / 8.6);
    for (const side of [1, -1]) {
        g.beginShape(TRIANGLE_STRIP);
        g.normal(axisNormal[0] * side, axisNormal[1] * side, axisNormal[2] * side);
        for (let i = 0; i < edgeLine.length; i++) {
            const e = toWorld(edgeLine[i][0], edgeLine[i][1], 0);
            const s = toWorld(spineLine[i][0], spineLine[i][1], thicknessAt(spineLine[i][1]) * side);
            g.vertex(e[0], e[1], e[2]);
            g.vertex(s[0], s[1], s[2]);
        }
        g.endShape();
    }
    // 峰の面
    g.beginShape(TRIANGLE_STRIP);
    g.normal(axisWidth[0], axisWidth[1], axisWidth[2]);
    for (const point of spineLine) {
        const half = thicknessAt(point[1]);
        const front = toWorld(point[0], point[1], half);
        const back = toWorld(point[0], point[1], -half);
        g.vertex(front[0], front[1], front[2]);
        g.vertex(back[0], back[1], back[2]);
    }
    g.endShape();
    renderedVertexCount += edgeLine.length * 4 + spineLine.length * 2;

    // 2. 金属口金 (Bolster)
    g.specularMaterial(...toneForColorScheme(205, 210, 220));
    g.fill(...toneForColorScheme(190, 196, 206));
    renderOrientedBox(g, toWorld(10, 4.6, 0.6), axisLength, axisWidth, axisNormal, 4 * unit, 10 * unit, 3.6 * unit);

    // 3. 木製ハンドル (Handle)
    g.ambientMaterial(...toneForColorScheme(95, 52, 28));
    g.specularMaterial(...toneForColorScheme(70, 40, 22));
    g.shininess(20);
    g.fill(...toneForColorScheme(92, 48, 26));
    renderOrientedBox(g, toWorld(33, 4.6, 1.0), axisLength, axisWidth, axisNormal, 42 * unit, 9.2 * unit, 4.8 * unit);

    // 4. ハンドルの真鍮リベット (Brass Rivets)
    g.specularMaterial(...toneForColorScheme(240, 200, 80));
    g.shininess(60);
    g.fill(...toneForColorScheme(212, 160, 40));
    for (const rivetA of [22, 44]) {
        renderOrientedBox(g, toWorld(rivetA, 4.6, 1.0), axisLength, axisWidth, axisNormal, 2.4 * unit, 2.4 * unit, 5.2 * unit);
    }

    g.pop();
}

/**
 * 任意の直交基底ベクトルに沿った直方体を法線付きで描画するヘルパー関数
 */
function renderOrientedBox(g, center, axisX, axisY, axisZ, sizeX, sizeY, sizeZ) {
    const axes = [axisX, axisY, axisZ];
    const halfSizes = [sizeX * 0.5, sizeY * 0.5, sizeZ * 0.5];
    const corner = (sx, sy, sz) => [
        center[0] + axisX[0] * halfSizes[0] * sx + axisY[0] * halfSizes[1] * sy + axisZ[0] * halfSizes[2] * sz,
        center[1] + axisX[1] * halfSizes[0] * sx + axisY[1] * halfSizes[1] * sy + axisZ[1] * halfSizes[2] * sz,
        center[2] + axisX[2] * halfSizes[0] * sx + axisY[2] * halfSizes[1] * sy + axisZ[2] * halfSizes[2] * sz
    ];

    g.beginShape(TRIANGLES);
    for (let axisIndex = 0; axisIndex < 3; axisIndex++) {
        for (const sign of [-1, 1]) {
            const n = vec3Scale(axes[axisIndex], sign);
            // 面上の4隅 (他の2軸を ±1 で走査)
            const quad = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([s1, s2]) => {
                const signs = [0, 0, 0];
                signs[axisIndex] = sign;
                signs[(axisIndex + 1) % 3] = s1;
                signs[(axisIndex + 2) % 3] = s2;
                return corner(signs[0], signs[1], signs[2]);
            });
            for (const index of [0, 1, 2, 0, 2, 3]) {
                g.normal(n[0], n[1], n[2]);
                g.vertex(quad[index][0], quad[index][1], quad[index][2]);
            }
        }
    }
    g.endShape();
    renderedVertexCount += 36;
}

/**
 * りんごの上部の軸を描画する関数
 */
function renderAppleStem(g, appleBaseRadius) {
    g.push();
    const stemRgb = convertHexToRgb(sketchParameters.appleStemColorHex);
    g.ambientMaterial(stemRgb.r, stemRgb.g, stemRgb.b);
    g.fill(stemRgb.r, stemRgb.g, stemRgb.b);
    g.translate(0, -appleBaseRadius * 1.02, 0);
    g.rotateZ(0.12);
    g.cylinder(3.2, 40, 12, 1);
    renderedVertexCount += 48;
    g.pop();
}

/**
 * ポストプロセス: フィルムグレインノイズを画面全体に合成する関数
 */
function renderPostProcessGrainFilter() {
    push();
    resetMatrix();
    // 2Dオーバーレイ表示モード
    ortho(-width / 2, width / 2, -height / 2, height / 2, 0, 1000);
    translate(0, 0, 500);

    blendMode(ADD);
    tint(255, sketchParameters.grainIntensity * 85);
    imageMode(CENTER);
    image(grainNoiseOverlayTexture, 0, 0, width, height);
    blendMode(BLEND);
    pop();
}
