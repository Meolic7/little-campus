package app.pixelcampus.student;

import android.Manifest;
import android.content.Context;
import android.content.SharedPreferences;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Android-only credentials + foreground PCM capture. No cloud credentials are logged. */
@CapacitorPlugin(name="Campus", permissions={@Permission(alias="microphone",strings={Manifest.permission.RECORD_AUDIO})})
public class CampusPlugin extends Plugin {
    private static final String ALIAS="pixelcampus.api.keys.v1";
    private static final int RATE=16000;
    private volatile boolean running=false;
    private volatile Thread recorderThread;
    private SharedPreferences prefs() { return getContext().getSharedPreferences("campus.private", Context.MODE_PRIVATE); }

    private SecretKey secretKey() throws Exception {
        KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);
        if(!store.containsAlias(ALIAS)) {
            KeyGenerator generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
            generator.generateKey();
        }
        return (SecretKey)store.getKey(ALIAS,null);
    }
    @PluginMethod public void getSecrets(PluginCall call) {
        try {
            String encoded=prefs().getString("secrets","");String value="";
            if(!encoded.isEmpty()) {
                byte[] bytes=Base64.decode(encoded,Base64.NO_WRAP);
                Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(Cipher.DECRYPT_MODE,secretKey(),new GCMParameterSpec(128,bytes,0,12));
                value=new String(cipher.doFinal(bytes,12,bytes.length-12),StandardCharsets.UTF_8);
            }
            call.resolve(new JSObject().put("value",value));
        } catch(Exception e) {call.reject("storageError");}
    }
    @PluginMethod public void setSecrets(PluginCall call) {
        try {
            Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,secretKey());
            byte[] encrypted=cipher.doFinal(call.getString("value", "{}").getBytes(StandardCharsets.UTF_8));
            ByteBuffer combined=ByteBuffer.allocate(cipher.getIV().length+encrypted.length);combined.put(cipher.getIV()).put(encrypted);
            if(!prefs().edit().putString("secrets",Base64.encodeToString(combined.array(),Base64.NO_WRAP)).commit())throw new Exception();
            call.resolve();
        } catch(Exception e) {call.reject("storageError");}
    }
    @PluginMethod public void getRecovery(PluginCall call) {
        try {
            JSONObject journal=new JSONObject(prefs().getString("recording","{}"));
            String id=journal.optString("id"),relative=journal.optString("audio");
            // Repair a single unfinished WAV after process death. Old chunk journals remain readable.
            if(!running&&(recorderThread==null||!recorderThread.isAlive())&&id.matches("[a-fA-F0-9-]{36}")&&relative.equals("audio/"+id+".wav")) {
                File target=new File(getContext().getFilesDir(),relative);
                if(target.exists()&&target.length()>44) {
                    long samples=WavRecording.recover(target);
                    journal.put("segments",new JSONArray().put(recordingEntry(relative,samples)));
                    if(!prefs().edit().putString("recording",journal.toString()).commit())throw new IOException();
                }
            }
            call.resolve(new JSObject(journal.toString()));
        } catch(Exception e){call.reject("storageError");}
    }
    @PluginMethod public void clearRecovery(PluginCall call) {
        try{JSONObject journal=new JSONObject(prefs().getString("recording","{}"));if(journal.optString("id").equals(call.getString("id")))prefs().edit().remove("recording").commit();call.resolve();}catch(Exception e){call.reject("storageError");}
    }
    @PluginMethod public void startRecording(PluginCall call) {
        if(getPermissionState("microphone")!=PermissionState.GRANTED){requestPermissionForAlias("microphone",call,"microphoneResult");return;}
        startGranted(call);
    }
    @PermissionCallback private void microphoneResult(PluginCall call) {
        if(getPermissionState("microphone")==PermissionState.GRANTED)startGranted(call);else call.reject("micDenied");
    }
    private synchronized void startGranted(PluginCall call) {
        if(running||(recorderThread!=null&&recorderThread.isAlive())){call.reject("sessionBusy");return;}
        String id=call.getString("id","");if(!id.matches("[a-fA-F0-9-]{36}")){call.reject("invalidData");return;}
        try {
            int min=AudioRecord.getMinBufferSize(RATE,AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT);
            if(min<=0)throw new Exception();
            AudioRecord recorder=new AudioRecord(MediaRecorder.AudioSource.MIC,RATE,AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT,Math.max(min*2,RATE*2));
            if(recorder.getState()!=AudioRecord.STATE_INITIALIZED){recorder.release();throw new Exception();}
            recorder.startRecording();running=true;
            recorderThread=new Thread(()->capture(recorder,id),"campus-audio");recorderThread.start();call.resolve();
        } catch(Exception e){running=false;call.reject("micDenied");}
    }
    private void capture(AudioRecord recorder,String id) {
        byte[] block=new byte[3200];long samples=0;String error=null;
        String relative="audio/"+id+".wav";File target=new File(getContext().getFilesDir(),relative);
        try {
            File dir=target.getParentFile();if(!dir.exists()&&!dir.mkdirs())throw new IOException();
            try(WavRecording recording=new WavRecording(target)) {
                JSONObject journal=new JSONObject().put("id",id).put("audio",relative).put("segments",new JSONArray());
                if(!prefs().edit().putString("recording",journal.toString()).commit())throw new IOException();
                while(running&&samples<RATE*60L*60*4) {
                    int count=recorder.read(block,0,block.length);
                    if(count<0)throw new IllegalStateException();if(count==0)continue;
                    recording.append(block,count);samples=recording.samples();
                }
            }
        } catch(Exception e){error=e instanceof IOException?"storageError":"micDenied";}
        finally {
            try {
                if(target.exists()&&target.length()>44) {
                    samples=WavRecording.recover(target);
                    JSObject entry=recordingEntry(relative,samples);
                    JSONObject journal=new JSONObject().put("id",id).put("audio",relative).put("segments",new JSONArray().put(entry));
                    if(!prefs().edit().putString("recording",journal.toString()).commit())throw new IOException();
                    // Emit only once, after stopping, so the entire recording is one transcription request.
                    notifyListeners("recordingReady",entry);
                }
            } catch(Exception e){error="storageError";}
            try{recorder.stop();}catch(Exception ignored){}recorder.release();running=false;
            JSObject event=new JSObject();if(error!=null)event.put("error",error);notifyListeners("recordingStopped",event);
        }
    }
    private JSObject recordingEntry(String relative,long samples) {
        return new JSObject().put("audio",relative).put("start",0).put("seconds",samples/(double)RATE);
    }
    @PluginMethod public void stopRecording(PluginCall call) {
        running=false;Thread thread=recorderThread;
        new Thread(()->{try{if(thread!=null)thread.join(6000);if(thread!=null&&thread.isAlive()){call.reject("micDenied");return;}call.resolve();}catch(InterruptedException e){Thread.currentThread().interrupt();call.reject("micDenied");}},"campus-stop").start();
    }
    @Override protected void handleOnPause() {running=false;}
    @Override protected void handleOnDestroy() {running=false;}
}
