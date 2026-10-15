import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.danielspurr.cagekings',
  appName: 'Cage Kings',
  webDir: 'dist',
  android: {
    backgroundColor: '#0b0b0f',
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
  plugins: {
    SystemBars: {
      insetsHandling: 'css',
      initialViewportFitValueHint: 'cover',
      hidden: true,
    },
    SplashScreen: {
      // the game hides the splash as soon as its own loading screen (with a progress bar) is up; as a safety net the
      // splash also goes away by itself, so a failed start can never leave the player on a frozen logo
      launchShowDuration: 3000,
      launchAutoHide: true,
      backgroundColor: '#0b0b0f',
      showSpinner: false,
      androidScaleType: 'CENTER_CROP',
      splashFullScreen: true,
      splashImmersive: true,
    },
  },
};

export default config;
