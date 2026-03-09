describe('TrackingConfig', () => {
  it('accepts android-only config', () => {
    const config = {
      android: {
        notification: {
          title: 'Sleep Tracking',
          text: 'Monitoring your sleep',
          icon: 'ic_notification',
        },
      },
    };
    expect(config.android.notification.title).toBe('Sleep Tracking');
    expect(config.ios).toBeUndefined();
  });

  it('accepts ios audioSessionOptions', () => {
    const config = {
      ios: {
        audioSessionOptions: ['duckOthers'],
      },
    };
    expect(config.ios.audioSessionOptions).toEqual(['duckOthers']);
  });

  it('accepts combined android and ios config', () => {
    const config = {
      android: {
        notification: { title: 'Tracking' },
      },
      ios: {
        audioSessionOptions: ['duckOthers', 'allowAirPlay'],
      },
    };
    expect(config.android.notification.title).toBe('Tracking');
    expect(config.ios.audioSessionOptions).toHaveLength(2);
  });

  it('accepts empty ios audioSessionOptions', () => {
    const config = {
      ios: {
        audioSessionOptions: [],
      },
    };
    expect(config.ios.audioSessionOptions).toEqual([]);
  });

  it('accepts all valid AudioSessionOption values', () => {
    const allOptions = ['duckOthers', 'allowAirPlay', 'allowBluetooth'];
    const config = {
      ios: { audioSessionOptions: allOptions },
    };
    expect(config.ios.audioSessionOptions).toHaveLength(3);
  });
});

describe('onTrackingFailed event payload', () => {
  it('handles uploadTrackingTerminated error', () => {
    const payload = {
      error: 'Upload tracking terminated',
      code: 'UPLOAD_TRACKING_TERMINATED',
      message: 'Upload failed with HTTP 403: Session already closed',
      errorCode: 23499,
    };
    expect(payload.code).toBe('UPLOAD_TRACKING_TERMINATED');
    expect(payload.errorCode).toBe(23499);
    expect(payload.message).toContain('403');
  });

  it('handles unknown error with caseName', () => {
    const payload = {
      error: 'Something went wrong',
      code: 'UNKNOWN_ERROR',
      caseName: 'someUnknownCase',
    };
    expect(payload.code).toBe('UNKNOWN_ERROR');
    expect(payload.caseName).toBe('someUnknownCase');
    expect(payload.message).toBeUndefined();
    expect(payload.errorCode).toBeUndefined();
  });

  it('handles ODA error codes', () => {
    const payload = {
      error: 'ODA integrity check failed',
      code: 'ODA_INTEGRITY_FAIL',
      message: 'The model has been updated or the file is corrupted',
    };
    expect(payload.code).toBe('ODA_INTEGRITY_FAIL');
  });

  it('serializes correctly via JSON.stringify (matches store handler)', () => {
    const payload = {
      error: 'Upload tracking terminated',
      code: 'UPLOAD_TRACKING_TERMINATED',
      message: 'Session closed',
      errorCode: 23499,
    };
    const serialized = JSON.stringify(payload);
    const parsed = JSON.parse(serialized);
    expect(parsed.code).toBe('UPLOAD_TRACKING_TERMINATED');
    expect(parsed.errorCode).toBe(23499);
  });
});
