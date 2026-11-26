# Ashnote: Google Play listing pack (VLABS-411)

Everything needed to fill in the Play Console for `com.velosolabs.ashnote`. The owner creates the developer
account and submits; nothing here is submitted automatically.

## Store listing

**App name** (30 max): `Ashnote: private chat`

**Short description** (80 max):
`Private chat with no account. Messages delete themselves after they are read.`

**Full description** (4000 max):

```
Ashnote is private chat for the people you choose, and then it lets go.

NO ACCOUNT, NO SERVER OF OURS
No phone number, email or password. You add someone by scanning their code, or by sending them an invite link. Messages travel end-to-end encrypted through public relays, so we never hold them.

GONE AFTER READING
By default a message deletes itself from both phones 5 minutes after it is read. Choose Off, 30 seconds, 1 hour or 1 day: the shorter setting of the two phones wins. Double-tap a message to delete it now. Sent by mistake? Unsend it before it is opened.

ONE MESSAGE AT A TIME
The newest message fills the screen. When it's gone, the one underneath comes back, and only then does it count as read.

CODES THAT WORK ONCE
An invite code holds a one-off key, not your identity. It expires and stops working the moment it is used. Both phones then show 4 symbols: compare them side by side, or on a call when you pair by link.

PHOTOS THAT VANISH
Send one photo at a time. It is deleted just like a message, and hidden data such as location is removed before it is sent.

SOS AND HELP
Hold a button to alert your contacts. SOS sends your location straight away; Help asks first. Location is read only when you send an alert, never in the background. Ashnote doesn't contact emergency services: in danger, call your local emergency number.

PRIVATE BY DESIGN
- End-to-end encryption with a new key for every message, and recovery if a phone's keys are ever copied (Double Ratchet).
- The sender is hidden from relays; each contact gets its own key, and no name is ever typed: your alias is made from a key.
- Screenshots and screen recording are blocked.
- Everything on your phone is stored encrypted and left out of backups.
- No analytics, no ads, no tracking.

Light, dark or system mode. Sounds are off until you switch them on.
```

**App category:** Communication. **Tags:** Messaging, Privacy.
**Contact details:** the owner's support email and website `https://velosolabs.com/ashnote`.
**Privacy policy URL:** `https://velosolabs.com/legal/ashnote-privacy`

## Graphics

| Asset | File | Notes |
|---|---|---|
| App icon 512x512 | `icon-512.png` | Made by `scripts/icons/make_icons.js` |
| Feature graphic 1024x500 | `feature-graphic.png` | Same script |
| Phone screenshots (2 to 8) | `screenshots/*.png` | 1080x2160 (2:1, Play's limit), from the screenshot workflow |

## App content answers

- **App access:** all functionality is available without special access (no sign-in).
- **Ads:** No.
- **Content rating (IARC):** category Communication. Users can interact and exchange content (messages,
  photos): Yes. Shares the user's location with other users: Yes (only when the user sends an alert).
  No violence, sexual content, gambling, drugs or purchases. Expected rating: Everyone / PEGI 3 with
  "Users interact" and "Shares location".
- **Target audience:** 13 and over (not designed for children; the policy says so).
- **News app:** No. **Government app:** No. **Financial features:** None. **Health:** No.
- **Data safety:** Veloso Labs collects no data and shares none with third parties. Everything the app
  sends is end-to-end encrypted between the two phones, and the content can be read only by them; there
  are no analytics, ads or crash SDKs. Answer: "No data collected", "No data shared", data is encrypted in
  transit: Yes, users can delete their data: Yes (remove a contact, or uninstall).
  *Check before submitting:* Google's current Data safety guidance on end-to-end encrypted messages and on
  the relays seeing IP addresses. If Play's reviewer reads relay traffic as collection, declare
  "Messages (encrypted), not shared, required for the app to work".
- **Permissions:** camera, photos (picker), location (foreground only). No background location, so no
  extra location declaration is needed. No SMS, call log or accessibility permissions.

## Release

- Upload the AAB from the GitHub Release (`ashnote-<version>.aab`; it carries all processor types).
- Use **Play App Signing** with the existing upload key. After the first upload, copy the app-signing key's
  SHA-256 from the Play Console into `APP_CERT_SHA256` in velosolabs `app/ashnote_release.py`, so invite
  links open the Play version too.
- Then set the Google Play link in velosolabs `STORE_LINKS`; the download page and invite links switch to it.
