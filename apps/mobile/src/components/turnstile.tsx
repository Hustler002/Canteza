import { useEffect, useState, type ComponentType } from 'react';
import { NativeModules, Text, TurboModuleRegistry, View } from 'react-native';
import {
  parseTurnstileMessage,
  TURNSTILE_SITE_KEY,
  TURNSTILE_WEBVIEW_ORIGIN,
  turnstileHtml,
} from '../lib/captcha';
import { useTheme } from '../theme';

/**
 * Turnstile on the phone: Cloudflare's widget in a WebView, posting its token back.
 *
 * `react-native-webview` is a native module, and it asks for its TurboModule with
 * `getEnforcing` the moment it is imported — which throws in any build compiled before
 * the module was added. So, like `razorpay.ts`, availability is asked of the registry
 * first and the package is loaded with `import()` only then; a build without it says so
 * instead of crashing. `test/turnstile-import.test.ts` pins that there is no static import.
 */

const NATIVE_MODULE = 'RNCWebViewModule';

function webViewAvailable(): boolean {
  try {
    return Boolean(TurboModuleRegistry.get(NATIVE_MODULE) ?? NativeModules[NATIVE_MODULE]);
  } catch {
    return false;
  }
}

type WebViewProps = {
  source: { html: string; baseUrl: string };
  originWhitelist: string[];
  onMessage: (event: { nativeEvent: { data: string } }) => void;
  style: object;
  scrollEnabled: boolean;
  javaScriptEnabled: boolean;
};

export function Turnstile({
  onToken,
  onUnavailable,
}: {
  onToken: (token: string | null) => void;
  onUnavailable: () => void;
}) {
  const t = useTheme();
  const [WebView, setWebView] = useState<ComponentType<WebViewProps> | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!webViewAvailable()) {
      setMissing(true);
      onUnavailable();
      return;
    }
    let cancelled = false;
    import('react-native-webview')
      .then((module) => {
        if (!cancelled) setWebView(() => module.WebView as unknown as ComponentType<WebViewProps>);
      })
      .catch(() => {
        if (cancelled) return;
        setMissing(true);
        onUnavailable();
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (missing) {
    return (
      <Text style={[t.font.caption, { color: t.color.danger }]}>
        This version of the app cannot show the security check. If signing in fails, update the app.
      </Text>
    );
  }
  if (!WebView) return <View style={{ height: 70 }} />;

  return (
    <WebView
      source={{
        html: turnstileHtml(TURNSTILE_SITE_KEY, t.dark ? 'dark' : 'light'),
        baseUrl: TURNSTILE_WEBVIEW_ORIGIN,
      }}
      originWhitelist={['*']}
      javaScriptEnabled
      scrollEnabled={false}
      style={{ height: 70, backgroundColor: 'transparent' }}
      onMessage={(event) => {
        const message = parseTurnstileMessage(event.nativeEvent.data);
        if (!message) return;
        onToken(message.type === 'token' ? message.token : null);
      }}
    />
  );
}
