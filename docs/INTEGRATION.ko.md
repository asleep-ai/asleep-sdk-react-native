# react-native-asleep Integration Guide

[English](./INTEGRATION.md) | 한국어

[README로 돌아가기](../README.ko.md)

이 문서는 `react-native-asleep`을 실제 서비스 앱에 연동할 때 필요한 수명 주기, 상태 소유권, 복구, 리포트 처리, 출시 전 검증을 설명합니다. 설치와 첫 측정은 먼저 [README](../README.ko.md)를 참고하세요.

아래의 복원 후 항상 초기화하는 흐름은 `initAsleepConfig()`를 사용하는 서비스 방식의 수면 측정을 기준으로 합니다. 새 ODA(On-Device Analysis) 세션은 `setup()`으로 구성하지만, `setup()`은 활성 tracking 중에는 호출할 수 없으므로 복원 정책을 별도로 설계해야 합니다.

## 1. 전체 수명 주기

정상 경로와 복원 경로 모두 같은 초기화 단계를 거칩니다.

```text
앱 시작
→ useAsleep() mount 또는 Asleep.initialize()
→ checkAndRestoreTracking()
→ initAsleepConfig()                    // iOS는 user event까지 대기
→ checkBatteryOptimization()
→ 사용자 동작에서 권한 요청
→ startTracking()                       // 활성 세션이 없을 때만
→ stopTracking()
→ 리포트 조회
```

각 단계의 역할은 다릅니다.

| 단계 | 역할 |
|---|---|
| `checkAndRestoreTracking()` | Android의 기존 native session 존재 여부를 확인하고 service에 다시 연결 |
| `initAsleepConfig()` | 현재 앱 실행에 API key, `userId`, endpoint 구성을 적용 |
| `checkBatteryOptimization()` | `startTracking()`의 선행 조건을 충족하고 Android 장기 측정 가능 여부를 확인 |
| `requestRequiredPermissions()` | 사용자 동작에서 런타임 권한 요청 |
| `startTracking()` | 새 native session 시작 |

복원된 session이 있어도 초기화를 생략하지 않습니다. `initAsleepConfig()`는 tracking 상태에서도 호출할 수 있도록 설계되어 있습니다. 반대로 기존 session이 활성 상태라면 `startTracking()`을 다시 호출하지 않습니다.

iOS bridge는 복원 가능한 session을 보고하지 않지만 `startTracking()`의 공통 선행 조건을 충족하기 위해 `checkAndRestoreTracking()`을 호출합니다. 실제 service 재연결은 Android 전용입니다.

앱 최상단의 한 곳에서 이 순서를 실행하고, 여러 화면이 각각 초기화를 시작하지 않도록 하세요.

```tsx
import { useCallback, useState } from "react";
import { Platform } from "react-native";
import { AsleepError, useAsleep } from "react-native-asleep";

export function useAsleepBootstrap(apiKey: string, stableUserId?: string) {
  const asleep = useAsleep();
  const [isReady, setIsReady] = useState(false);
  const [isBatteryExempted, setIsBatteryExempted] = useState(false);

  const initialize = useCallback(async () => {
    await asleep.checkAndRestoreTracking();

    const config = {
      apiKey,
      userId: stableUserId,
    };

    if (Platform.OS === "ios") {
      let removeJoined = () => {};
      let removeFailed = () => {};
      const configurationFinished = new Promise<void>((resolve, reject) => {
        removeJoined = asleep.addEventListener("onUserJoined", () => resolve());
        removeFailed = asleep.addEventListener(
          "onUserJoinFailed",
          (failure) => {
            reject(
              new AsleepError(
                "USER_JOIN_FAILED",
                failure.detail ?? failure.error ?? "사용자 설정 실패",
                {
                  sdkCode: failure.sdkCode,
                  caseName: failure.caseName,
                  cause: failure,
                },
              ),
            );
          },
        );
      });

      try {
        await Promise.all([
          asleep.initAsleepConfig(config),
          configurationFinished,
        ]);
      } finally {
        removeJoined();
        removeFailed();
      }
    } else {
      await asleep.initAsleepConfig(config);
    }

    const battery = await asleep.checkBatteryOptimization();

    setIsBatteryExempted(battery.exempted);
    setIsReady(true);
  }, [
    apiKey,
    stableUserId,
    asleep.checkAndRestoreTracking,
    asleep.initAsleepConfig,
    asleep.addEventListener,
    asleep.checkBatteryOptimization,
  ]);

  return { ...asleep, initialize, isReady, isBatteryExempted };
}
```

iOS의 bridge 호출은 native user 설정을 시작한 뒤 tracking/report manager가 준비되기 전에 반환될 수 있습니다. 따라서 호출 전에 `onUserJoined`와 `onUserJoinFailed`를 등록하고 둘 중 하나가 발생할 때까지 기다립니다. `isSetupComplete`만으로 iOS 준비 완료를 판단하면 안 됩니다. 현재 bridge action은 user-join delegate가 native manager를 만들기 전에 이 값을 갱신할 수 있습니다. Android에서는 `initAsleepConfig()` 자체의 Promise만 기다립니다. 복원된 service의 빠른 경로는 Promise를 resolve하지만 `onUserJoined`를 보내지 않기 때문입니다.

앱의 integration owner에서 `initialize()`를 한 번 호출하고 실패하면 tracking UI를 비활성화한 채 앱이 소유한 재시도 동작을 제공하세요.

API key는 소스에 커밋하지 말고 앱의 배포 환경에 맞는 secret/config 관리 방식을 사용하세요. SDK의 `userId`와 앱 계정의 대응 관계, ID 저장 및 변경 정책은 소비 앱이 소유합니다. 활성 session 중에는 다른 `userId`로 다시 초기화하지 마세요.

## 2. 권한과 Android 배터리 최적화

`startTracking()`은 권한 대화상자를 열지 않습니다. 먼저 비대화형 확인을 하고, 버튼 탭처럼 사용자가 원인을 이해할 수 있는 동작에서 권한을 요청하세요.

```ts
async function ensureTrackingPermission() {
  if (await asleep.hasRequiredPermissions()) return true;
  return asleep.requestRequiredPermissions();
}
```

Android에서는 `checkBatteryOptimization()` 결과가 `exempted: false`이면 사용자 동작에서 `requestBatteryOptimizationExemption()`을 호출합니다. 시스템 설정 화면에서 돌아온 뒤 실제 상태를 다시 확인하세요.

```ts
async function prepareAndroidBattery() {
  const battery = await asleep.checkBatteryOptimization();
  if (battery.exempted) return true;

  await asleep.requestBatteryOptimizationExemption();
  return false;
}
```

iOS의 `checkBatteryOptimization()`은 `{ exempted: true, platform: "ios" }`를 반환하므로 플랫폼 공통 순서를 유지할 수 있습니다.

Android 13 이상에서는 `requestRequiredPermissions()`가 알림 권한도 요청하지만 반환값은 마이크 측정 가능 여부를 나타냅니다. 알림 거절 UX는 앱 정책으로 별도 처리할 수 있습니다.

## 3. 앱 상태와 SDK 상태의 경계

SDK는 native SDK에서 확인한 사실을 저장하고, 제품 정책과 영속 상태는 앱이 관리합니다.

| SDK가 관리 | 앱이 관리 |
|---|---|
| `status`, `isTracking`, `isTrackingPaused` | 화면 상태와 사용자 안내 |
| `isRecoveryRequired`, `error` | 재시도 횟수와 재시도 시점 |
| `sessionId`, `userId` | SDK ID와 앱 계정의 연결 및 영속화 |
| `analysisResult`, `isAnalyzing` | 분석 결과의 표시와 서버 동기화 |
| `didClose`, `isSetupComplete` | 측정 시작 wall-clock, 타이머, 알람 |

`trackingStartTime`은 공개 API가 아닙니다. 경과 시간은 앱이 시작 시각을 저장하고 현재 시각과의 차이로 계산하세요. interval 횟수를 누적하면 앱이 백그라운드에 있는 동안 시간이 틀어질 수 있습니다.

다음 항목은 SDK에 넣지 않고 소비 앱에 둡니다.

- 인증과 cloud sync
- Alarm, Live Activity, Widget, Health 연동
- 권한 거절 화면, alert, toast
- analytics와 observability
- 리포트 재시도 및 사용자 알림 정책
- 수면 단계 문구와 제품별 지표 계산

부가 기능의 실패가 `startTracking()`이나 `stopTracking()` 실행 자체를 건너뛰게 하지 않도록 경계를 분리하세요.

## 4. listener 수명 주기

`useAsleep()`은 mount 시 native listener를 연결하고 unmount 시 정리합니다. 앱의 안정적인 상위 컴포넌트에서 훅을 유지하면 화면 전환 중 listener가 불필요하게 반복 연결되는 것을 피할 수 있습니다.

React 훅을 사용할 수 없는 백그라운드 callback이나 서비스 계층에서는 `Asleep`을 사용합니다.

```ts
import { Asleep } from "react-native-asleep";

const teardown = Asleep.initialize();

const unsubscribe = Asleep.subscribe((state) => {
  console.log(state.status, state.error?.code);
});

const removeAnalysisListener = Asleep.addEventListener(
  "onAnalysisResult",
  (result) => {
    console.log(result);
  },
);

// 해당 소유자의 수명 주기가 끝날 때
removeAnalysisListener();
unsubscribe();
teardown();
```

`Asleep.initialize()`는 ref-counted이므로 mount된 `useAsleep()`과 함께 사용할 수 있습니다. 다만 호출한 소유자는 반환된 teardown 함수를 반드시 실행해야 합니다. 패키지를 import하는 것만으로는 listener가 연결되지 않습니다.

## 5. 측정 시작과 종료

새 측정은 bootstrap이 완료되고 활성 session이 없을 때만 시작합니다.

```ts
async function startSleepTracking() {
  if (!isReady || asleep.isTracking) return;

  if (!(await prepareAndroidBattery())) {
    return;
  }

  if (!(await ensureTrackingPermission())) {
    return;
  }

  await asleep.startTracking({
    android: {
      notification: {
        title: "수면 측정 중",
        text: "수면 분석을 위해 오디오를 처리하고 있습니다.",
      },
    },
  });
}

async function handleTrackingPress() {
  const shouldStop =
    asleep.isTracking || asleep.error?.category === "recordingDead";

  if (shouldStop) {
    await asleep.stopTracking();
    return;
  }

  await startSleepTracking();
}
```

`startTracking()`은 다음 조건을 직접 검증하고 `AsleepError`를 throw합니다.

- 앱 시작 후 `checkAndRestoreTracking()`을 호출했는가
- `checkBatteryOptimization()`을 호출했는가
- setup이 진행 중이 아닌가
- 이미 측정 중이 아닌가
- 마이크 권한이 있는가
- Android 배터리 최적화에서 제외됐는가

정상 종료는 `stopTracking()`이 성공한 뒤 앱이 관리하는 타이머와 부가 상태를 정리합니다. 먼저 앱 상태를 지우면 native 종료 실패 후 복구할 근거를 잃을 수 있습니다.

버튼 문구와 동작도 같은 `shouldStop` 조건을 사용하세요. `recordingDead` 오류에서는 `isTracking === false`여도 native session이 열려 있으므로 예외적으로 `stopTracking()`을 호출해야 합니다. 반면 `terminal`은 native session이 이미 종료된 상태입니다.

## 6. 플랫폼 차이와 복구

### Android

- 측정은 별도 foreground service에서 실행됩니다.
- 앱 process가 다시 시작되면 `checkAndRestoreTracking()`이 살아 있는 측정을 확인하고 service에 재연결합니다.
- 장기 측정 전 배터리 최적화 제외 여부를 확인해야 합니다.
- `requestAnalysis()` Promise가 전체 분석 결과를 반환하고 `onAnalysisResult` 이벤트도 발생시킵니다.

### iOS

- 백그라운드 측정을 위해 `UIBackgroundModes: ["audio"]`가 필요합니다.
- 전화나 다른 오디오 session 때문에 측정이 `paused` 또는 `recoveryRequired` 상태가 될 수 있습니다.
- `resumeTracking()`은 iOS 전용이며 Android에서는 `UNSUPPORTED_PLATFORM`을 throw합니다.
- `requestAnalysis()` Promise는 `{ status: "requested", timestamp }` acknowledgment를 반환하고 실제 결과는 `onAnalysisResult` 이벤트로 도착합니다.

iOS에서 `isRecoveryRequired === true`이고 앱이 foreground로 돌아오면 중복 호출을 막으며 `resumeTracking()`을 호출하세요. Promise 성공만으로 복구 완료로 판단하지 않습니다. 다음 audio upload가 성공해야 `isRecoveryRequired`가 `false`로 바뀝니다.

```tsx
import { useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";
import type { AsleepPublicApi } from "react-native-asleep";

export function useIosRecovery(asleep: AsleepPublicApi) {
  const resumeInFlight = useRef(false);

  useEffect(() => {
    if (Platform.OS !== "ios") return;

    const resumeIfNeeded = (appState: string) => {
      if (
        appState !== "active" ||
        !asleep.isRecoveryRequired ||
        resumeInFlight.current
      ) {
        return;
      }

      resumeInFlight.current = true;
      void asleep
        .resumeTracking()
        .catch(() => {
          // 분류된 실패는 asleep.error에서도 확인할 수 있습니다.
        })
        .finally(() => {
          resumeInFlight.current = false;
        });
    };

    resumeIfNeeded(AppState.currentState);
    const subscription = AppState.addEventListener("change", resumeIfNeeded);

    return () => subscription.remove();
  }, [asleep.isRecoveryRequired, asleep.resumeTracking]);
}
```

### 오류 category별 처리

| `error.category` | native 상태 | 앱 처리 |
|---|---|---|
| `recoveryRequired` | session은 살아 있고 foreground 복구 필요 | iOS foreground에서 `resumeTracking()`, 이후 upload로 복구 확인 |
| `recordingDead` | recorder는 종료됐지만 session은 열려 있음 | `stopTracking()` 성공 후 새 측정 |
| `terminal` | session이 종료됐으며 close 이벤트가 오지 않을 수 있음 | 앱의 기존 session 상태를 정리하고 새 측정 |
| `transient` | session이 유지됨 | 측정을 유지하고 이후 upload와 상태 관찰 |
| `unknown` | 분류되지 않음 | 정상으로 가정하지 말고 오류 전체를 기록 |

문자열 message나 iOS enum 순번이 아니라 `error.code`와 `error.category`로 분기하세요. native SDK의 문서화된 숫자 코드가 필요하면 `error.sdkCode`를 사용합니다. 원본 오류는 `error.cause`에 보존됩니다.

## 7. 분석 결과와 리포트

### 실시간 분석

`requestAnalysis()`의 Promise 반환 형태는 플랫폼마다 다르지만, reactive `analysisResult`는 두 플랫폼 모두 `onAnalysisResult` 이벤트만 갱신합니다. 앱의 공통 UI는 Promise 결과보다 `analysisResult`를 구독하는 편이 안전합니다.

| 플랫폼 | `requestAnalysis()` 반환 | 공통 상태 갱신 |
|---|---|---|
| Android | `AsleepAnalysisResult` | `onAnalysisResult` → `analysisResult` |
| iOS | `AsleepAnalysisAck` | `onAnalysisResult` → `analysisResult` |

Android에서 Promise 결과를 별도로 store에 다시 쓰면 같은 분석에 대해 중복 update가 발생할 수 있습니다.

### 완료 리포트

| API | 반환 |
|---|---|
| `getReport(sessionId)` | 단일 `AsleepReport` |
| `getReportList(fromDate, toDate)` | `AsleepSession[]` |
| `getAverageReport(fromDate, toDate)` | `AsleepAverageReport` |
| `deleteSession(sessionId)` | session 삭제 완료 |

모든 조회 실패는 `AsleepError`로 throw됩니다. 네이티브 코드가 리포트 payload 없이 resolve하면 wrapper가 `REPORT_NOT_FOUND`를 생성하지만, 플랫폼 SDK의 실패는 Android의 `REPORT_ERROR`처럼 다른 `AsleepError.code`로 도착할 수 있습니다. 모든 리포트 오류를 일괄 재시도하지 마세요. 앱이 실제로 확인한 미생성 리포트 조건만 제한적으로 재시도하고, 네트워크·인증을 비롯한 다른 실패는 그대로 노출해야 합니다.

`getReportList()`는 현재 native SDK에서 최대 100개를 반환하며 별도 pagination API는 없습니다. 날짜는 `YYYY-MM-DD` 형식으로 전달하세요.

재시도 횟수, 간격, backoff, 취소와 사용자 안내는 앱 정책입니다.

## 8. 프로덕션 체크리스트

### 빌드와 설정

- [ ] SDK 버전을 의도적으로 고정하고 업그레이드 시 CHANGELOG 확인
- [ ] 설치 또는 버전 변경 후 iOS/Android 네이티브 빌드 생성
- [ ] iOS 마이크 설명과 `UIBackgroundModes: ["audio"]` 확인
- [ ] Android merged manifest에 foreground service와 필요한 권한이 포함됐는지 확인
- [ ] API key가 소스와 로그에 노출되지 않는지 확인

### cold start와 권한

- [ ] 앱 데이터와 권한을 지운 실제 기기에서 첫 실행
- [ ] 마이크 허용, 거절, 다시 허용하는 흐름
- [ ] Android 13 이상 알림 거절 상태에서 측정과 알림 UX 확인
- [ ] Android 배터리 최적화 설정을 연 뒤 앱 복귀 시 상태 재확인

### 수명 주기와 복구

- [ ] `checkAndRestoreTracking()` → `initAsleepConfig()` → `checkBatteryOptimization()` 순서 확인
- [ ] 활성 session 복원 뒤에도 `initAsleepConfig()`가 실행되는지 확인
- [ ] 활성 session에서 `startTracking()`을 중복 호출하지 않는지 확인
- [ ] Android 앱 process 종료 후 foreground service session 복원
- [ ] iOS 오디오 중단 후 foreground `resumeTracking()`과 다음 upload 확인
- [ ] `recordingDead`에서 `stopTracking()` 후 새 측정
- [ ] `terminal`, `transient`, `unknown` 오류 분기 확인
- [ ] listener와 `Asleep.initialize()` teardown 누락이 없는지 확인

### 데이터와 장시간 측정

- [ ] Android와 iOS의 `requestAnalysis()` 반환 차이 확인
- [ ] `analysisResult`를 이벤트 기반으로 한 번만 갱신
- [ ] 정상적인 빈 리포트 목록과 조회 실패를 구분
- [ ] 두 플랫폼에서 미생성 리포트와 네트워크·인증 등 다른 실패를 구분
- [ ] 지원하는 대표 iOS/Android 실제 기기에서 백그라운드 장시간 측정 완료

시뮬레이터의 오디오 동작이나 warm start만으로 출시 가능 여부를 판단하지 마세요. 권한이 없는 cold start, process 복원, 실제 백그라운드 장시간 측정이 각각 필요합니다.

## 참고

- [SDK README](../README.ko.md)
- [English Integration Guide](./INTEGRATION.md)
- [Asleep 개발자 문서](https://docs.asleep.ai)
