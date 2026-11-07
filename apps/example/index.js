// App-wide browser polyfills (URL, getRandomValues, atob, TextEncoder) before
// anything else. The heavier lib-jitsi-meet shims load with the call screen.
import './src/jitsi/polyfills';

import { registerRootComponent } from 'expo';

import App from './App';

registerRootComponent(App);
