/* ==========================================================================
   GEOMETRIC MATHEMATICS: APPLE PROFILE & SPIRAL PEEL BAND
   ========================================================================== */
/*
 * 螺旋帯座標 (τ, v)
 *   τ : 螺旋に沿った周回パラメータ [-1, K-1] (K = 巻き数)。経度 = 2π·τ
 *   v : 帯の幅方向パラメータ [0, 1] (0 = 帯の下端 / 1 = 帯の上端)
 *   緯度 = clamp((τ + 1 - v) · h, 0, 1)   (h = 1 / (K - 1) = 1周あたりの緯度送り)
 * この座標で全表面が過不足なく一度ずつ覆われ、ナイフ位置 τk より手前 (τ < τk) が「剥離済み」となる
 */

const APPLE_POLE_CLAMP = 0.002;

/**
 * りんご特有の上下にくぼみのある形状をパラメトリックに計算する関数
 * @param {number} latitudeNormalized 緯度正規化値 (0.0: てっぺんの軸 〜 1.0: 底部)
 * @param {number} longitudeAngle 経度ラジアン
 * @param {number} baseRadius 基準半径
 * @returns {{x: number, y: number, z: number}} 3次元頂点座標
 */
function calculateAppleSurfacePoint(latitudeNormalized, longitudeAngle, baseRadius) {
    const clampedLatitude = Math.min(Math.max(latitudeNormalized, APPLE_POLE_CLAMP), 1 - APPLE_POLE_CLAMP);
    const latitudeAngle = clampedLatitude * Math.PI;

    // 上下の軸のくぼみと肩のふくらみ
    const sinLatitude = Math.sin(latitudeAngle);
    const horizontalProfile = Math.pow(Math.max(0.001, sinLatitude), 0.76) * (1.0 - 0.14 * Math.cos(latitudeAngle * 2.0));
    const horizontalRadius = baseRadius * horizontalProfile;

    // 縦方向のプロファイル (上が負、下が正)
    const verticalHeight = baseRadius * (-Math.cos(latitudeAngle) * 1.08 + 0.12 * Math.cos(latitudeAngle * 3.0));

    return {
        x: horizontalRadius * Math.sin(longitudeAngle),
        y: verticalHeight,
        z: horizontalRadius * Math.cos(longitudeAngle)
    };
}

/* ---------- 小さなベクトルユーティリティ (配列 [x, y, z]) ---------- */
function vec3Sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function vec3Add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function vec3Scale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
function vec3Dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function vec3Cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function vec3Normalize(a, fallback) {
    const length = Math.hypot(a[0], a[1], a[2]);
    if (length < 1e-9) return fallback ? fallback.slice() : [0, 0, 1];
    return [a[0] / length, a[1] / length, a[2] / length];
}
function vec3Lerp(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/**
 * 単位半径での表面点を配列で返す関数
 */
function appleUnitPoint(latitudeNormalized, longitudeAngle) {
    const point = calculateAppleSurfacePoint(latitudeNormalized, longitudeAngle, 1.0);
    return [point.x, point.y, point.z];
}

/**
 * 単位半径の表面における外向き法線を数値微分で求める関数
 */
function appleUnitNormal(latitudeNormalized, longitudeAngle) {
    const lat = Math.min(Math.max(latitudeNormalized, 0.01), 0.99);
    const delta = 0.002;
    const dLat = vec3Sub(appleUnitPoint(lat + delta, longitudeAngle), appleUnitPoint(lat - delta, longitudeAngle));
    const dLon = vec3Sub(appleUnitPoint(lat, longitudeAngle + delta), appleUnitPoint(lat, longitudeAngle - delta));
    const fallback = latitudeNormalized < 0.5 ? [0, -1, 0] : [0, 1, 0];
    return vec3Normalize(vec3Cross(dLon, dLat), fallback);
}

/**
 * 螺旋帯座標 (τ, v) を緯度へ変換する関数
 */
function bandLatitude(tau, v, latitudeStep) {
    return Math.min(Math.max((tau + 1 - v) * latitudeStep, 0), 1);
}

/**
 * 螺旋帯メッシュのキャッシュ (形状は巻き数のみに依存するため単位半径で保持)
 */
let spiralBandMeshCache = null;
const SPIRAL_SAMPLES_PER_TURN = 72;

/**
 * 巻き数に応じた螺旋帯メッシュ (位置・法線・UV) を取得する関数
 * @param {number} turnCount 巻き数 K
 */
function getSpiralBandMesh(turnCount) {
    if (spiralBandMeshCache && spiralBandMeshCache.turnCount === turnCount) return spiralBandMeshCache;

    const latitudeStep = 1 / Math.max(1, turnCount - 1);
    const tauStart = -1;
    const tauEnd = turnCount - 1;
    const sampleCount = Math.ceil((tauEnd - tauStart) * SPIRAL_SAMPLES_PER_TURN) + 1;

    const tauValues = new Float32Array(sampleCount);
    // v 方向の頂点数: 帯が太い (巻き数が少ない) ほど細かく分割し、りんご全体で緯度方向の解像度を一定以上に保つ
    const bandRowCount = Math.max(4, Math.ceil(28 * latitudeStep) + 1);
    const rows = [];
    for (let rowIndex = 0; rowIndex < bandRowCount; rowIndex++) {
        rows.push({ v: rowIndex / (bandRowCount - 1), positions: [], normals: [], latitudes: [] });
    }

    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
        const tau = tauStart + (tauEnd - tauStart) * sampleIndex / (sampleCount - 1);
        tauValues[sampleIndex] = tau;
        const longitude = tau * TWO_PI;
        for (const row of rows) {
            const latitude = bandLatitude(tau, row.v, latitudeStep);
            row.positions.push(appleUnitPoint(latitude, longitude));
            row.normals.push(appleUnitNormal(latitude, longitude));
            row.latitudes.push(latitude);
        }
    }

    // 等速切削用の累積弧長テーブル (帯中央の周長に比例。極付近でも止まらないよう下限を設ける)
    const cumulativeArc = new Float32Array(sampleCount);
    for (let sampleIndex = 1; sampleIndex < sampleCount; sampleIndex++) {
        const tauMid = (tauValues[sampleIndex - 1] + tauValues[sampleIndex]) * 0.5;
        const midLatitude = (bandLatitude(tauMid, 0, latitudeStep) + bandLatitude(tauMid, 1, latitudeStep)) * 0.5;
        const point = appleUnitPoint(midLatitude, 0);
        const ringRadius = Math.hypot(point[0], point[2]) + 0.3;
        cumulativeArc[sampleIndex] = cumulativeArc[sampleIndex - 1] + ringRadius * (tauValues[sampleIndex] - tauValues[sampleIndex - 1]);
    }

    spiralBandMeshCache = { turnCount, latitudeStep, tauStart, tauEnd, sampleCount, tauValues, rows, cumulativeArc };
    return spiralBandMeshCache;
}

/**
 * 剥離進行度 (0-1, 弧長基準) をナイフの τ に変換する関数
 */
function convertPeelProgressToTau(mesh, progress) {
    const arc = mesh.cumulativeArc;
    const target = clamp01(progress) * arc[arc.length - 1];
    let low = 0;
    let high = arc.length - 1;
    while (high - low > 1) {
        const mid = (low + high) >> 1;
        if (arc[mid] < target) low = mid; else high = mid;
    }
    const t = (target - arc[low]) / Math.max(1e-9, arc[high] - arc[low]);
    return mesh.tauValues[low] + (mesh.tauValues[high] - mesh.tauValues[low]) * clamp01(t);
}

/**
 * 高さ y (単位半径) におけるりんごの水平半径を返す関数 (y は緯度に対して単調増加)
 */
let appleRadiusByHeightTable = null;
function getAppleUnitRadiusAtHeight(heightUnit) {
    if (!appleRadiusByHeightTable) {
        appleRadiusByHeightTable = [];
        for (let i = 0; i <= 256; i++) {
            const lat = i / 256;
            const point = calculateAppleSurfacePoint(lat, 0, 1.0);
            appleRadiusByHeightTable.push([point.y, Math.hypot(point.x, point.z)]);
        }
    }
    const table = appleRadiusByHeightTable;
    if (heightUnit <= table[0][0] || heightUnit >= table[table.length - 1][0]) return 0;
    let low = 0;
    let high = table.length - 1;
    while (high - low > 1) {
        const mid = (low + high) >> 1;
        if (table[mid][0] < heightUnit) low = mid; else high = mid;
    }
    const t = (heightUnit - table[low][0]) / Math.max(1e-9, table[high][0] - table[low][0]);
    return table[low][1] + (table[high][1] - table[low][1]) * t;
}

/**
 * 表面上の点 (緯度・経度) における切削フレームを求める関数 (単位半径)
 * @returns {{position:number[], normal:number[], across:number[], cut:number[]}}
 *   across: 帯を横切る方向 (上端 = 剥離済み側へ向かう)
 *   cut   : 刃の進行方向 (螺旋の接線, across・normal と直交化)
 */
function getAppleCuttingFrame(latitudeNormalized, longitudeAngle, latitudeStep) {
    const lat = Math.min(Math.max(latitudeNormalized, 0.02), 0.98);
    const delta = 0.002;
    const position = appleUnitPoint(lat, longitudeAngle);
    const normal = appleUnitNormal(lat, longitudeAngle);
    const dLat = vec3Scale(vec3Sub(appleUnitPoint(lat + delta, longitudeAngle), appleUnitPoint(lat - delta, longitudeAngle)), 1 / (2 * delta));
    const dLon = vec3Scale(vec3Sub(appleUnitPoint(lat, longitudeAngle + delta), appleUnitPoint(lat, longitudeAngle - delta)), 1 / (2 * delta));

    // 帯を横切る方向 = 緯度が減る (上へ向かう) 方向を接平面へ射影
    let across = vec3Scale(dLat, -1);
    across = vec3Normalize(vec3Sub(across, vec3Scale(normal, vec3Dot(across, normal))), [0, -1, 0]);

    // 螺旋の進行方向 dP/dτ = dP/dLat · h + dP/dLon · 2π を across と直交化
    let cut = vec3Add(vec3Scale(dLat, latitudeStep), vec3Scale(dLon, TWO_PI));
    cut = vec3Sub(cut, vec3Scale(normal, vec3Dot(cut, normal)));
    cut = vec3Normalize(vec3Sub(cut, vec3Scale(across, vec3Dot(cut, across))), [1, 0, 0]);

    return { position, normal, across, cut };
}

/**
 * 曲面上の点における接平面フレーム (位置, 法線, 切断接線, 従法線) を算出する関数
 * @param {number} latitudeNormalized 緯度正規化値 (0.0 - 1.0)
 * @param {number} longitudeAngle 経度ラジアン
 * @param {number} baseRadius 基準半径
 * @returns {{surfacePosition: p5.Vector, surfaceNormal: p5.Vector, tangentCut: p5.Vector, binormal: p5.Vector}}
 */
function getAppleSurfaceFrame(latitudeNormalized, longitudeAngle, baseRadius) {
    const currentPosition = calculateAppleSurfacePoint(latitudeNormalized, longitudeAngle, baseRadius);
    const surfacePositionVector = createVector(currentPosition.x, currentPosition.y, currentPosition.z);

    const deltaLatitude = 0.004;
    const deltaLongitude = 0.004;

    const latitudeOffsetPoint = calculateAppleSurfacePoint(latitudeNormalized + deltaLatitude, longitudeAngle, baseRadius);
    const longitudeOffsetPoint = calculateAppleSurfacePoint(latitudeNormalized, longitudeAngle + deltaLongitude, baseRadius);

    let tangentLatitude = createVector(
        latitudeOffsetPoint.x - currentPosition.x,
        latitudeOffsetPoint.y - currentPosition.y,
        latitudeOffsetPoint.z - currentPosition.z
    );
    if (tangentLatitude.magSq() < 1e-7) tangentLatitude = createVector(0, 1, 0);
    tangentLatitude.normalize();

    let tangentLongitude = createVector(
        longitudeOffsetPoint.x - currentPosition.x,
        longitudeOffsetPoint.y - currentPosition.y,
        longitudeOffsetPoint.z - currentPosition.z
    );
    if (tangentLongitude.magSq() < 1e-7) tangentLongitude = createVector(1, 0, 0);
    tangentLongitude.normalize();

    // 外向き法線ベクトル (曲面に垂直)
    let surfaceNormalVector = p5.Vector.cross(tangentLongitude, tangentLatitude);
    if (surfaceNormalVector.magSq() < 1e-7) surfaceNormalVector = createVector(0, 0, 1);
    surfaceNormalVector.normalize();

    // 螺旋状の切断進行方向の接線ベクトル
    const spiralTurns = sketchParameters.spiralTurnCount;
    let tangentCutVector = p5.Vector.add(
        p5.Vector.mult(tangentLongitude, TWO_PI * spiralTurns * 0.12),
        tangentLatitude
    );
    if (tangentCutVector.magSq() < 1e-7) tangentCutVector = tangentLongitude.copy();
    tangentCutVector.normalize();

    // 接平面内で切断接線と直交する従法線 (リボンの幅方向)
    let binormalVector = p5.Vector.cross(surfaceNormalVector, tangentCutVector);
    if (binormalVector.magSq() < 1e-7) binormalVector = tangentLatitude.copy();
    binormalVector.normalize();

    return {
        surfacePosition: surfacePositionVector,
        surfaceNormal: surfaceNormalVector,
        tangentCut: tangentCutVector,
        binormal: binormalVector
    };
}
