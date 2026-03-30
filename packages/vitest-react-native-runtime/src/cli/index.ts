/**
 * vitest-react-native-runtime CLI
 *
 * Commands:
 *   init       Scaffold a new test harness Expo app
 *   doctor     Check environment for Android/iOS development tools
 *   help       Show this help message
 */

export {};

const command: string | undefined = process.argv[2];

switch (command) {
  case 'init': {
    process.argv.splice(2, 1); // remove 'init', leaving [dir]
    await import('./init');
    break;
  }

  case 'doctor': {
    const { runDoctor } = await import('./doctor');
    process.exit(runDoctor());
    break;
  }

  case 'help':
  case '--help':
  case '-h':
  case undefined: {
    console.log(`
  vitest-react-native-runtime — Native component testing for React Native

  Commands:
    init       Scaffold a new test harness Expo app
    doctor     Check your environment for Android/iOS development tools

  Usage:
    npx vitest-react-native-runtime init [directory]
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
