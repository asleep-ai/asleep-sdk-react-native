# react-native-asleep

[English](./README.md) | 한국어

Asleep의 AI 기술로 기기 마이크의 오디오를 분석하는 React Native 수면 측정 SDK입니다. 웨어러블 없이 수면 단계를 감지하고 상세 리포트를 제공합니다.

> 이 SDK는 활발히 개발 중입니다. v2는 의도적으로 작은 공개 API를 제공하므로 정확한 버전으로 고정하고 업그레이드 전에 [CHANGELOG](./CHANGELOG.md)를 확인하세요.

## 포함된 기능

- iOS와 Android 수면 측정
- React 컴포넌트를 위한 `useAsleep()` 훅
- React 외부 환경을 위한 `Asleep` API
- 측정 상태, 분석 결과, 구조화된 `AsleepError`
- 세션 리포트, 기간별 목록, 평균 리포트
- Android foreground service 복원과 iOS 오디오 중단 복구

## 요구 사항

| 구성 요소 | 기준 |
|---|---|
| React Native | 0.74 이상 |
| React | 18.2 이상 |
| iOS deployment target | 14.0 이상 |
| Android `minSdkVersion` | 24 이상 |

현재 예제 앱은 React Native 0.79.2, Expo 53, React 19.0.0, Android compile/target SDK 34를 기준으로 검증합니다.

번들된 네이티브 SDK 버전은 다음과 같습니다. React Native 패키지는 독립 semver를 사용하며, 버전 번호가 네이티브 SDK 버전을 따르지 않습니다.

| react-native-asleep | iOS SDK | Android SDK |
|---|---|---|
| 2.1.0 | 3.3.3 | 3.3.1 |
| 2.0.0 | 3.3.2 | 3.3.1 |
| 1.0.17 – 1.2.0 | 3.2.0 | 3.2.1 |
| 1.0.15 | 3.2.0 | 3.2.0 |
| 1.0.14 | 3.1.8 | 3.1.5 |
| 1.0.13 | 3.1.6 | 3.1.4 |

1.2.0에는 이미 호환이 깨지는 v2 API가 들어 있었고, 2.0.0은 같은 API를 semver에 맞게 다시 배포한 버전입니다.

## 설치

Expo 프로젝트:

```bash
expo install react-native-asleep
```

Bare React Native 프로젝트는 먼저 Expo Modules를 설치한 뒤 패키지를 추가합니다.

```bash
npx install-expo-modules@latest
npm install react-native-asleep
```

Bare 프로젝트의 iOS 디렉터리에서는 CocoaPods 의존성을 설치합니다.

```bash
bundle install
bundle exec pod install
```

이 패키지는 네이티브 모듈을 포함하므로 설치하거나 버전을 변경한 뒤에는 새 네이티브 빌드가 필요합니다. Expo Go 또는 OTA 업데이트만으로는 네이티브 연동을 검증할 수 없습니다.

monorepo에서 `react-native-asleep`이 상위 `node_modules`로 hoist된다면 앱의 `package.json`에 Expo autolinking 경로를 지정합니다.

```json
{
  "expo": {
    "autolinking": {
      "nativeModulesDir": ".."
    }
  }
}
```

## 네이티브 설정

[Asleep Dashboard](https://dashboard.asleep.ai)에서 API key를 생성합니다.

### iOS

Expo 프로젝트는 `app.json`에 마이크 사용 설명과 백그라운드 오디오 모드를 추가합니다.

```json
{
  "expo": {
    "ios": {
      "infoPlist": {
        "NSMicrophoneUsageDescription": "수면 중 소리를 분석하기 위해 마이크를 사용합니다.",
        "UIBackgroundModes": ["audio"]
      }
    }
  }
}
```

Bare 프로젝트는 같은 값을 앱의 `Info.plist`에 선언합니다.

```xml
<key>NSMicrophoneUsageDescription</key>
<string>수면 중 소리를 분석하기 위해 마이크를 사용합니다.</string>
<key>UIBackgroundModes</key>
<array>
  <string>audio</string>
</array>
```

iOS podspec은 정적 framework를 사용합니다. 프로젝트가 이미 `use_frameworks!`를 사용한다면 정적 링크로 지정하세요.

```ruby
use_frameworks! :linkage => :static
```

### Android

필요한 권한과 foreground service는 라이브러리 manifest에서 선언하며 앱 manifest에 다시 복사할 필요가 없습니다. 측정 시작 전에는 다음 항목을 앱에서 확인해야 합니다.

- `requestRequiredPermissions()`로 마이크 런타임 권한 요청
- `checkBatteryOptimization()`으로 배터리 최적화 제외 여부 확인
- 제외되지 않았다면 사용자 동작에서 `requestBatteryOptimizationExemption()` 호출

Android 13 이상에서는 `requestRequiredPermissions()`가 foreground service 알림 표시를 위해 알림 권한도 요청합니다. 반환값은 측정에 필수인 마이크 권한 허용 여부를 나타냅니다.

## Quick Start

새 세션과 복원된 세션 모두 아래 순서를 사용합니다.

```text
checkAndRestoreTracking()
→ initAsleepConfig()
→ checkBatteryOptimization()
→ 사용자 동작에서 권한 요청
→ startTracking()
```

복원된 세션이 있어도 `initAsleepConfig()`를 항상 호출합니다. 복원은 네이티브 측정 상태를 다시 연결하고, 초기화는 현재 앱 실행에 API key와 사용자 구성을 적용하는 별도의 단계입니다.

```tsx
import { useEffect, useRef, useState } from "react";
import { Button, Platform, Text, View } from "react-native";
import { AsleepError, useAsleep } from "react-native-asleep";

export function SleepTracker() {
  const hasBootstrapped = useRef(false);
  const {
    status,
    isTracking,
    error,
    checkAndRestoreTracking,
    initAsleepConfig,
    addEventListener,
    checkBatteryOptimization,
    requestBatteryOptimizationExemption,
    hasRequiredPermissions,
    requestRequiredPermissions,
    startTracking,
    stopTracking,
  } = useAsleep();
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (hasBootstrapped.current) return;
    hasBootstrapped.current = true;

    void (async () => {
      try {
        await checkAndRestoreTracking();

        const config = { apiKey: "YOUR_API_KEY" };
        if (Platform.OS === "ios") {
          let removeJoined = () => {};
          let removeFailed = () => {};
          const configurationFinished = new Promise<void>(
            (resolve, reject) => {
              removeJoined = addEventListener("onUserJoined", () => resolve());
              removeFailed = addEventListener(
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
            },
          );

          try {
            await Promise.all([
              initAsleepConfig(config),
              configurationFinished,
            ]);
          } finally {
            removeJoined();
            removeFailed();
          }
        } else {
          await initAsleepConfig(config);
        }

        await checkBatteryOptimization();
        setIsReady(true);
      } catch {
        // `error`에도 같은 AsleepError가 반영됩니다.
      }
    })();
  }, [
    checkAndRestoreTracking,
    initAsleepConfig,
    addEventListener,
    checkBatteryOptimization,
  ]);

  const handleStart = async () => {
    try {
      const battery = await checkBatteryOptimization();
      if (Platform.OS === "android" && !battery.exempted) {
        await requestBatteryOptimizationExemption();
        // 설정에서 돌아온 뒤 checkBatteryOptimization()으로 다시 확인하세요.
        return;
      }

      if (!(await hasRequiredPermissions())) {
        const granted = await requestRequiredPermissions();
        if (!granted) return;
      }

      await startTracking({
        android: {
          notification: {
            title: "수면 측정 중",
            text: "수면 분석을 위해 오디오를 처리하고 있습니다.",
          },
        },
      });
    } catch (cause) {
      if (!(cause instanceof AsleepError)) throw cause;
    }
  };

  const handleStop = async () => {
    try {
      await stopTracking();
    } catch (cause: unknown) {
      if (!(cause instanceof AsleepError)) throw cause;
    }
  };

  const shouldStop =
    isTracking || error?.category === "recordingDead";

  return (
    <View>
      <Text>상태: {status}</Text>
      {error ? <Text>{error.message}</Text> : null}
      <Button
        title={shouldStop ? "측정 종료" : "측정 시작"}
        disabled={!isReady}
        onPress={shouldStop ? handleStop : handleStart}
      />
    </View>
  );
}
```

iOS의 `initAsleepConfig()`는 native user 설정을 비동기로 시작하지만 bridge 호출은 manager 준비 전에 반환될 수 있습니다. 위 예제처럼 호출 전에 user event를 등록하고 `onUserJoined` 또는 `onUserJoinFailed`까지 기다리세요. Android는 설정 완료 뒤 Promise가 끝나며, 복원된 service의 빠른 경로에서는 `onUserJoined`가 발생하지 않으므로 event를 추가로 기다리면 안 됩니다.

`recordingDead`도 예외입니다. `isTracking`은 `false`지만 native session은 열려 있으므로 새 측정을 시작하기 전에 `stopTracking()`을 호출해야 합니다.

새 ODA(On-Device Analysis) 세션을 구성할 때는 `initAsleepConfig()` 대신 `setup()`을 사용합니다. `setup()`은 활성 tracking 중에는 호출할 수 없으므로 ODA 복원 정책은 별도로 설계하세요.

## 핵심 API

```ts
import {
  Asleep,
  AsleepError,
  useAsleep,
  type AsleepReport,
  type AsleepSession,
  type TrackingStatus,
} from "react-native-asleep";
```

### 인증 정보

`setup()`과 `initAsleepConfig()`는 `AsleepCredentials` 타입의 인증 방식 중 정확히 하나만 받습니다.

```ts
const asleep = useAsleep();

await asleep.initAsleepConfig({ apiKey: "YOUR_API_KEY", userId });
// 또는 토큰 인증
await asleep.initAsleepConfig({ appId: "YOUR_APP_ID", appSecret: "YOUR_APP_SECRET", userId });
```

`apiKey`와 `appId`/`appSecret`을 함께 넣으면 타입 오류입니다. 런타임에서 둘 다 없거나, 둘 다 있거나, 한쪽만 있는 쌍이거나, 빈 문자열이면 native 호출 전에 `INVALID_ARGUMENT` 코드의 `AsleepError`로 reject합니다. secret도 API key처럼 소스에 커밋하지 마세요.

### 기기 등록

`setup()`은 앱이 실행되는 하드웨어 제품을 Asleep에 등록할 수 있습니다(`POST customer/v1/products`). 두 인증 방식 모두에서 `productInfo`를 전달합니다.

```ts
import type { AsleepProductInfo } from "react-native-asleep";

const productInfo: AsleepProductInfo = {
  model: "YOUR_PRODUCT_MODEL",
  identifierType: "serial", // 또는 "mac_address"
  identifierValue: deviceSerialNumber,
};
await asleep.setup({ apiKey: "YOUR_API_KEY", productInfo });
```

iOS SDK 3.3.2, Android SDK 3.3.1 기준 동작입니다.

- `productInfo`는 `setup()`만 받으며 `initAsleepConfig()`는 받지 않습니다. 등록이 성공한 뒤 생성된 session이 제품에 연결되므로 `startTracking()` 전에 등록하세요. `productInfo`를 생략하면 등록을 건너뛰고 기존 `setup()` 동작을 유지합니다.
- `model`은 1-100자, `identifierValue`는 1-255자이며 둘 다 공백만으로 이루어질 수 없습니다. 값은 trim하지 않고 그대로 전송됩니다. `identifierType`은 `"serial"` 또는 `"mac_address"`입니다. 잘못된 값이나 알 수 없는 필드는 native 호출 전에 `INVALID_ARGUMENT`로 reject됩니다.
- 등록은 식별자 단위로 멱등입니다. 같은 `identifierType`과 `identifierValue`는 기존 제품 credential을 돌려주며, 같은 인증 주체와 같은 `productInfo`로 이미 credential을 가진 기기는 네트워크 호출을 하지 않습니다. 서버는 식별자에 처음 등록된 `model`을 유지하며, SDK로는 변경할 수 없습니다.
- 다른 식별자는 서버에 새 제품을 만들고, 이는 과금 대상이 될 수 있습니다. 기기의 실제 시리얼 번호나 MAC 주소를 사용하고, 운영 credential로 placeholder나 테스트 값을 보내지 마세요.
- `apiKey`나 `appId`를 바꾸면 저장된 credential이 삭제되고, 다음 `productInfo` 포함 `setup()`에서 다시 등록합니다.
- 등록은 `setup()`을 막는 단계입니다. 실패하면 setup 전체가 `SETUP_FAILED` 코드로 실패하며 `error.sdkCode`는 13400(거부: 429를 제외한 4xx 또는 입력 사전 검사 실패. 입력이나 계약을 수정하세요) 또는 13000(네트워크, 5xx, 429, 응답 해석 실패. 나중에 다시 시도하세요)입니다. SDK는 네트워크 실패, 5xx, 429를 2, 4, 8초 뒤에 재시도한 다음 13000을 보고합니다. 오프라인에서는 실패가 도착하기까지 약 1.5-3분이 걸릴 수 있습니다. 실패 후 native SDK는 설정되지 않은 상태로 돌아가며 `setup()`을 다시 호출할 수 있습니다.
- Android에서 `setup()`은 등록과 setup이 끝난 뒤 resolve됩니다. iOS에서 `setup()`은 native 호출이 시작되면 반환되고, 등록이 끝나기 전에 `isSetupComplete`가 `true`일 수 있습니다. tracking을 시작하기 전에 `addEventListener()`로 `onSetupDidComplete` 또는 `onSetupDidFail`을 기다리고, 둘 중 하나가 도착하기 전에는 `setup()`을 다시 호출하지 마세요. native SDK는 실행 중인 setup이 있으면 두 번째 `setup()`을 callback 없이 무시합니다.

### `useAsleep()`

React 컴포넌트에서 상태와 action을 사용하고 네이티브 listener 수명 주기를 관리하는 기본 API입니다.

대표 상태:

- `status`: `"idle"`, `"tracking"`, `"paused"`, `"recoveryRequired"`
- `isTracking`: `status`가 `"idle"`이 아닐 때 `true` (`recordingDead`는 native session이 열려 있어도 예외적으로 `false`)
- `isRecoveryRequired`: iOS foreground 복구가 필요한 상태
- `sessionId`, `userId`, `analysisResult`, `error`

대표 action:

- 초기화: `checkAndRestoreTracking`, `initAsleepConfig`, `setup`
- 측정: `startTracking`, `stopTracking`, `resumeTracking`
- 권한과 배터리: `hasRequiredPermissions`, `requestRequiredPermissions`, `checkBatteryOptimization`, `requestBatteryOptimizationExemption`
- 데이터: `requestAnalysis`, `getReport`, `getReportList`, `getAverageReport`, `deleteSession`, `reanalyze`
- 사용자 메타데이터: `saveUserMetadata`, `fetchUserMetadata`

### 종료 시 분석 구간

`stopTracking()`에 녹음 전체 대신 서버가 분석할 구간을 선택적으로 전달할 수 있습니다.

```ts
await asleep.stopTracking({
  analysisRange: { start: bedtime, end: new Date() },
});
```

`start`는 `end`보다 최소 1초(초 단위 기준) 앞서야 하고 둘 다 유효한 `Date`여야 합니다. 그렇지 않으면 native 호출 전에 `INVALID_ARGUMENT`로 reject됩니다. 옵션 없이 호출한 `stopTracking()`의 동작은 기존과 같습니다. 서버가 받아들이지 않는 구간은 별도 통지 없이 무시되고 session 전체가 분석될 수 있습니다. session은 정상 종료되며 앱은 구간이 버려졌다는 신호를 받지 못하므로, 구간이 중요하다면 `getReport()`로 결과를 확인하세요. 구간은 측정된 session 안에 있어야 합니다. native session 시작보다 앞선 `start`는 분석된 데이터가 없는 session(`missing_data_ratio` 1.0, `TOO_MANY_DEFECTS_IN_SLEEP_STAGES`)을 만든다는 것을 실기기에서 확인했으므로, 추적 시작 이후임이 확실한 시각을 `start`로 쓰세요.

### 재분석

`reanalyze(sessionId, options?)`는 종료된 session을 서버가 다시 분석하도록 요청하며, `options.analysisRange`로 구간을 제한할 수 있습니다.

```ts
await asleep.reanalyze(sessionId, { analysisRange: { start, end } });
// 분석 완료가 아니라 서버가 요청을 수락했을 때 resolve됩니다.
// report.session.state가 "COMPLETE"가 될 때까지 getReport(sessionId)를 polling하세요.
```

> **구간 없이 재분석하면 서버에 저장된 이전 구간이 대체됩니다.** `stopTracking({ analysisRange })`로 지정한 구간도 마찬가지입니다. 구간을 유지하려면 다시 전달하세요.

빈 `sessionId`나 잘못된 구간은 native 호출 전에 `INVALID_ARGUMENT`로, 설정 전 호출은 `MISSING_PREREQUISITE`로 reject됩니다. 서버 실패는 code `REANALYZE_FAILED`로 reject되며 `error.sdkCode`에 SDK 코드를 유지합니다: 30000(일반/네트워크), 30400, 30401, 30403, 30404, 30409(재분석이 이미 진행 중: 간격을 두고, 무한 재시도하지 마세요), 30410(데이터 보존 기간 만료), 30422(session이 아직 측정 중), 30500.

### 사용자 메타데이터

`initAsleepConfig()`가 완료된 뒤 서버 분석에 사용되는 선택적 프로필 정보를 저장할 수 있습니다.

```ts
import type { AsleepUserMetadata } from "react-native-asleep";

const metadata: AsleepUserMetadata = { birthYear: 1990, gender: "female", height: 165.5 };
await asleep.saveUserMetadata(metadata);

const saved = await asleep.fetchUserMetadata(); // AsleepUserMetadata | null
```

모든 필드는 선택 사항이며 생략한 필드는 전송되지 않습니다. 범위를 벗어난 값은 native 호출 전에 `INVALID_ARGUMENT`로 reject됩니다: `birthYear` 1900-2100, `birthMonth` 1-12, `birthDay` 1-31(정수), `height` 1-500 cm, `weight` 1-1000 kg, `gender`는 `"male"`, `"female"`, `"non_binary"`, `"other"`, `"prefer_not_to_say"` 중 하나. 설정 전에 호출하면 `MISSING_PREREQUISITE`로 reject됩니다. native 실패는 `error.sdkCode`에 SDK 코드를 유지합니다: 27400(서버 검증 실패, code `INVALID_ARGUMENT`), 27000(`SAVE_USER_METADATA_FAILED`), 27100(`FETCH_USER_METADATA_FAILED`). 저장된 값이 없으면 `fetchUserMetadata()`는 `null`로 resolve됩니다.

### `Asleep`

백그라운드 callback처럼 React 훅을 사용할 수 없는 곳에서는 `Asleep.initialize()`, `Asleep.getState()`, `Asleep.subscribe()`, `Asleep.addEventListener()`를 사용합니다. `initialize()`가 반환한 cleanup 함수는 해당 소유자의 수명 주기가 끝날 때 반드시 호출하세요.

### 오류

모든 action과 조회 API는 실패 시 `AsleepError`를 throw합니다. `message` 문자열을 분석하지 말고 `code`로 분기하세요. 측정 중 오류에는 복구 의미를 나타내는 `category`가 포함될 수 있습니다.

| `error.category` | 기본 처리 |
|---|---|
| `terminal` | 기존 native session은 종료됨. 새 측정을 시작 |
| `recordingDead` | 녹음기는 종료됐지만 session은 열려 있음. `stopTracking()` 후 새 측정 |
| `recoveryRequired` | session은 살아 있음. iOS foreground에서 `resumeTracking()` |
| `transient` | session을 유지하며 이후 상태와 업로드를 관찰 |
| `unknown` | 정상으로 가정하지 말고 기록·관찰 |

## 프로덕션 연동

앱 재시작 복원, listener 수명 주기, 앱과 SDK의 상태 경계, iOS 중단 복구, 플랫폼별 분석 결과, 리포트 재시도 정책은 [한국어 Integration Guide](./docs/INTEGRATION.ko.md)를 참고하세요.

## 1.x에서 마이그레이션

v2에서는 중복되거나 외부에서 변경할 수 있었던 v1 API를 제거했습니다.

| 1.x | v2 |
|---|---|
| `error: string \| null`, `errorInfo` | 하나의 `AsleepError`; `message`, `code`, `category`, `sdkCode` 사용 |
| 리포트 실패 시 `null` 또는 `[]` 반환 | `AsleepError` throw; 빈 리포트 목록은 여전히 정상 결과 |
| 공개 상태 setter와 raw store | 네이티브 이벤트와 SDK action만 상태 변경 |
| `getTrackingDurationMinutes()` | 앱에서 wall-clock 시작 시각 저장 |
| `requestMicrophonePermission()` | `requestRequiredPermissions()` |
| `startTracking()` 내부 권한 요청 | 시작 전에 권한을 명시적으로 확인하고 요청 |
| default export, `AsleepSDK`, `Asleep` class | `useAsleep()`과 named `Asleep` escape hatch |
| 필수 `zustand` 의존성 | 외부 상태 라이브러리 의존성 없음 |

Android 13 이상에서는 알림 권한도 계속 요청하지만, `requestRequiredPermissions()` 반환값은 측정 가능 여부를 결정하는 마이크 권한을 반영합니다. 새 버전을 정확히 고정하고 import와 오류 분기를 모두 변경한 뒤 권한 없는 cold start를 검증하세요.

## 예제

전체 사용 예시는 [GitHub의 example 앱](https://github.com/asleep-ai/asleep-sdk-react-native/tree/main/example)에서 확인할 수 있습니다.

## 라이선스

라이선스 조건은 [LICENSE.md](./LICENSE.md)를 참고하세요.

## 지원

- [GitHub Issues](https://github.com/asleep-ai/asleep-sdk-react-native/issues)
- [Asleep 개발자 문서](https://docs.asleep.ai)
- [Asleep Dashboard](https://dashboard.asleep.ai)
