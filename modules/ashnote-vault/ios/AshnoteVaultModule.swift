import ExpoModulesCore
import LocalAuthentication
import Security

// Ashnote's phone-owner vault (VLABS-464): the database key in a Keychain item that only opens after
// Face ID, Touch ID or the phone's passcode (user presence), on this device only, and only while the
// phone has a passcode (the item is deleted if the passcode is removed).
public class AshnoteVaultModule: Module {
  private let service = "com.velosolabs.ashnote.vault"
  private let account = "dbkey.v1"

  private func baseQuery() -> [String: Any] {
    [kSecClass as String: kSecClassGenericPassword,
     kSecAttrService as String: service,
     kSecAttrAccount as String: account]
  }

  public func definition() -> ModuleDefinition {
    Name("AshnoteVault")

    AsyncFunction("isAvailable") { () -> Bool in
      LAContext().canEvaluatePolicy(.deviceOwnerAuthentication, error: nil)
    }

    AsyncFunction("hasSecret") { () -> Bool in
      let ctx = LAContext()
      ctx.interactionNotAllowed = true
      var q = self.baseQuery()
      q[kSecUseAuthenticationContext as String] = ctx
      let status = SecItemCopyMatching(q as CFDictionary, nil)
      return status == errSecSuccess || status == errSecInteractionNotAllowed
    }

    AsyncFunction("seal") { (secret: String) throws in
      SecItemDelete(self.baseQuery() as CFDictionary)
      var error: Unmanaged<CFError>?
      guard let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly, .userPresence, &error) else {
        throw Exception(name: "VaultError", description: "Couldn't create the access control")
      }
      var q = self.baseQuery()
      q[kSecAttrAccessControl as String] = access
      q[kSecValueData as String] = Data(secret.utf8)
      let status = SecItemAdd(q as CFDictionary, nil)
      if status != errSecSuccess {
        throw Exception(name: "VaultError", description: "Couldn't save to the Keychain (\(status))")
      }
    }

    AsyncFunction("open") { (reason: String) -> [String: Any] in
      let ctx = LAContext()
      ctx.localizedReason = reason
      var q = self.baseQuery()
      q[kSecReturnData as String] = true
      q[kSecUseAuthenticationContext as String] = ctx
      var out: AnyObject?
      let status = SecItemCopyMatching(q as CFDictionary, &out)
      switch status {
      case errSecSuccess:
        if let data = out as? Data, let secret = String(data: data, encoding: .utf8) { return ["ok": true, "secret": secret] }
        return ["ok": false, "error": "failed"]
      case errSecItemNotFound: return ["ok": false, "error": "missing"]
      case errSecUserCanceled: return ["ok": false, "error": "cancelled"]
      case errSecAuthFailed: return ["ok": false, "error": "not-authenticated"]
      default: return ["ok": false, "error": "failed"]
      }
    }

    AsyncFunction("clear") {
      SecItemDelete(self.baseQuery() as CFDictionary)
    }
  }
}
