/**
 * vitest-react-native-runtime CLI
 *
 * Commands:
 *   init          Scaffold a new test harness Expo app
 *   build         Build the test harness app for a platform
 *   install       Boot a device and install the app
 *   bootstrap     Build + install in one step
 *   doctor        Check environment for Android/iOS development tools
 *   help          Show this help message
 */

export {};

const command: string | undefined = process.argv[2];

switch (command) {
  case 'init': {
    process.argv.splice(2, 1); // remove 'init', leaving [dir]
    await import('./init');
    break;
  }

  case 'build': {
    process.argv.splice(2, 1); // remove 'build', leaving [platform] [--app-dir ...]
    await import('./build');
    break;
  }

  case 'install': {
    process.argv.splice(2, 1); // remove 'install', leaving [platform] [--app-dir ...]
    await import('./install');
    break;
  }

  case 'bootstrap': {
    process.argv.splice(2, 1); // remove 'bootstrap', leaving [platform] [--app-dir ...]
    await import('./bootstrap');
    break;
  }

  case 'doctor': {
    const { runDoctor } = await import('./doctor');
    process.exit(runDoctor());
    break;
  }

  case 'boot-device': {
    process.argv.splice(2, 1); // remove 'boot-device', leaving [platform]
    await import('./boot-device');
    break;
  }

  case 'help':
  case '--help':
  case '-h':
  case undefined: {
    console.log(`
  vitest-react-native-runtime — Native component testing for React Native

  Commands:
    init           Scaffold a new test harness Expo app
    build          Build the test harness app for a platform
    install        Boot a device/emulator and install the app
    bootstrap      Build + install in one step
    doctor         Check your environment for Android/iOS development tools

  Usage:
    npx vitest-react-native-runtime init [directory]
    npx vitest-react-native-runtime build <android|ios> [--app-dir <path>]
    npx vitest-react-native-runtime install <android|ios> [--app-dir <path>]
    npx vitest-react-native-runtime bootstrap <android|ios> [--app-dir <path>]
    npx vitest-react-native-runtime doctor

  For running tests, add nativePlugin() to your vitest config:
    import { nativePlugin } from 'vitest-react-native-runtime';
`);
    break;
  }

  default:
    console.error(`Unknown command: ${command}\nRun "npx vitest-react-native-runtime help" for available commands.`);
    process.exit(1);
}
