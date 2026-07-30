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

번들된 네이티브 SDK 버전은 다음과 같습니다.

| 플랫폼 | 네이티브 SDK |
|---|---|
| iOS | 3.2.0 |
| Android | 3.2.1 |

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
        await initAsleepConfig({ apiKey: "YOUR_API_KEY" });
        await checkBatteryOptimization();
        setIsReady(true);
      } catch {
        // `error`에도 같은 AsleepError가 반영됩니다.
      }
    })();
  }, [checkAndRestoreTracking, initAsleepConfig, checkBatteryOptimization]);

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

  return (
    <View>
      <Text>상태: {status}</Text>
      {error ? <Text>{error.message}</Text> : null}
      <Button
        title={isTracking ? "측정 종료" : "측정 시작"}
        disabled={!isReady}
        onPress={isTracking ? handleStop : handleStart}
      />
    </View>
  );
}
```

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
- 데이터: `requestAnalysis`, `getReport`, `getReportList`, `getAverageReport`, `deleteSession`

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
