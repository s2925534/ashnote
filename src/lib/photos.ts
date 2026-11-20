// Picks or takes one photo, shrinks it, re-encodes it as JPEG (which drops hidden data such as
// GPS position and camera details) and returns it as base64. Every temporary file the picker and
// resizer create is deleted straight away, so the photo exists only inside Ashnote's encrypted store.
import { File } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { Platform } from "react-native";
import { MAX_IMAGE_B64 } from "../core/engine";

const MAX_SIDE = 1280;

function removeTemp(uri?: string | null) {
  if (!uri || Platform.OS === "web" || !uri.startsWith("file:")) return;
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {}
}

export type Picked = { b64: string; w: number; h: number } | { error: string } | null;

export async function pickPhoto(source: "camera" | "library"): Promise<Picked> {
  const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], allowsMultipleSelection: false, quality: 1, exif: false };
  if (source === "camera") {
    const p = await ImagePicker.requestCameraPermissionsAsync(); // first use only
    if (!p.granted) return { error: "Camera access is off for Ashnote. Turn it on in your phone's settings." };
  }
  const res = source === "camera" ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
  if (res.canceled || !res.assets?.[0]) return null;
  const a = res.assets[0];
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(a.width || MAX_SIDE, a.height || MAX_SIDE));
    let quality = 0.7;
    for (let tries = 0; tries < 4; tries++) {
      const ctx = ImageManipulator.manipulate(a.uri);
      if (scale < 1) ctx.resize({ width: Math.round(a.width * scale) });
      const ref = await ctx.renderAsync();
      const out = await ref.saveAsync({ format: SaveFormat.JPEG, compress: quality, base64: true });
      removeTemp(out.uri);
      if (out.base64 && out.base64.length <= MAX_IMAGE_B64) return { b64: out.base64, w: out.width, h: out.height };
      quality -= 0.15;
    }
    return { error: "That photo is too large to send. Try another one." };
  } finally {
    removeTemp(a.uri); // the picker's own copy
  }
}
