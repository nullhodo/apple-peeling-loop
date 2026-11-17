/* ==========================================================================
   GEOMETRIC MATHEMATICS: APPLE PROFILE & RECURSIVE SPIRAL
   ========================================================================== */
/**
 * りんご特有の上下にくぼみのある形状をパラメトリックに計算する関数
 * @param {number} latitudeNormalized 経度正規化値 (0.0: てっぺんの軸 〜 1.0: 底部)
 * @param {number} longitudeAngle 緯度ラジアン
 * @param {number} baseRadius 基準半径
 * @returns {{x: number, y: number, z: number}} 3次元頂点座標
 */
function calculateAppleSurfacePoint(latitudeNormalized, longitudeAngle, baseRadius) {
    const clampedLatitude = constrain(latitudeNormalized, 0.008, 0.992);
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
