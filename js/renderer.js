/* ==========================================================================
   RECURSIVE APPLE & PEEL RENDERING PIPELINE
   ========================================================================== */
/**
 * 再帰りんご本体、螺旋リボン、ナイフを描画する関数
 * @param {number} localProgress 局所剥離進行度 (0.0 - 1.0)
 * @param {boolean} isFleshPeel 果肉剥離フェーズか否か
 */
function renderRecursiveAppleEntity(localProgress, isFleshPeel) {
    const appleBaseRadius = 140;
    const latitudeGridSegments = 64;
    const longitudeGridSegments = 64;
    const spiralTurns = sketchParameters.spiralTurnCount;
    const peelThickness = appleBaseRadius * sketchParameters.peelThicknessRatio;

    // テクスチャの選択 (フェーズごとに表裏が循環反転)
    const surfaceOuterTexture = isFleshPeel ? appleFleshProceduralTexture : appleSkinProceduralTexture;
    const subsurfaceTexture = isFleshPeel ? appleSkinProceduralTexture : appleFleshProceduralTexture;

    // ナイフの現在位置 (緯度・経度)
    const knifeLatitude = constrain(0.04 + localProgress * 0.90, 0.04, 0.94);
    const knifeLongitude = (localProgress * TWO_PI * spiralTurns) % TWO_PI;

    // --- A. りんご本体 (ナイフの通過軌跡に沿って果肉が露出するメッシュ) ---
    noStroke();

    for (let latitudeIndex = 0; latitudeIndex < latitudeGridSegments; latitudeIndex++) {
        const latNorm1 = latitudeIndex / latitudeGridSegments;
        const latNorm2 = (latitudeIndex + 1) / latitudeGridSegments;

        beginShape(TRIANGLE_STRIP);
        for (let longIndex = 0; longIndex <= longitudeGridSegments; longIndex++) {
            const longNorm = longIndex / longitudeGridSegments;
            const longAngle = longNorm * TWO_PI;

            // 各頂点がナイフ通過済み (剥離済み) かどうかの幾何学的判定
            const isPeeled1 = checkIfSurfacePointIsPeeled(latNorm1, longAngle, localProgress, spiralTurns);
            const isPeeled2 = checkIfSurfacePointIsPeeled(latNorm2, longAngle, localProgress, spiralTurns);

            const radius1 = isPeeled1 ? (appleBaseRadius - peelThickness) : appleBaseRadius;
            const radius2 = isPeeled2 ? (appleBaseRadius - peelThickness) : appleBaseRadius;

            const point1 = calculateAppleSurfacePoint(latNorm1, longAngle, radius1);
            const point2 = calculateAppleSurfacePoint(latNorm2, longAngle, radius2);

            texture(isPeeled1 ? subsurfaceTexture : surfaceOuterTexture);

            vertex(point1.x, point1.y, point1.z, longNorm, latNorm1);
            vertex(point2.x, point2.y, point2.z, longNorm, latNorm2);
            renderedVertexCount += 2;
        }
        endShape();
    }

    // --- B. 螺旋状にカールしながら剥がれ落ちる皮のリボン ---
    renderPeelingRibbonStrip(localProgress, isFleshPeel, appleBaseRadius);

    // --- C. 切削ナイフ (接平面に寄り添い、刃先が切削境界にピタリと吸着) ---
    renderPeelingKnife(knifeLatitude, knifeLongitude, appleBaseRadius, localProgress);

    // --- D. りんごの軸 / ヘタ (Stem) ---
    renderAppleStem(appleBaseRadius);
}

/**
 * 表面の特定位置がナイフによって既に剥がされたかを判定する関数
 * @param {number} latitudeNormalized 緯度正規化値 (0.0 - 1.0)
 * @param {number} longitudeAngle 経度ラジアン (0 - TWO_PI)
 * @param {number} progress 進行度 (0.0 - 1.0)
 * @param {number} spiralTurns 巻き数
 * @returns {boolean}
 */
function checkIfSurfacePointIsPeeled(latitudeNormalized, longitudeAngle, progress, spiralTurns) {
    // 有効切削緯度範囲: 0.04 〜 0.94
    const startLatitude = 0.04;
    const endLatitude = 0.94;
    if (latitudeNormalized < startLatitude) return true;
    if (latitudeNormalized > endLatitude) return false;

    const normalizedLat = (latitudeNormalized - startLatitude) / (endLatitude - startLatitude);
    const currentLatThreshold = progress;
    const turnPitch = 1.0 / spiralTurns;

    if (normalizedLat < currentLatThreshold - turnPitch) {
        return true; // 完全に通過済みの上の周回
    }
    if (normalizedLat > currentLatThreshold) {
        return false; // まだ到達していない下の周回
    }

    // 現在剥き進めている周回内の判定
    const currentKnifeAngle = (progress * TWO_PI * spiralTurns) % TWO_PI;
    const latFraction = (currentLatThreshold - normalizedLat) * spiralTurns; // 0.0 〜 1.0
    const boundaryAngle = (currentKnifeAngle - latFraction * TWO_PI + TWO_PI * 4) % TWO_PI;

    // 角度差による剥離状態判定
    let angleDifference = (longitudeAngle - boundaryAngle + TWO_PI) % TWO_PI;
    return angleDifference > Math.PI;
}

/**
 * ベクトル空間内で直接頂点を構築し、破綻なく接平面に寄り添う3D果物ナイフを描画する関数
 * @param {number} latitudeNormalized 切れ目の緯度正規化値
 * @param {number} longitudeAngle 切れ目の経度ラジアン
 * @param {number} contactRadius 切断接触面の半径
 * @param {number} progressNormalized 剥離進行度
 */
function renderPeelingKnife(latitudeNormalized, longitudeAngle, contactRadius, progressNormalized) {
    if (!sketchParameters.isKnifeVisible) return;
    if (progressNormalized <= 0.015 || progressNormalized >= 0.985) return;

    // 接触位置における接平面フレーム (位置, 法線, 切断接線, 従法線)
    const frame = getAppleSurfaceFrame(latitudeNormalized, longitudeAngle, contactRadius);

    // 切削部での微小なスライシング前後振動 (包丁で引くような微振動)
    const slicingVibration = Math.sin(millis() * 0.045) * 1.6;
    const contactPoint = p5.Vector.add(
        frame.surfacePosition,
        p5.Vector.mult(frame.tangentCut, slicingVibration)
    );

    // 正規直交基底の決定
    // directionLength: 刃渡り方向 (切断接線の逆方向 = 柄が後方へ伸びる)
    // directionWidth: 刃の幅・高さ方向 (接平面内の従法線)
    // directionThick: 刃の厚み方向 (曲面法線 = 刃の平らな面が接平面に寄り添う)
    const directionLength = p5.Vector.mult(frame.tangentCut, -1.0).normalize();
    const directionWidth = frame.binormal.copy().normalize();
    const directionThick = frame.surfaceNormal.copy().normalize();

    // りんご（半径140px）に対して堂々とした果物ナイフのスケール（倍率2.8倍基準）
    const knifeScaleFactor = sketchParameters.knifeScale * 2.8;

    /**
     * ローカル座標 (lengthX, widthY, thickZ) をワールド3D座標へ変換する内部関数
     */
    const transformLocalToWorld = (lengthOffset, widthOffset, thickOffset) => {
        const scaledLength = lengthOffset * knifeScaleFactor;
        const scaledWidth = widthOffset * knifeScaleFactor;
        const scaledThick = thickOffset * knifeScaleFactor;

        return createVector(
            contactPoint.x + directionLength.x * scaledLength + directionWidth.x * scaledWidth + directionThick.x * scaledThick,
            contactPoint.y + directionLength.y * scaledLength + directionWidth.y * scaledWidth + directionThick.y * scaledThick,
            contactPoint.z + directionLength.z * scaledLength + directionWidth.z * scaledWidth + directionThick.z * scaledThick
        );
    };

    push();

    // 1. 鋼の刃 (Steel Blade)
    specularMaterial(240, 245, 255);
    shininess(95);
    fill(228, 235, 246);
    stroke(150, 165, 180);
    strokeWeight(0.5);

    // 刃の各代表頂点 (刃渡り長: 約135px, 刃幅: 約26px, 厚み: 約2px)
    const bladeTip = transformLocalToWorld(-7, 0, 0);          // 刃先先端 (切削境界に刺さる)
    const bladeHeel = transformLocalToWorld(42, 0, 0);         // 刃元エッジ
    const spineTip = transformLocalToWorld(-3, 8.5, 0.4);      // 峰先端 (表)
    const spineHeelPos = transformLocalToWorld(42, 9.5, 0.4);  // 峰刃元 (表)
    const spineTipNeg = transformLocalToWorld(-3, 8.5, -0.4);  // 峰先端 (裏)
    const spineHeelNeg = transformLocalToWorld(42, 9.5, -0.4); // 峰刃元 (裏)

    beginShape(TRIANGLES);
    // 表側側面
    vertex(bladeTip.x, bladeTip.y, bladeTip.z);
    vertex(spineHeelPos.x, spineHeelPos.y, spineHeelPos.z);
    vertex(bladeHeel.x, bladeHeel.y, bladeHeel.z);

    vertex(bladeTip.x, bladeTip.y, bladeTip.z);
    vertex(spineTip.x, spineTip.y, spineTip.z);
    vertex(spineHeelPos.x, spineHeelPos.y, spineHeelPos.z);

    // 裏側側面
    vertex(bladeTip.x, bladeTip.y, bladeTip.z);
    vertex(bladeHeel.x, bladeHeel.y, bladeHeel.z);
    vertex(spineHeelNeg.x, spineHeelNeg.y, spineHeelNeg.z);

    vertex(bladeTip.x, bladeTip.y, bladeTip.z);
    vertex(spineHeelNeg.x, spineHeelNeg.y, spineHeelNeg.z);
    vertex(spineTipNeg.x, spineTipNeg.y, spineTipNeg.z);

    // 峰の厚み面
    vertex(spineTipNeg.x, spineTipNeg.y, spineTipNeg.z);
    vertex(spineHeelNeg.x, spineHeelNeg.y, spineHeelNeg.z);
    vertex(spineHeelPos.x, spineHeelPos.y, spineHeelPos.z);

    vertex(spineTipNeg.x, spineTipNeg.y, spineTipNeg.z);
    vertex(spineHeelPos.x, spineHeelPos.y, spineHeelPos.z);
    vertex(spineTip.x, spineTip.y, spineTip.z);
    endShape();
    renderedVertexCount += 18;

    // 2. 金属口金 (Bolster)
    specularMaterial(215, 220, 230);
    fill(200, 205, 215);
    noStroke();
    renderBoxFromDirectBasis(transformLocalToWorld(45, 4.5, 0), directionLength, directionWidth, directionThick, 6 * knifeScaleFactor, 10 * knifeScaleFactor, 3.8 * knifeScaleFactor);

    // 3. 木製ハンドル (Handle)
    ambientMaterial(65, 34, 18);
    fill(75, 38, 20);
    renderBoxFromDirectBasis(transformLocalToWorld(72, 4.5, 0), directionLength, directionWidth, directionThick, 48 * knifeScaleFactor, 9.2 * knifeScaleFactor, 4.6 * knifeScaleFactor);

    // 4. ハンドルの真鍮リベット (Brass Rivets)
    fill(218, 165, 32);
    specularMaterial(240, 200, 80);
    renderBoxFromDirectBasis(transformLocalToWorld(60, 4.5, 0), directionLength, directionWidth, directionThick, 2.5 * knifeScaleFactor, 2.5 * knifeScaleFactor, 5.0 * knifeScaleFactor);
    renderBoxFromDirectBasis(transformLocalToWorld(76, 4.5, 0), directionLength, directionWidth, directionThick, 2.5 * knifeScaleFactor, 2.5 * knifeScaleFactor, 5.0 * knifeScaleFactor);

    pop();
}

/**
 * 任意の直交基底ベクトルに基づいて直方体メッシュを描画するヘルパー関数
 */
function renderBoxFromDirectBasis(centerVector, axisX, axisY, axisZ, sizeX, sizeY, sizeZ) {
    const halfX = sizeX * 0.5;
    const halfY = sizeY * 0.5;
    const halfZ = sizeZ * 0.5;

    const corners = [];
    for (let signX of [-1, 1]) {
        for (let signY of [-1, 1]) {
            for (let signZ of [-1, 1]) {
                corners.push(createVector(
                    centerVector.x + axisX.x * (halfX * signX) + axisY.x * (halfY * signY) + axisZ.x * (halfZ * signZ),
                    centerVector.y + axisX.y * (halfX * signX) + axisY.y * (halfY * signY) + axisZ.y * (halfZ * signZ),
                    centerVector.z + axisX.z * (halfX * signX) + axisY.z * (halfY * signY) + axisZ.z * (halfZ * signZ)
                ));
            }
        }
    }

    // 6面を描画
    const faceIndices = [
        [0, 1, 3, 2], [4, 6, 7, 5],
        [0, 4, 5, 1], [2, 3, 7, 6],
        [0, 2, 6, 4], [1, 5, 7, 3]
    ];

    beginShape(TRIANGLES);
    for (let face of faceIndices) {
        const p0 = corners[face[0]];
        const p1 = corners[face[1]];
        const p2 = corners[face[2]];
        const p3 = corners[face[3]];

        vertex(p0.x, p0.y, p0.z);
        vertex(p1.x, p1.y, p1.z);
        vertex(p2.x, p2.y, p2.z);

        vertex(p0.x, p0.y, p0.z);
        vertex(p2.x, p2.y, p2.z);
        vertex(p3.x, p3.y, p3.z);
        renderedVertexCount += 6;
    }
    endShape();
}

/**
 * 切断刃先から後方へ伸び、自然に外側へカールする螺旋リボンを描画する関数
 * @param {number} progress 局所剥離進行度 (0.0 - 1.0)
 * @param {boolean} isFleshPeel 果肉剥きフェーズか否か
 * @param {number} appleBaseRadius りんごの基準半径
 */
function renderPeelingRibbonStrip(progress, isFleshPeel, appleBaseRadius) {
    if (progress <= 0.02) return;

    const totalStripSamples = 120;
    const currentDrawnSamples = Math.floor(totalStripSamples * Math.min(1.0, progress * 1.05));
    const spiralTurns = sketchParameters.spiralTurnCount;
    const ribbonWidthBase = (appleBaseRadius * Math.PI / spiralTurns) * sketchParameters.peelRibbonWidth;
    const curlIntensity = sketchParameters.peelCurlCurvature;

    const ribbonTexture = isFleshPeel ? appleFleshProceduralTexture : appleSkinProceduralTexture;
    texture(ribbonTexture);
    noStroke();

    beginShape(TRIANGLE_STRIP);
    for (let sampleCounter = 0; sampleCounter < currentDrawnSamples; sampleCounter++) {
        // ナイフ刃先 (sampleNormalized = progress) を先頭とし、後方へ向かってサンプリング
        const sampleNormalized = progress * (sampleCounter / currentDrawnSamples);
        const sampleLatitude = constrain(0.04 + sampleNormalized * 0.90, 0.04, 0.94);
        const sampleLongitude = sampleNormalized * TWO_PI * spiralTurns;

        const frame = getAppleSurfaceFrame(sampleLatitude, sampleLongitude, appleBaseRadius);

        // 刃先（切断点）からの遅れ距離
        const distanceBehindBlade = Math.max(0, progress - sampleNormalized);

        // 1. 曲面法線 (Normal) 方向への持ち上がり (刃先ではゼロで密着)
        const outwardLift = Math.pow(distanceBehindBlade, 1.4) * 55.0 * curlIntensity;

        // 2. 切断方向の逆向きへの反り返りカール
        const curlBackVector = p5.Vector.mult(frame.tangentCut, -Math.sin(distanceBehindBlade * 6.0) * 14.0 * curlIntensity);

        // 3. 重力による自然な垂れ下がり
        const gravityDrop = createVector(0, Math.pow(distanceBehindBlade, 2.0) * 35.0, 0);

        // リボンの中心線位置
        const ribbonCenter = p5.Vector.add(frame.surfacePosition, p5.Vector.mult(frame.surfaceNormal, outwardLift));
        ribbonCenter.add(curlBackVector);
        ribbonCenter.add(gravityDrop);

        // 面方向: リボンの幅方向を接平面内の従法線 (Binormal) に沿わせることで、剥がれる瞬間は曲面に完全に密着
        const halfWidthVector = p5.Vector.mult(frame.binormal, ribbonWidthBase * 0.5);

        const ribbonLeftEdge = p5.Vector.sub(ribbonCenter, halfWidthVector);
        const ribbonRightEdge = p5.Vector.add(ribbonCenter, halfWidthVector);

        const textureU = (sampleCounter % 12) / 12.0;
        vertex(ribbonLeftEdge.x, ribbonLeftEdge.y, ribbonLeftEdge.z, textureU, 0);
        vertex(ribbonRightEdge.x, ribbonRightEdge.y, ribbonRightEdge.z, textureU, 1);
        renderedVertexCount += 2;
    }
    endShape();
}

/**
 * りんごの上部の軸を描画する関数
 * @param {number} appleBaseRadius 
 */
function renderAppleStem(appleBaseRadius) {
    push();
    const stemRgb = convertHexToRgb(sketchParameters.appleStemColorHex);
    fill(stemRgb.r, stemRgb.g, stemRgb.b);
    translate(0, -appleBaseRadius * 0.92, 0);
    rotateZ(0.12);

    cylinder(3.2, 34, 12, 1);
    renderedVertexCount += 48;
    pop();
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
