package com.velosolabs.ashnote.vault

import android.app.KeyguardManager
import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.security.keystore.UserNotAuthenticatedException
import android.util.Base64
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.spec.MGF1ParameterSpec
import java.security.spec.X509EncodedKeySpec
import javax.crypto.Cipher
import javax.crypto.spec.OAEPParameterSpec
import javax.crypto.spec.PSource

// Ashnote's phone-owner vault (VLABS-464). The database key is encrypted with the public half of an
// RSA key pair kept in the Android Keystore. The private half only decrypts for AUTH_SECONDS after the
// phone's owner check (a Class 3 fingerprint or face, or the screen lock PIN, pattern or password),
// and the Keystore deletes it for good if the screen lock is removed.
class AshnoteVaultModule : Module() {
  private val alias = "ashnote.vault.v1"
  private val prefsName = "ashnote.vault"
  private val sealedKey = "sealed"
  private val transformation = "RSA/ECB/OAEPWithSHA-256AndMGF1Padding"
  // The Keystore's OAEP uses SHA-1 for MGF1, so both halves say so explicitly.
  private val oaep = OAEPParameterSpec("SHA-256", "MGF1", MGF1ParameterSpec.SHA1, PSource.PSpecified.DEFAULT)
  private val authSeconds = 15

  private val context: Context
    get() = appContext.reactContext ?: throw IllegalStateException("No Android context")
  private val prefs
    get() = context.getSharedPreferences(prefsName, Context.MODE_PRIVATE)

  private fun keyStore(): KeyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

  private fun deviceSecure(): Boolean =
    (context.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager).isDeviceSecure

  private fun newKeyPair() {
    val builder = KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_DECRYPT or KeyProperties.PURPOSE_ENCRYPT)
      .setKeySize(2048)
      .setDigests(KeyProperties.DIGEST_SHA256, KeyProperties.DIGEST_SHA1)
      .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_RSA_OAEP)
      .setUserAuthenticationRequired(true)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      builder.setUserAuthenticationParameters(authSeconds, KeyProperties.AUTH_BIOMETRIC_STRONG or KeyProperties.AUTH_DEVICE_CREDENTIAL)
    } else {
      @Suppress("DEPRECATION")
      builder.setUserAuthenticationValidityDurationSeconds(authSeconds)
    }
    KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_RSA, "AndroidKeyStore").apply {
      initialize(builder.build())
      generateKeyPair()
    }
  }

  private fun clearAll() {
    try { keyStore().deleteEntry(alias) } catch (_: Exception) {}
    prefs.edit().remove(sealedKey).apply()
  }

  override fun definition() = ModuleDefinition {
    Name("AshnoteVault")

    AsyncFunction("isAvailable") { deviceSecure() }

    AsyncFunction("hasSecret") {
      val ks = keyStore()
      if (!prefs.contains(sealedKey) || !ks.containsAlias(alias)) return@AsyncFunction false
      // a key the Keystore has invalidated (the screen lock was removed) says so before any owner check
      try {
        Cipher.getInstance(transformation).init(Cipher.DECRYPT_MODE, ks.getKey(alias, null) as PrivateKey, oaep)
        true
      } catch (e: KeyPermanentlyInvalidatedException) {
        clearAll()
        false
      } catch (e: UserNotAuthenticatedException) {
        true
      } catch (e: Exception) {
        false
      }
    }

    AsyncFunction("seal") { secret: String ->
      if (!deviceSecure()) throw IllegalStateException("This phone has no screen lock")
      clearAll()
      newKeyPair()
      // encrypting needs no owner check: it uses a plain copy of the public key
      val pub = keyStore().getCertificate(alias).publicKey
      val plainPub = KeyFactory.getInstance(pub.algorithm).generatePublic(X509EncodedKeySpec(pub.encoded))
      val cipher = Cipher.getInstance(transformation).apply { init(Cipher.ENCRYPT_MODE, plainPub, oaep) }
      val sealed = cipher.doFinal(secret.toByteArray(Charsets.UTF_8))
      prefs.edit().putString(sealedKey, Base64.encodeToString(sealed, Base64.NO_WRAP)).apply()
    }

    AsyncFunction("open") { _: String ->
      val sealed = prefs.getString(sealedKey, null)
      val ks = keyStore()
      if (sealed == null || !ks.containsAlias(alias)) return@AsyncFunction mapOf("ok" to false, "error" to "missing")
      try {
        val priv = ks.getKey(alias, null) as PrivateKey
        val cipher = Cipher.getInstance(transformation).apply { init(Cipher.DECRYPT_MODE, priv, oaep) }
        val secret = String(cipher.doFinal(Base64.decode(sealed, Base64.NO_WRAP)), Charsets.UTF_8)
        mapOf("ok" to true, "secret" to secret)
      } catch (e: KeyPermanentlyInvalidatedException) {
        clearAll()
        mapOf("ok" to false, "error" to "invalidated")
      } catch (e: UserNotAuthenticatedException) {
        mapOf("ok" to false, "error" to "not-authenticated")
      } catch (e: Exception) {
        mapOf("ok" to false, "error" to "failed")
      }
    }

    AsyncFunction("clear") { clearAll() }
  }
}
