package com.retrolootpro.clover;

import android.accounts.Account;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONException;
import org.json.JSONObject;

import java.lang.reflect.Constructor;
import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.util.UUID;

public class MainActivity extends Activity {
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private WebView webView;
    private CloverPaymentAdapter paymentAdapter;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        );

        webView = new WebView(this);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);

        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient());
        webView.addJavascriptInterface(new RetroLootCloverBridge(), "RetroLootClover");

        paymentAdapter = new CloverPaymentAdapter(
                this,
                getString(R.string.clover_remote_application_id),
                this::sendPaymentResult
        );
        paymentAdapter.initialize();

        webView.loadUrl(getString(R.string.retroloot_pos_url));
    }

    private void sendPaymentResult(JSONObject result) {
        mainHandler.post(() -> {
            String payload = result.toString().replace("\\", "\\\\").replace("'", "\\'");
            webView.evaluateJavascript("window.__retroLootCloverPaymentResult && window.__retroLootCloverPaymentResult('" + payload + "')", null);
        });
    }

    private final class RetroLootCloverBridge {
        @JavascriptInterface
        public boolean isAvailable() {
            return paymentAdapter != null && paymentAdapter.isInitialized();
        }

        @JavascriptInterface
        public void sale(String payload) {
            if (paymentAdapter == null || !paymentAdapter.isInitialized()) {
                sendPaymentResult(errorResult("Clover Payment Connector is not initialized on this device."));
                return;
            }
            paymentAdapter.sale(payload);
        }

        @JavascriptInterface
        public void printReceipt(String payload) {
            Toast.makeText(MainActivity.this, "Receipt printing bridge is ready for Clover printer wiring.", Toast.LENGTH_LONG).show();
        }

        @JavascriptInterface
        public void openCashDrawer() {
            Toast.makeText(MainActivity.this, "Cash drawer bridge is ready for Clover drawer wiring.", Toast.LENGTH_LONG).show();
        }
    }

    private static JSONObject errorResult(String message) {
        JSONObject result = new JSONObject();
        try {
            result.put("success", false);
            result.put("message", message);
        } catch (JSONException ignored) {
        }
        return result;
    }

    private interface PaymentResultSink {
        void accept(JSONObject result);
    }

    private static final class CloverPaymentAdapter {
        private final Activity activity;
        private final String remoteApplicationId;
        private final PaymentResultSink resultSink;
        private Object connector;
        private Class<?> saleRequestClass;

        CloverPaymentAdapter(Activity activity, String remoteApplicationId, PaymentResultSink resultSink) {
            this.activity = activity;
            this.remoteApplicationId = remoteApplicationId;
            this.resultSink = resultSink;
        }

        boolean isInitialized() {
            return connector != null && saleRequestClass != null;
        }

        void initialize() {
            try {
                Class<?> cloverAccountClass = Class.forName("com.clover.sdk.util.CloverAccount");
                Method getAccount = cloverAccountClass.getMethod("getAccount", android.content.Context.class);
                Account account = (Account) getAccount.invoke(null, activity);
                if (account == null) {
                    resultSink.accept(errorResult("No Clover account is active on this device."));
                    return;
                }

                Class<?> listenerClass = firstClass(
                        "com.clover.sdk.v3.payments.IPaymentConnectorListener",
                        "com.clover.connector.sdk.v3.IPaymentConnectorListener"
                );
                Class<?> connectorClass = firstClass(
                        "com.clover.sdk.v3.payments.PaymentConnector",
                        "com.clover.connector.sdk.v3.PaymentConnector"
                );
                saleRequestClass = firstClass(
                        "com.clover.sdk.v3.payments.SaleRequest",
                        "com.clover.connector.sdk.v3.SaleRequest"
                );

                Object listener = Proxy.newProxyInstance(
                        listenerClass.getClassLoader(),
                        new Class[]{listenerClass},
                        new PaymentListener()
                );

                Constructor<?> constructor = connectorClass.getConstructor(
                        android.content.Context.class,
                        Account.class,
                        listenerClass,
                        String.class
                );
                connector = constructor.newInstance(activity, account, listener, remoteApplicationId);
                callIfExists(connector, "initializeConnection");
                callIfExists(connector, "connect");
                callIfExists(connector, "start");
            } catch (Exception error) {
                resultSink.accept(errorResult("Clover Payment Connector setup failed: " + error.getMessage()));
            }
        }

        void sale(String payload) {
            try {
                JSONObject request = new JSONObject(payload);
                Object saleRequest = saleRequestClass.getConstructor().newInstance();
                String externalId = request.optString("externalId", "rlp-" + UUID.randomUUID());
                long amountCents = request.optLong("amountCents", Math.round(request.optDouble("amount", 0) * 100));

                invokeSetter(saleRequest, "setExternalId", String.class, externalId);
                invokeSetter(saleRequest, "setAmount", Long.TYPE, amountCents);

                Method saleMethod = connector.getClass().getMethod("sale", saleRequestClass);
                saleMethod.invoke(connector, saleRequest);
            } catch (Exception error) {
                resultSink.accept(errorResult("Could not start Clover sale: " + error.getMessage()));
            }
        }

        private final class PaymentListener implements InvocationHandler {
            @Override
            public Object invoke(Object proxy, Method method, Object[] args) {
                String name = method.getName();
                if ("onSaleResponse".equals(name) && args != null && args.length > 0) {
                    resultSink.accept(mapSaleResponse(args[0]));
                }
                return defaultValue(method.getReturnType());
            }
        }

        private JSONObject mapSaleResponse(Object response) {
            JSONObject result = new JSONObject();
            try {
                boolean success = Boolean.TRUE.equals(call(response, "getSuccess"));
                result.put("success", success);
                result.put("message", stringValue(call(response, "getMessage")));
                result.put("reason", stringValue(call(response, "getReason")));
                result.put("reference", stringValue(call(response, "getExternalId")));
                Object payment = call(response, "getPayment");
                if (payment != null) {
                    result.put("paymentId", stringValue(call(payment, "getId")));
                }
            } catch (Exception error) {
                return errorResult("Could not read Clover sale response: " + error.getMessage());
            }
            return result;
        }

        private static Class<?> firstClass(String... names) throws ClassNotFoundException {
            ClassNotFoundException last = null;
            for (String name : names) {
                try {
                    return Class.forName(name);
                } catch (ClassNotFoundException error) {
                    last = error;
                }
            }
            throw last == null ? new ClassNotFoundException("No class names provided") : last;
        }

        private static Object call(Object target, String methodName) {
            try {
                Method method = target.getClass().getMethod(methodName);
                return method.invoke(target);
            } catch (Exception ignored) {
                return null;
            }
        }

        private static void callIfExists(Object target, String methodName) {
            try {
                Method method = target.getClass().getMethod(methodName);
                method.invoke(target);
            } catch (Exception ignored) {
            }
        }

        private static void invokeSetter(Object target, String methodName, Class<?> type, Object value) throws Exception {
            Method method = target.getClass().getMethod(methodName, type);
            method.invoke(target, value);
        }

        private static String stringValue(Object value) {
            return value == null ? "" : String.valueOf(value);
        }

        private static Object defaultValue(Class<?> type) {
            if (type == Boolean.TYPE) return false;
            if (type == Integer.TYPE) return 0;
            if (type == Long.TYPE) return 0L;
            if (type == Float.TYPE) return 0F;
            if (type == Double.TYPE) return 0D;
            return null;
        }
    }
}
