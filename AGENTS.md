# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

React Native SDK for Asleep's AI-powered sleep tracking technology. This SDK provides non-invasive sleep tracking through audio analysis without requiring wearable devices.

## Development Commands

### Building and Testing
```bash
# Build the SDK
yarn build

# Clean build artifacts
yarn clean

# Run linting
yarn lint

# Run tests
yarn test

# Prepare the module
yarn prepare
```

### Example App Commands
```bash
# In the example directory
yarn start        # Start Expo development server
yarn android      # Run on Android
yarn ios          # Run on iOS
```

### Publishing and Release
```bash
# Manual release via GitHub Actions
# Go to Actions > Release > Run workflow

# Automatic semantic release
yarn semantic-release
```

## Architecture

### Core Components

1. **Native Modules** (`ios/AsleepModule.swift`, `android/.../AsleepModule.kt`)
   - Platform-specific implementations wrapping native Asleep SDKs
   - Handle audio recording, permission management, and sleep tracking
   - iOS SDK version: 3.1.8, Android SDK version: 3.1.5

2. **State Management** (`src/AsleepStore.ts`)
   - Zustand store with singleton pattern for consistent state across app
   - Handles all SDK state including tracking status, session management, and error handling
   - Provides event listener initialization and cleanup

3. **API Surface** (`src/index.ts`)
   - `useAsleep` hook for React components
   - `AsleepSDK` singleton for non-React contexts
   - Event-driven architecture with automatic state updates

4. **Type Definitions** (`src/Asleep.types.ts`)
   - TypeScript interfaces for all API responses and configurations
   - Comprehensive sleep report and session structures

### Key Features

- **Setup Methods**: Two initialization approaches - `setup()` for ODA (On-Device Analysis) and `initAsleepConfig()` for standard mode
- **Real-time Tracking**: Start/stop tracking with automatic microphone permission handling
- **Report Generation**: Fetch detailed sleep analysis reports with comprehensive metrics
- **Event System**: Automatic event handling through EventEmitter with state synchronization
- **Platform Differences**:
  - Android: Returns analysis results immediately from `requestAnalysis()`
  - iOS: Returns acknowledgment only, results come via `onAnalysisResult` event

### Native Integration Points

- **iOS**: Swift module using Expo modules, requires audio background mode
- **Android**: Kotlin module with foreground service for long-running tracking
- **Permissions**: Microphone access required on both platforms, battery optimization exemption recommended on Android

## Development Guidelines

### State Management Pattern
- Always use store actions for state updates
- Check `isSetupInProgress` and `isTracking` flags to prevent duplicate operations
- Handle platform differences in analysis result handling

### Error Handling
- All async operations should be wrapped in try-catch blocks
- Errors are automatically stored in the state and accessible via the `error` property
- Use the `addLog` function for debug logging when `enableLog(true)` is set

### Testing Changes
- Test on both iOS and Android platforms
- Verify permission handling flows
- Test background tracking scenarios
- Ensure state consistency across tracking lifecycle

### Release Process
- Uses semantic-release with custom configuration
- All commits trigger patch releases
- Changelog automatically generated
- NPM publishing handled by GitHub Actions
