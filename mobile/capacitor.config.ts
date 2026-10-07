import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'app.pixelcampus.student', appName: 'Pixel Campus', webDir: 'dist',
  server: { androidScheme: 'https' },
  android: { adjustMarginsForEdgeToEdge: 'auto' },
  plugins: { CapacitorHttp: { enabled: true } },
};
export default config;
