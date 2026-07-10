import { extractFeatures, normalizeFeatures, weightFeatures } from './feature-pipeline';

describe('extractFeatures', () => {
  it('returns an empty array when no signal is present', () => {
    expect(extractFeatures({ clipId: 'clip-1' })).toEqual([]);
  });

  it('extracts averageRmsDb and speakingRateStdDev for audio, skipping null readings', () => {
    const result = extractFeatures({
      clipId: 'clip-1',
      audio: {
        averageRmsDb: -15,
        peakDb: -2,
        averageSpeakingRateWordsPerSecond: 2,
        speakingRateStdDev: null,
      },
    });
    expect(result).toEqual([
      { signal: 'audio', feature: 'averageRmsDb', value: -15, isCategoryDerived: false },
    ]);
  });

  it('extracts cutsPerMinute for scene, and nothing when cutsPerMinute is null', () => {
    const present = extractFeatures({
      clipId: 'clip-1',
      scene: {
        cutCount: 2,
        cutsPerMinute: 12,
        averageSegmentSeconds: 5,
        hardCutCount: 2,
        fadeCount: 0,
        dissolveCount: 0,
      },
    });
    expect(present).toEqual([
      { signal: 'scene', feature: 'cutsPerMinute', value: 12, isCategoryDerived: false },
    ]);

    const absent = extractFeatures({
      clipId: 'clip-1',
      scene: {
        cutCount: 0,
        cutsPerMinute: null,
        averageSegmentSeconds: null,
        hardCutCount: 0,
        fadeCount: 0,
        dissolveCount: 0,
      },
    });
    expect(absent).toEqual([]);
  });

  it('extracts averageMotionEnergy, dynamicRatio, peakRatePerMinute, and motionVariability for sceneMotion, skipping null readings', () => {
    const present = extractFeatures({
      clipId: 'clip-1',
      sceneMotion: {
        averageMotionEnergy: 5.5,
        peakMotionEnergy: 12,
        staticRatio: 0.4,
        dynamicRatio: 0.6,
        peakCount: 2,
        peakTimestamps: [3, 8],
        peakRatePerMinute: 1.5,
        motionVariability: 0.3,
      },
    });
    expect(present).toEqual([
      {
        signal: 'sceneMotion',
        feature: 'averageMotionEnergy',
        value: 5.5,
        isCategoryDerived: false,
      },
      { signal: 'sceneMotion', feature: 'dynamicRatio', value: 0.6, isCategoryDerived: false },
      {
        signal: 'sceneMotion',
        feature: 'peakRatePerMinute',
        value: 1.5,
        isCategoryDerived: false,
      },
      {
        signal: 'sceneMotion',
        feature: 'motionVariability',
        value: 0.3,
        isCategoryDerived: false,
      },
    ]);

    const absent = extractFeatures({
      clipId: 'clip-1',
      sceneMotion: {
        averageMotionEnergy: null,
        peakMotionEnergy: null,
        staticRatio: null,
        dynamicRatio: null,
        peakCount: null,
        peakTimestamps: null,
        peakRatePerMinute: null,
        motionVariability: null,
      },
    });
    expect(absent).toEqual([]);
  });

  it('extracts panScore/tiltScore/zoomScore/shakeScore, dominantMotionTypeWeight (category-derived, with label), motionTypeDiversity, and smoothnessScore for cameraMotion, skipping null readings', () => {
    const present = extractFeatures({
      clipId: 'clip-1',
      cameraMotion: {
        panScore: 0.6,
        tiltScore: 0.1,
        zoomScore: 0.2,
        shakeScore: 0.05,
        dominantMotionType: 'pan',
        dominantDirection: 'right',
        motionTypeDiversity: 0.7,
        smoothnessScore: 0.9,
      },
    });
    expect(present).toEqual([
      { signal: 'cameraMotion', feature: 'panScore', value: 0.6, isCategoryDerived: false },
      { signal: 'cameraMotion', feature: 'tiltScore', value: 0.1, isCategoryDerived: false },
      { signal: 'cameraMotion', feature: 'zoomScore', value: 0.2, isCategoryDerived: false },
      { signal: 'cameraMotion', feature: 'shakeScore', value: 0.05, isCategoryDerived: false },
      {
        signal: 'cameraMotion',
        feature: 'dominantMotionTypeWeight',
        value: 65,
        isCategoryDerived: true,
        label: 'pan',
      },
      {
        signal: 'cameraMotion',
        feature: 'motionTypeDiversity',
        value: 0.7,
        isCategoryDerived: false,
      },
      {
        signal: 'cameraMotion',
        feature: 'smoothnessScore',
        value: 0.9,
        isCategoryDerived: false,
      },
    ]);

    const absent = extractFeatures({
      clipId: 'clip-1',
      cameraMotion: {
        panScore: null,
        tiltScore: null,
        zoomScore: null,
        shakeScore: null,
        dominantMotionType: null,
        dominantDirection: null,
        motionTypeDiversity: null,
        smoothnessScore: null,
      },
    });
    expect(absent).toEqual([]);
  });

  it('extracts tempoScore/pacingScore/accelerationScore for editingRhythm, skipping null readings', () => {
    const present = extractFeatures({
      clipId: 'clip-1',
      editingRhythm: {
        tempoScore: 0.4,
        pacingScore: 0.9,
        accelerationScore: 0.3,
      },
    });
    expect(present).toEqual([
      { signal: 'editingRhythm', feature: 'tempoScore', value: 0.4, isCategoryDerived: false },
      { signal: 'editingRhythm', feature: 'pacingScore', value: 0.9, isCategoryDerived: false },
      {
        signal: 'editingRhythm',
        feature: 'accelerationScore',
        value: 0.3,
        isCategoryDerived: false,
      },
    ]);

    const absent = extractFeatures({
      clipId: 'clip-1',
      editingRhythm: { tempoScore: null, pacingScore: null, accelerationScore: null },
    });
    expect(absent).toEqual([]);
  });

  it('extracts dominantEmotionWeight (category-derived, with label), peakConfidence, and stability for facial', () => {
    const result = extractFeatures({
      clipId: 'clip-1',
      facial: {
        dominantEmotion: 'happy',
        emotionTransitions: 0,
        peakConfidence: 0.9,
        stability: 0.8,
      },
    });
    expect(result).toEqual([
      {
        signal: 'facial',
        feature: 'dominantEmotionWeight',
        value: 90,
        isCategoryDerived: true,
        label: 'happy',
      },
      { signal: 'facial', feature: 'peakConfidence', value: 0.9, isCategoryDerived: false },
      { signal: 'facial', feature: 'stability', value: 0.8, isCategoryDerived: false },
    ]);
  });

  it('extracts dominantGestureWeight (category-derived, with label) for gesture', () => {
    const result = extractFeatures({
      clipId: 'clip-1',
      gesture: {
        dominantGesture: 'thumb_up',
        gestureTransitions: 0,
        peakConfidence: 0.9,
        stability: null,
      },
    });
    expect(result).toEqual([
      {
        signal: 'gesture',
        feature: 'dominantGestureWeight',
        value: 90,
        isCategoryDerived: true,
        label: 'thumb_up',
      },
      { signal: 'gesture', feature: 'peakConfidence', value: 0.9, isCategoryDerived: false },
    ]);
  });

  it('extracts every non-null faceGeometry feature, skipping nulls', () => {
    const result = extractFeatures({
      clipId: 'clip-1',
      faceGeometry: {
        blinkRate: 0.1,
        averageSmile: 0.5,
        averageMouthOpen: null,
        averageAbsoluteYaw: 12,
        averageAbsolutePitch: null,
        positionScore: 0.9,
        sizeScore: 0.3,
        visibilityScore: 1,
        eyeContactRate: null,
        dominantLookingDirection: null,
        averageSharpness: null,
        averageBrightness: null,
        occlusionRate: null,
        speakerChangeCount: null,
        dominantSpeakerConsistency: null,
        speakerAudioSyncRate: null,
        averageLipVelocity: null,
        speakingIntensity: null,
        pauseCount: null,
        articulationRate: null,
        averageMouthWidth: null,
        averageCheekRaise: null,
        averageEyeSquint: null,
        genuineSmileRate: null,
        blinkFrequencyPerMinute: null,
        prolongedClosureCount: null,
        gazeStabilityScore: null,
        averageBrowActivity: null,
        averageHeadMovementRate: null,
        dominantAffect: null,
        affectConfidence: null,
      },
    });
    expect(result).toEqual([
      { signal: 'faceGeometry', feature: 'blinkRate', value: 0.1, isCategoryDerived: false },
      { signal: 'faceGeometry', feature: 'averageSmile', value: 0.5, isCategoryDerived: false },
      {
        signal: 'faceGeometry',
        feature: 'averageAbsoluteYaw',
        value: 12,
        isCategoryDerived: false,
      },
      { signal: 'faceGeometry', feature: 'positionScore', value: 0.9, isCategoryDerived: false },
      { signal: 'faceGeometry', feature: 'sizeScore', value: 0.3, isCategoryDerived: false },
      {
        signal: 'faceGeometry',
        feature: 'visibilityScore',
        value: 1,
        isCategoryDerived: false,
      },
    ]);
  });

  it('extracts eyeContactRate and dominantLookingDirectionWeight (category-derived, with label) for faceGeometry (Batch 2)', () => {
    const result = extractFeatures({
      clipId: 'clip-1',
      faceGeometry: {
        blinkRate: null,
        averageSmile: null,
        averageMouthOpen: null,
        averageAbsoluteYaw: null,
        averageAbsolutePitch: null,
        positionScore: null,
        sizeScore: null,
        visibilityScore: null,
        eyeContactRate: 0.8,
        dominantLookingDirection: 'center',
        averageSharpness: null,
        averageBrightness: null,
        occlusionRate: null,
        speakerChangeCount: null,
        dominantSpeakerConsistency: null,
        speakerAudioSyncRate: null,
        averageLipVelocity: null,
        speakingIntensity: null,
        pauseCount: null,
        articulationRate: null,
        averageMouthWidth: null,
        averageCheekRaise: null,
        averageEyeSquint: null,
        genuineSmileRate: null,
        blinkFrequencyPerMinute: null,
        prolongedClosureCount: null,
        gazeStabilityScore: null,
        averageBrowActivity: null,
        averageHeadMovementRate: null,
        dominantAffect: null,
        affectConfidence: null,
      },
    });
    expect(result).toEqual([
      { signal: 'faceGeometry', feature: 'eyeContactRate', value: 0.8, isCategoryDerived: false },
      {
        signal: 'faceGeometry',
        feature: 'dominantLookingDirectionWeight',
        value: 90,
        isCategoryDerived: true,
        label: 'center',
      },
    ]);
  });

  it('extracts averageSharpness, averageBrightness, and occlusionRate for faceGeometry (Batch 3)', () => {
    const result = extractFeatures({
      clipId: 'clip-1',
      faceGeometry: {
        blinkRate: null,
        averageSmile: null,
        averageMouthOpen: null,
        averageAbsoluteYaw: null,
        averageAbsolutePitch: null,
        positionScore: null,
        sizeScore: null,
        visibilityScore: null,
        eyeContactRate: null,
        dominantLookingDirection: null,
        averageSharpness: 250,
        averageBrightness: 140,
        occlusionRate: 0.2,
        speakerChangeCount: null,
        dominantSpeakerConsistency: null,
        speakerAudioSyncRate: null,
        averageLipVelocity: null,
        speakingIntensity: null,
        pauseCount: null,
        articulationRate: null,
        averageMouthWidth: null,
        averageCheekRaise: null,
        averageEyeSquint: null,
        genuineSmileRate: null,
        blinkFrequencyPerMinute: null,
        prolongedClosureCount: null,
        gazeStabilityScore: null,
        averageBrowActivity: null,
        averageHeadMovementRate: null,
        dominantAffect: null,
        affectConfidence: null,
      },
    });
    expect(result).toEqual([
      { signal: 'faceGeometry', feature: 'averageSharpness', value: 250, isCategoryDerived: false },
      {
        signal: 'faceGeometry',
        feature: 'averageBrightness',
        value: 140,
        isCategoryDerived: false,
      },
      { signal: 'faceGeometry', feature: 'occlusionRate', value: 0.2, isCategoryDerived: false },
    ]);
  });

  it('extracts speakerChangeCount, dominantSpeakerConsistency, and speakerAudioSyncRate for faceGeometry (Batch 4)', () => {
    const result = extractFeatures({
      clipId: 'clip-1',
      faceGeometry: {
        blinkRate: null,
        averageSmile: null,
        averageMouthOpen: null,
        averageAbsoluteYaw: null,
        averageAbsolutePitch: null,
        positionScore: null,
        sizeScore: null,
        visibilityScore: null,
        eyeContactRate: null,
        dominantLookingDirection: null,
        averageSharpness: null,
        averageBrightness: null,
        occlusionRate: null,
        speakerChangeCount: 2,
        dominantSpeakerConsistency: 0.75,
        speakerAudioSyncRate: 0.6,
        averageLipVelocity: null,
        speakingIntensity: null,
        pauseCount: null,
        articulationRate: null,
        averageMouthWidth: null,
        averageCheekRaise: null,
        averageEyeSquint: null,
        genuineSmileRate: null,
        blinkFrequencyPerMinute: null,
        prolongedClosureCount: null,
        gazeStabilityScore: null,
        averageBrowActivity: null,
        averageHeadMovementRate: null,
        dominantAffect: null,
        affectConfidence: null,
      },
    });
    expect(result).toEqual([
      { signal: 'faceGeometry', feature: 'speakerChangeCount', value: 2, isCategoryDerived: false },
      {
        signal: 'faceGeometry',
        feature: 'dominantSpeakerConsistency',
        value: 0.75,
        isCategoryDerived: false,
      },
      {
        signal: 'faceGeometry',
        feature: 'speakerAudioSyncRate',
        value: 0.6,
        isCategoryDerived: false,
      },
    ]);
  });

  it('extracts averageLipVelocity, speakingIntensity, pauseCount, and articulationRate for faceGeometry (Batch 5A)', () => {
    const result = extractFeatures({
      clipId: 'clip-1',
      faceGeometry: {
        blinkRate: null,
        averageSmile: null,
        averageMouthOpen: null,
        averageAbsoluteYaw: null,
        averageAbsolutePitch: null,
        positionScore: null,
        sizeScore: null,
        visibilityScore: null,
        eyeContactRate: null,
        dominantLookingDirection: null,
        averageSharpness: null,
        averageBrightness: null,
        occlusionRate: null,
        speakerChangeCount: null,
        dominantSpeakerConsistency: null,
        speakerAudioSyncRate: null,
        averageLipVelocity: 0.3,
        speakingIntensity: 0.5,
        pauseCount: 1,
        articulationRate: 0.8,
        averageMouthWidth: null,
        averageCheekRaise: null,
        averageEyeSquint: null,
        genuineSmileRate: null,
        blinkFrequencyPerMinute: null,
        prolongedClosureCount: null,
        gazeStabilityScore: null,
        averageBrowActivity: null,
        averageHeadMovementRate: null,
        dominantAffect: null,
        affectConfidence: null,
      },
    });
    expect(result).toEqual([
      {
        signal: 'faceGeometry',
        feature: 'averageLipVelocity',
        value: 0.3,
        isCategoryDerived: false,
      },
      {
        signal: 'faceGeometry',
        feature: 'speakingIntensity',
        value: 0.5,
        isCategoryDerived: false,
      },
      { signal: 'faceGeometry', feature: 'pauseCount', value: 1, isCategoryDerived: false },
      {
        signal: 'faceGeometry',
        feature: 'articulationRate',
        value: 0.8,
        isCategoryDerived: false,
      },
    ]);
  });

  it('extracts averageMouthWidth, averageCheekRaise, averageEyeSquint, and genuineSmileRate for faceGeometry (Batch 5B)', () => {
    const result = extractFeatures({
      clipId: 'clip-1',
      faceGeometry: {
        blinkRate: null,
        averageSmile: null,
        averageMouthOpen: null,
        averageAbsoluteYaw: null,
        averageAbsolutePitch: null,
        positionScore: null,
        sizeScore: null,
        visibilityScore: null,
        eyeContactRate: null,
        dominantLookingDirection: null,
        averageSharpness: null,
        averageBrightness: null,
        occlusionRate: null,
        speakerChangeCount: null,
        dominantSpeakerConsistency: null,
        speakerAudioSyncRate: null,
        averageLipVelocity: null,
        speakingIntensity: null,
        pauseCount: null,
        articulationRate: null,
        averageMouthWidth: 0.6,
        averageCheekRaise: 0.4,
        averageEyeSquint: 0.5,
        genuineSmileRate: 0.7,
        blinkFrequencyPerMinute: null,
        prolongedClosureCount: null,
        gazeStabilityScore: null,
        averageBrowActivity: null,
        averageHeadMovementRate: null,
        dominantAffect: null,
        affectConfidence: null,
      },
    });
    expect(result).toEqual([
      {
        signal: 'faceGeometry',
        feature: 'averageMouthWidth',
        value: 0.6,
        isCategoryDerived: false,
      },
      {
        signal: 'faceGeometry',
        feature: 'averageCheekRaise',
        value: 0.4,
        isCategoryDerived: false,
      },
      { signal: 'faceGeometry', feature: 'averageEyeSquint', value: 0.5, isCategoryDerived: false },
      { signal: 'faceGeometry', feature: 'genuineSmileRate', value: 0.7, isCategoryDerived: false },
    ]);
  });

  it('extracts blinkFrequencyPerMinute, prolongedClosureCount, and gazeStabilityScore for faceGeometry (Batch 5C)', () => {
    const result = extractFeatures({
      clipId: 'clip-1',
      faceGeometry: {
        blinkRate: null,
        averageSmile: null,
        averageMouthOpen: null,
        averageAbsoluteYaw: null,
        averageAbsolutePitch: null,
        positionScore: null,
        sizeScore: null,
        visibilityScore: null,
        eyeContactRate: null,
        dominantLookingDirection: null,
        averageSharpness: null,
        averageBrightness: null,
        occlusionRate: null,
        speakerChangeCount: null,
        dominantSpeakerConsistency: null,
        speakerAudioSyncRate: null,
        averageLipVelocity: null,
        speakingIntensity: null,
        pauseCount: null,
        articulationRate: null,
        averageMouthWidth: null,
        averageCheekRaise: null,
        averageEyeSquint: null,
        genuineSmileRate: null,
        blinkFrequencyPerMinute: 12,
        prolongedClosureCount: 2,
        gazeStabilityScore: 0.9,
        averageBrowActivity: null,
        averageHeadMovementRate: null,
        dominantAffect: null,
        affectConfidence: null,
      },
    });
    expect(result).toEqual([
      {
        signal: 'faceGeometry',
        feature: 'blinkFrequencyPerMinute',
        value: 12,
        isCategoryDerived: false,
      },
      {
        signal: 'faceGeometry',
        feature: 'prolongedClosureCount',
        value: 2,
        isCategoryDerived: false,
      },
      {
        signal: 'faceGeometry',
        feature: 'gazeStabilityScore',
        value: 0.9,
        isCategoryDerived: false,
      },
    ]);
  });

  it('extracts averageBrowActivity, averageHeadMovementRate, dominantAffectWeight (category-derived, with label), and affectConfidence for faceGeometry (Batch 5D)', () => {
    const result = extractFeatures({
      clipId: 'clip-1',
      faceGeometry: {
        blinkRate: null,
        averageSmile: null,
        averageMouthOpen: null,
        averageAbsoluteYaw: null,
        averageAbsolutePitch: null,
        positionScore: null,
        sizeScore: null,
        visibilityScore: null,
        eyeContactRate: null,
        dominantLookingDirection: null,
        averageSharpness: null,
        averageBrightness: null,
        occlusionRate: null,
        speakerChangeCount: null,
        dominantSpeakerConsistency: null,
        speakerAudioSyncRate: null,
        averageLipVelocity: null,
        speakingIntensity: null,
        pauseCount: null,
        articulationRate: null,
        averageMouthWidth: null,
        averageCheekRaise: null,
        averageEyeSquint: null,
        genuineSmileRate: null,
        blinkFrequencyPerMinute: null,
        prolongedClosureCount: null,
        gazeStabilityScore: null,
        averageBrowActivity: 0.4,
        averageHeadMovementRate: 5,
        dominantAffect: 'positive_affect',
        affectConfidence: 1,
      },
    });
    expect(result).toEqual([
      {
        signal: 'faceGeometry',
        feature: 'averageBrowActivity',
        value: 0.4,
        isCategoryDerived: false,
      },
      {
        signal: 'faceGeometry',
        feature: 'averageHeadMovementRate',
        value: 5,
        isCategoryDerived: false,
      },
      {
        signal: 'faceGeometry',
        feature: 'dominantAffectWeight',
        value: 90,
        isCategoryDerived: true,
        label: 'positive_affect',
      },
      { signal: 'faceGeometry', feature: 'affectConfidence', value: 1, isCategoryDerived: false },
    ]);
  });

  it('extracts every non-null ocr feature, skipping nulls, with dominantTextCategoryWeight category-derived (Batch OCR-2)', () => {
    const result = extractFeatures({
      clipId: 'clip-1',
      ocr: {
        subtitleCoverageRate: 0.8,
        slidePresenceRate: null,
        captionRate: null,
        logoPresenceRate: 0.1,
        priceMentionRate: null,
        nameMentionRate: null,
        dominantTextCategory: 'subtitle',
        averageTextBlockCount: 1.5,
      },
    });
    expect(result).toEqual([
      { signal: 'ocr', feature: 'subtitleCoverageRate', value: 0.8, isCategoryDerived: false },
      { signal: 'ocr', feature: 'logoPresenceRate', value: 0.1, isCategoryDerived: false },
      {
        signal: 'ocr',
        feature: 'dominantTextCategoryWeight',
        value: 60,
        isCategoryDerived: true,
        label: 'subtitle',
      },
      { signal: 'ocr', feature: 'averageTextBlockCount', value: 1.5, isCategoryDerived: false },
    ]);
  });

  it('extracts averageObjectsPerFrame/averageTrackingConfidence/averagePersistence/averageMotionSpeed/averageOcclusionScore/averageInteractionConfidence/averageAttentionScore/averageAttentionConfidence for object, skipping null readings and never scoring dominantObject/objectCount (Batch OI-1/OI-2/OI-3/OI-4/OI-5)', () => {
    const present = extractFeatures({
      clipId: 'clip-1',
      object: {
        objectCount: 3,
        dominantObject: 'person',
        averageObjectsPerFrame: 1.5,
        averageTrackingConfidence: 0.85,
        averagePersistence: 0.4,
        averageMotionSpeed: 0.3,
        averageOcclusionScore: 0.1,
        averageInteractionConfidence: 0.2,
        averageAttentionScore: 0.6,
        averageAttentionConfidence: 0.7,
      },
    });
    expect(present).toEqual([
      {
        signal: 'object',
        feature: 'averageObjectsPerFrame',
        value: 1.5,
        isCategoryDerived: false,
      },
      {
        signal: 'object',
        feature: 'averageTrackingConfidence',
        value: 0.85,
        isCategoryDerived: false,
      },
      { signal: 'object', feature: 'averagePersistence', value: 0.4, isCategoryDerived: false },
      { signal: 'object', feature: 'averageMotionSpeed', value: 0.3, isCategoryDerived: false },
      {
        signal: 'object',
        feature: 'averageOcclusionScore',
        value: 0.1,
        isCategoryDerived: false,
      },
      {
        signal: 'object',
        feature: 'averageInteractionConfidence',
        value: 0.2,
        isCategoryDerived: false,
      },
      {
        signal: 'object',
        feature: 'averageAttentionScore',
        value: 0.6,
        isCategoryDerived: false,
      },
      // averageAttentionConfidence is extracted under the shared
      // 'peakConfidence' feature name - see extractObjectFeatures()'s own
      // comment for why.
      {
        signal: 'object',
        feature: 'peakConfidence',
        value: 0.7,
        isCategoryDerived: false,
      },
    ]);

    const absent = extractFeatures({
      clipId: 'clip-1',
      object: {
        objectCount: null,
        dominantObject: null,
        averageObjectsPerFrame: null,
        averageTrackingConfidence: null,
        averagePersistence: null,
        averageMotionSpeed: null,
        averageOcclusionScore: null,
        averageInteractionConfidence: null,
        averageAttentionScore: null,
        averageAttentionConfidence: null,
      },
    });
    expect(absent).toEqual([]);
  });

  it('extracts every non-null speaker field, skipping null ones (Speaker Intelligence roadmap, Milestone D)', () => {
    const result = extractFeatures({
      clipId: 'clip-1',
      speaker: {
        dominantSpeakerConfidence: 0.8,
        dominantSpeakerEngagement: null,
        dominantSpeakerImportance: 0.6,
        averageSpeakerHighlightScore: 0.5,
      },
    });
    expect(result).toEqual([
      {
        signal: 'speaker',
        feature: 'dominantSpeakerConfidence',
        value: 0.8,
        isCategoryDerived: false,
      },
      {
        signal: 'speaker',
        feature: 'dominantSpeakerImportance',
        value: 0.6,
        isCategoryDerived: false,
      },
      {
        signal: 'speaker',
        feature: 'averageSpeakerHighlightScore',
        value: 0.5,
        isCategoryDerived: false,
      },
    ]);
  });

  it('extracts nothing for speaker when every field is null', () => {
    const result = extractFeatures({
      clipId: 'clip-1',
      speaker: {
        dominantSpeakerConfidence: null,
        dominantSpeakerEngagement: null,
        dominantSpeakerImportance: null,
        averageSpeakerHighlightScore: null,
      },
    });
    expect(result).toEqual([]);
  });
});

describe('normalizeFeatures', () => {
  it('maps averageRmsDb from [-40,-10] dB to [0,1]', () => {
    const result = normalizeFeatures([
      { signal: 'audio', feature: 'averageRmsDb', value: -10, isCategoryDerived: false },
    ]);
    expect(result[0].normalizedValue).toBe(1);
  });

  it('maps cutsPerMinute to a [0.2, 1] range (non-zero baseline for zero cuts)', () => {
    const result = normalizeFeatures([
      { signal: 'scene', feature: 'cutsPerMinute', value: 0, isCategoryDerived: false },
    ]);
    expect(result[0].normalizedValue).toBeCloseTo(0.2);
  });

  it('maps averageMotionEnergy from [0,20] YDIF to [0,1]', () => {
    const result = normalizeFeatures([
      {
        signal: 'sceneMotion',
        feature: 'averageMotionEnergy',
        value: 10,
        isCategoryDerived: false,
      },
    ]);
    expect(result[0].normalizedValue).toBeCloseTo(0.5);
  });

  it("passes sceneMotion's already-0-1 dynamicRatio through unchanged", () => {
    const result = normalizeFeatures([
      { signal: 'sceneMotion', feature: 'dynamicRatio', value: 0.6, isCategoryDerived: false },
    ]);
    expect(result[0].normalizedValue).toBe(0.6);
  });

  it('maps sceneMotion peakRatePerMinute (Batch SC-5) onto 0-1 via its own cap', () => {
    const result = normalizeFeatures([
      { signal: 'sceneMotion', feature: 'peakRatePerMinute', value: 3, isCategoryDerived: false },
    ]);
    // PEAK_RATE_PER_MINUTE_CAP is 6 - a rate of 3/min maps to the midpoint.
    expect(result[0].normalizedValue).toBeCloseTo(0.5);
  });

  it('maps sceneMotion motionVariability (Batch SC-6) onto 0-1 via its own cap', () => {
    const result = normalizeFeatures([
      { signal: 'sceneMotion', feature: 'motionVariability', value: 0.75, isCategoryDerived: false },
    ]);
    // MOTION_VARIABILITY_CAP is 1.5 - a CoV of 0.75 maps to the midpoint.
    expect(result[0].normalizedValue).toBeCloseTo(0.5);
  });

  it("passes cameraMotion's already-0-1 motionTypeDiversity (Batch SC-6) through unchanged", () => {
    const result = normalizeFeatures([
      { signal: 'cameraMotion', feature: 'motionTypeDiversity', value: 0.7, isCategoryDerived: false },
    ]);
    expect(result[0].normalizedValue).toBe(0.7);
  });

  it("passes cameraMotion's already-0-1 smoothnessScore (Batch SC-7) through unchanged", () => {
    const result = normalizeFeatures([
      { signal: 'cameraMotion', feature: 'smoothnessScore', value: 0.9, isCategoryDerived: false },
    ]);
    expect(result[0].normalizedValue).toBe(0.9);
  });

  it("passes cameraMotion's already-0-1 panScore/tiltScore/zoomScore/shakeScore through unchanged", () => {
    const result = normalizeFeatures([
      { signal: 'cameraMotion', feature: 'panScore', value: 0.6, isCategoryDerived: false },
      { signal: 'cameraMotion', feature: 'shakeScore', value: 0.2, isCategoryDerived: false },
    ]);
    expect(result[0].normalizedValue).toBe(0.6);
    expect(result[1].normalizedValue).toBe(0.2);
  });

  it('divides cameraMotion dominantMotionTypeWeight (a 0-100 category weight) down to 0-1', () => {
    const result = normalizeFeatures([
      {
        signal: 'cameraMotion',
        feature: 'dominantMotionTypeWeight',
        value: 80,
        isCategoryDerived: true,
        label: 'zoom',
      },
    ]);
    expect(result[0].normalizedValue).toBeCloseTo(0.8);
  });

  it("passes editingRhythm's already-0-1 tempoScore/pacingScore through unchanged", () => {
    const result = normalizeFeatures([
      { signal: 'editingRhythm', feature: 'tempoScore', value: 0.4, isCategoryDerived: false },
      { signal: 'editingRhythm', feature: 'pacingScore', value: 0.9, isCategoryDerived: false },
    ]);
    expect(result[0].normalizedValue).toBe(0.4);
    expect(result[1].normalizedValue).toBe(0.9);
  });

  it('maps editingRhythm accelerationScore from [-1,1] to [0,1]', () => {
    const negative = normalizeFeatures([
      {
        signal: 'editingRhythm',
        feature: 'accelerationScore',
        value: -1,
        isCategoryDerived: false,
      },
    ]);
    expect(negative[0].normalizedValue).toBe(0);

    const zero = normalizeFeatures([
      { signal: 'editingRhythm', feature: 'accelerationScore', value: 0, isCategoryDerived: false },
    ]);
    expect(zero[0].normalizedValue).toBeCloseTo(0.5);

    const positive = normalizeFeatures([
      { signal: 'editingRhythm', feature: 'accelerationScore', value: 1, isCategoryDerived: false },
    ]);
    expect(positive[0].normalizedValue).toBe(1);
  });

  it('divides a 0-100 category weight down to 0-1', () => {
    const result = normalizeFeatures([
      {
        signal: 'facial',
        feature: 'dominantEmotionWeight',
        value: 90,
        isCategoryDerived: true,
        label: 'happy',
      },
    ]);
    expect(result[0].normalizedValue).toBeCloseTo(0.9);
  });

  it("passes faceGeometry's already-0-1 features through unchanged", () => {
    const result = normalizeFeatures([
      { signal: 'faceGeometry', feature: 'blinkRate', value: 0.4, isCategoryDerived: false },
    ]);
    expect(result[0].normalizedValue).toBe(0.4);
  });

  it('maps averageAbsoluteYaw/Pitch from [0,45] degrees to [0,1]', () => {
    const yaw = normalizeFeatures([
      {
        signal: 'faceGeometry',
        feature: 'averageAbsoluteYaw',
        value: 45,
        isCategoryDerived: false,
      },
    ]);
    expect(yaw[0].normalizedValue).toBe(1);

    const pitch = normalizeFeatures([
      {
        signal: 'faceGeometry',
        feature: 'averageAbsolutePitch',
        value: 0,
        isCategoryDerived: false,
      },
    ]);
    expect(pitch[0].normalizedValue).toBe(0);
  });

  it('passes eyeContactRate through unchanged and maps dominantLookingDirectionWeight down to 0-1', () => {
    const eyeContact = normalizeFeatures([
      { signal: 'faceGeometry', feature: 'eyeContactRate', value: 0.6, isCategoryDerived: false },
    ]);
    expect(eyeContact[0].normalizedValue).toBe(0.6);

    const direction = normalizeFeatures([
      {
        signal: 'faceGeometry',
        feature: 'dominantLookingDirectionWeight',
        value: 90,
        isCategoryDerived: true,
        label: 'center',
      },
    ]);
    expect(direction[0].normalizedValue).toBeCloseTo(0.9);
  });

  it('maps averageSharpness from [0,500] Laplacian-variance units to [0,1]', () => {
    const result = normalizeFeatures([
      { signal: 'faceGeometry', feature: 'averageSharpness', value: 500, isCategoryDerived: false },
    ]);
    expect(result[0].normalizedValue).toBe(1);
  });

  it('scores averageBrightness highest at the ideal midpoint, lower toward either extreme', () => {
    const ideal = normalizeFeatures([
      {
        signal: 'faceGeometry',
        feature: 'averageBrightness',
        value: 140,
        isCategoryDerived: false,
      },
    ]);
    expect(ideal[0].normalizedValue).toBe(1);

    const tooDark = normalizeFeatures([
      { signal: 'faceGeometry', feature: 'averageBrightness', value: 40, isCategoryDerived: false },
    ]);
    expect(tooDark[0].normalizedValue).toBe(0);

    const tooBright = normalizeFeatures([
      {
        signal: 'faceGeometry',
        feature: 'averageBrightness',
        value: 220,
        isCategoryDerived: false,
      },
    ]);
    expect(tooBright[0].normalizedValue).toBe(0);
  });

  it('inverts occlusionRate so a higher normalizedValue always means better (less occluded)', () => {
    const clear = normalizeFeatures([
      { signal: 'faceGeometry', feature: 'occlusionRate', value: 0, isCategoryDerived: false },
    ]);
    expect(clear[0].normalizedValue).toBe(1);

    const fullyOccluded = normalizeFeatures([
      { signal: 'faceGeometry', feature: 'occlusionRate', value: 1, isCategoryDerived: false },
    ]);
    expect(fullyOccluded[0].normalizedValue).toBe(0);
  });

  it('maps speakerChangeCount from [0,5] to [0,1] and passes the two already-0-1 speaker features through unchanged', () => {
    const changeCount = normalizeFeatures([
      { signal: 'faceGeometry', feature: 'speakerChangeCount', value: 5, isCategoryDerived: false },
    ]);
    expect(changeCount[0].normalizedValue).toBe(1);

    const consistency = normalizeFeatures([
      {
        signal: 'faceGeometry',
        feature: 'dominantSpeakerConsistency',
        value: 0.75,
        isCategoryDerived: false,
      },
    ]);
    expect(consistency[0].normalizedValue).toBe(0.75);

    const syncRate = normalizeFeatures([
      {
        signal: 'faceGeometry',
        feature: 'speakerAudioSyncRate',
        value: 0.6,
        isCategoryDerived: false,
      },
    ]);
    expect(syncRate[0].normalizedValue).toBe(0.6);
  });

  it('maps averageLipVelocity/articulationRate to their own caps, and passes speakingIntensity/pauseCount through as documented', () => {
    const lipVelocity = normalizeFeatures([
      {
        signal: 'faceGeometry',
        feature: 'averageLipVelocity',
        value: 0.5,
        isCategoryDerived: false,
      },
    ]);
    expect(lipVelocity[0].normalizedValue).toBe(1);

    const speakingIntensity = normalizeFeatures([
      {
        signal: 'faceGeometry',
        feature: 'speakingIntensity',
        value: 0.6,
        isCategoryDerived: false,
      },
    ]);
    expect(speakingIntensity[0].normalizedValue).toBe(0.6);

    const pauseCount = normalizeFeatures([
      { signal: 'faceGeometry', feature: 'pauseCount', value: 5, isCategoryDerived: false },
    ]);
    expect(pauseCount[0].normalizedValue).toBe(1);

    const articulationRate = normalizeFeatures([
      { signal: 'faceGeometry', feature: 'articulationRate', value: 2, isCategoryDerived: false },
    ]);
    expect(articulationRate[0].normalizedValue).toBe(1);
  });

  it('maps averageMouthWidth to its own cap, and passes averageCheekRaise/averageEyeSquint/genuineSmileRate through unchanged', () => {
    const mouthWidth = normalizeFeatures([
      { signal: 'faceGeometry', feature: 'averageMouthWidth', value: 1, isCategoryDerived: false },
    ]);
    expect(mouthWidth[0].normalizedValue).toBe(1);

    const cheekRaise = normalizeFeatures([
      {
        signal: 'faceGeometry',
        feature: 'averageCheekRaise',
        value: 0.4,
        isCategoryDerived: false,
      },
    ]);
    expect(cheekRaise[0].normalizedValue).toBe(0.4);

    const eyeSquint = normalizeFeatures([
      { signal: 'faceGeometry', feature: 'averageEyeSquint', value: 0.5, isCategoryDerived: false },
    ]);
    expect(eyeSquint[0].normalizedValue).toBe(0.5);

    const genuineSmile = normalizeFeatures([
      { signal: 'faceGeometry', feature: 'genuineSmileRate', value: 0.7, isCategoryDerived: false },
    ]);
    expect(genuineSmile[0].normalizedValue).toBe(0.7);
  });

  it('maps blinkFrequencyPerMinute/prolongedClosureCount to their own caps, and passes gazeStabilityScore through unchanged', () => {
    const blinkFrequency = normalizeFeatures([
      {
        signal: 'faceGeometry',
        feature: 'blinkFrequencyPerMinute',
        value: 30,
        isCategoryDerived: false,
      },
    ]);
    expect(blinkFrequency[0].normalizedValue).toBe(1);

    const prolongedClosure = normalizeFeatures([
      {
        signal: 'faceGeometry',
        feature: 'prolongedClosureCount',
        value: 5,
        isCategoryDerived: false,
      },
    ]);
    expect(prolongedClosure[0].normalizedValue).toBe(1);

    const gazeStability = normalizeFeatures([
      {
        signal: 'faceGeometry',
        feature: 'gazeStabilityScore',
        value: 0.9,
        isCategoryDerived: false,
      },
    ]);
    expect(gazeStability[0].normalizedValue).toBe(0.9);
  });

  it('maps averageHeadMovementRate to its own cap, dominantAffectWeight down to 0-1, and passes averageBrowActivity/affectConfidence through unchanged', () => {
    const browActivity = normalizeFeatures([
      {
        signal: 'faceGeometry',
        feature: 'averageBrowActivity',
        value: 0.4,
        isCategoryDerived: false,
      },
    ]);
    expect(browActivity[0].normalizedValue).toBe(0.4);

    const headMovement = normalizeFeatures([
      {
        signal: 'faceGeometry',
        feature: 'averageHeadMovementRate',
        value: 30,
        isCategoryDerived: false,
      },
    ]);
    expect(headMovement[0].normalizedValue).toBe(1);

    const affectWeight = normalizeFeatures([
      {
        signal: 'faceGeometry',
        feature: 'dominantAffectWeight',
        value: 90,
        isCategoryDerived: true,
        label: 'positive_affect',
      },
    ]);
    expect(affectWeight[0].normalizedValue).toBeCloseTo(0.9);

    const affectConfidence = normalizeFeatures([
      { signal: 'faceGeometry', feature: 'affectConfidence', value: 1, isCategoryDerived: false },
    ]);
    expect(affectConfidence[0].normalizedValue).toBe(1);
  });

  it('passes ocr rate features through unchanged, maps dominantTextCategoryWeight down to 0-1, and caps averageTextBlockCount', () => {
    const subtitleRate = normalizeFeatures([
      { signal: 'ocr', feature: 'subtitleCoverageRate', value: 0.8, isCategoryDerived: false },
    ]);
    expect(subtitleRate[0].normalizedValue).toBe(0.8);

    const categoryWeight = normalizeFeatures([
      {
        signal: 'ocr',
        feature: 'dominantTextCategoryWeight',
        value: 60,
        isCategoryDerived: true,
        label: 'subtitle',
      },
    ]);
    expect(categoryWeight[0].normalizedValue).toBeCloseTo(0.6);

    const textBlockCount = normalizeFeatures([
      { signal: 'ocr', feature: 'averageTextBlockCount', value: 3, isCategoryDerived: false },
    ]);
    expect(textBlockCount[0].normalizedValue).toBe(1);
  });

  it('caps averageObjectsPerFrame and passes averageTrackingConfidence/averagePersistence through unchanged (Batch OI-1)', () => {
    const objectCount = normalizeFeatures([
      { signal: 'object', feature: 'averageObjectsPerFrame', value: 3, isCategoryDerived: false },
    ]);
    expect(objectCount[0].normalizedValue).toBe(1);

    const trackingConfidence = normalizeFeatures([
      {
        signal: 'object',
        feature: 'averageTrackingConfidence',
        value: 0.85,
        isCategoryDerived: false,
      },
    ]);
    expect(trackingConfidence[0].normalizedValue).toBe(0.85);

    const persistence = normalizeFeatures([
      { signal: 'object', feature: 'averagePersistence', value: 0.4, isCategoryDerived: false },
    ]);
    expect(persistence[0].normalizedValue).toBe(0.4);
  });

  it("passes object's already-0-1 averageMotionSpeed through unchanged (Batch OI-2)", () => {
    const result = normalizeFeatures([
      { signal: 'object', feature: 'averageMotionSpeed', value: 0.3, isCategoryDerived: false },
    ]);
    expect(result[0].normalizedValue).toBe(0.3);
  });

  it("passes object's already-0-1 averageOcclusionScore through unchanged (Batch OI-3)", () => {
    const result = normalizeFeatures([
      { signal: 'object', feature: 'averageOcclusionScore', value: 0.1, isCategoryDerived: false },
    ]);
    expect(result[0].normalizedValue).toBe(0.1);
  });

  it("passes object's already-0-1 averageInteractionConfidence through unchanged (Batch OI-4)", () => {
    const result = normalizeFeatures([
      {
        signal: 'object',
        feature: 'averageInteractionConfidence',
        value: 0.2,
        isCategoryDerived: false,
      },
    ]);
    expect(result[0].normalizedValue).toBe(0.2);
  });

  it("passes object's already-0-1 averageAttentionScore through unchanged (Batch OI-5)", () => {
    const result = normalizeFeatures([
      { signal: 'object', feature: 'averageAttentionScore', value: 0.6, isCategoryDerived: false },
    ]);
    expect(result[0].normalizedValue).toBe(0.6);
  });

  it('throws for an unregistered feature name', () => {
    expect(() =>
      normalizeFeatures([
        { signal: 'audio', feature: 'unknownFeature', value: 1, isCategoryDerived: false },
      ]),
    ).toThrow();
  });

  it('passes every speaker field through unchanged (already 0-1 by contract)', () => {
    const result = normalizeFeatures([
      {
        signal: 'speaker',
        feature: 'dominantSpeakerConfidence',
        value: 0.42,
        isCategoryDerived: false,
      },
      {
        signal: 'speaker',
        feature: 'averageSpeakerHighlightScore',
        value: 0.9,
        isCategoryDerived: false,
      },
    ]);
    expect(result[0].normalizedValue).toBe(0.42);
    expect(result[1].normalizedValue).toBe(0.9);
  });
});

describe('weightFeatures', () => {
  it('splits a signal weight evenly across however many of its own features are present', () => {
    const result = weightFeatures(
      [
        {
          signal: 'facial',
          feature: 'dominantEmotionWeight',
          value: 90,
          normalizedValue: 0.9,
          isCategoryDerived: true,
          label: 'happy',
        },
        {
          signal: 'facial',
          feature: 'peakConfidence',
          value: 0.9,
          normalizedValue: 0.9,
          isCategoryDerived: false,
        },
      ],
      { facial: 0.2 },
    );
    expect(result[0].weight).toBeCloseTo(0.1);
    expect(result[1].weight).toBeCloseTo(0.1);
  });

  it('assigns weight 0 to a signal missing from the weight table', () => {
    const result = weightFeatures(
      [
        {
          signal: 'gesture',
          feature: 'peakConfidence',
          value: 0.9,
          normalizedValue: 0.9,
          isCategoryDerived: false,
        },
      ],
      { audio: 0.35 },
    );
    expect(result[0].weight).toBe(0);
    expect(result[0].weightedContribution).toBe(0);
  });
});
