# KamiCheck PoC機材候補リスト
**作成日:** 2026-02-26

---

## PoC機材予算まとめ

| カテゴリ | 機材 | 概算 |
|---------|------|------|
| カメラ | Basler ace2 200万画素 GigE Basic | 8万円 |
| レンズ | KOWA Cマウント 12-25mm | 2万円 |
| 照明（透過） | CCS HLDL3 バー型 300mm 白色 | 5万円 |
| 照明（反射） | CCS HPD ドーム型 | 5万円 |
| 照明コントローラ | CCS PD3 2ch ストロボ対応 | 5万円 |
| エッジPC | 既存Mac使用（PoC段階） | 0円 |
| 取付・ケーブル等 | 一式 | 3.5万円 |
| **合計** | | **28.5万円** |

## カメラ選定理由
Basler ace2はpylon SDKがPython対応で無料、Anomalibとの連携が容易。200万画素で噛み込み検査には十分。51fpsで高速搬送対応。GigE Vision 2.0でPoE電源供給可能（ケーブル1本）。

## 照明方式
- **透過光（メイン）:** シール部裏側からバー型LED → 噛み込みが透過ムラとして明確に出る
- **反射光（補助）:** シール部表面のドーム照明 → 膨らみ・変形検出
- CCSは無料貸出機あり＋テスティングルーム利用可能

## エッジPC（製品版）
NVIDIA Jetson Orin NX 16GB — 100TOPS、約15万円（スイッチサイエンス）。PoC合格後に購入。

## ソフトウェア（全てOSS、コスト0円）
- Anomalib: 良品学習（PatchCore/PaDiM）
- YOLOv8: 物体検出
- PyTorch 2.x + OpenCV + ONNX Runtime
- Basler pylon / pypylon: カメラ制御
- React + FastAPI: UI（将来）
