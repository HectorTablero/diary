package es.tablerus.diary;

import ee.forgr.capacitor.social.login.GoogleProvider;
import ee.forgr.capacitor.social.login.SocialLoginPlugin;
import ee.forgr.capacitor.social.login.ModifiedMainActivityForSocialLoginPlugin;
import com.getcapacitor.PluginHandle;
import com.getcapacitor.Plugin;
import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.util.Log;
import android.webkit.PermissionRequest;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;

// ModifiedMainActivityForSocialLoginPlugin is VERY VERY important !!!!!!
public class MainActivity extends BridgeActivity implements ModifiedMainActivityForSocialLoginPlugin {

      // Only one getUserMedia() request is ever in flight at a time (the voice recorder is
      // modal), so a single field is enough to bridge the async permission-result callback
      // back to the WebView's PermissionRequest.
      private PermissionRequest pendingMediaRequest;

      // Must be registered unconditionally before the activity starts (field initializers run
      // in the constructor, well before onCreate/onStart), per the ActivityResultLauncher contract.
      private final ActivityResultLauncher<String> requestAudioPermission = registerForActivityResult(
        new ActivityResultContracts.RequestPermission(),
        granted -> {
          if (pendingMediaRequest == null) return;
          if (granted) {
            pendingMediaRequest.grant(new String[] { PermissionRequest.RESOURCE_AUDIO_CAPTURE });
          } else {
            pendingMediaRequest.deny();
          }
          pendingMediaRequest = null;
        }
      );

      @Override
      public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // getUserMedia({audio:true}) needs two things Capacitor's default WebChromeClient never
        // grants on its own: the Android RECORD_AUDIO runtime permission, and an explicit grant()
        // on the WebView's own PermissionRequest. Without this override the mic silently reports
        // "denied" even after the user has approved the OS-level permission.
        getBridge().getWebView().setWebChromeClient(new BridgeWebChromeClient(getBridge()) {
          @Override
          public void onPermissionRequest(final PermissionRequest request) {
            boolean wantsAudio = false;
            for (String resource : request.getResources()) {
              if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) wantsAudio = true;
            }
            if (!wantsAudio) {
              super.onPermissionRequest(request);
              return;
            }
            runOnUiThread(() -> {
              boolean granted = ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.RECORD_AUDIO)
                == PackageManager.PERMISSION_GRANTED;
              if (granted) {
                request.grant(new String[] { PermissionRequest.RESOURCE_AUDIO_CAPTURE });
              } else {
                pendingMediaRequest = request;
                requestAudioPermission.launch(Manifest.permission.RECORD_AUDIO);
              }
            });
          }
        });
      }

      @Override
      public void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);

        if (requestCode >= GoogleProvider.REQUEST_AUTHORIZE_GOOGLE_MIN && requestCode < GoogleProvider.REQUEST_AUTHORIZE_GOOGLE_MAX) {
          PluginHandle pluginHandle = getBridge().getPlugin("SocialLogin");
          if (pluginHandle == null) {
            Log.i("Google Activity Result", "SocialLogin login handle is null");
            return;
          }
          Plugin plugin = pluginHandle.getInstance();
          if (!(plugin instanceof SocialLoginPlugin)) {
            Log.i("Google Activity Result", "SocialLogin plugin instance is not SocialLoginPlugin");
            return;
          }
          ((SocialLoginPlugin) plugin).handleGoogleLoginIntent(requestCode, data);
        }
      }

      // This function will never be called, leave it empty
      @Override
      public void IHaveModifiedTheMainActivityForTheUseWithSocialLoginPlugin() {}
}